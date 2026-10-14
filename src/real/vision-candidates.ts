import type { LaneRegion, Rect } from "./pixels";
import type { VisionBandCandidate } from "../vision/client";

/**
 * Vision-candidate merge and cache logic. The model only ever proposes band
 * rectangles; backgrounds stay local, every vision-sourced region keeps the
 * "requires review" marker, and pixel measurement is unaffected. Pure and
 * Node-testable; the caller owns networking and preview rendering.
 */

export const VISION_CANDIDATE_WARNING = "VISION_CANDIDATES_REQUIRE_REVIEW";

export interface VisionCacheKeyParts {
  imageHash: string;
  uploadPreviewWidth: number;
  baseUrl: string;
  model: string;
  promptVersion: string;
  laneCount: number;
  laneLabels: string[];
  signal: "dark" | "light";
  revision: number;
}

export function visionCacheKey(parts: VisionCacheKeyParts): string {
  return JSON.stringify([
    parts.imageHash,
    parts.uploadPreviewWidth,
    parts.baseUrl,
    parts.model,
    parts.promptVersion,
    parts.laneCount,
    [...parts.laneLabels],
    parts.signal,
    parts.revision,
  ]);
}

export class VisionCandidateCache {
  private readonly entries = new Map<string, VisionBandCandidate[]>();

  get(key: string): VisionBandCandidate[] | null {
    return this.entries.get(key) ?? null;
  }

  set(key: string, bands: VisionBandCandidate[]): void {
    // Bounded: one project holds at most 48 images and a handful of policies.
    if (this.entries.size >= 256) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, bands);
  }

  get size(): number {
    return this.entries.size;
  }
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(rect.x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(rect.y)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(rect.x + rect.width)));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(rect.y + rect.height)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function backgroundFor(band: Rect, height: number): Rect {
  const gap = 2;
  const bgHeight = Math.max(2, Math.min(12, band.height));
  if (band.y - gap - bgHeight >= 0)
    return {
      x: band.x,
      y: band.y - gap - bgHeight,
      width: band.width,
      height: bgHeight,
    };
  return {
    x: band.x,
    y: Math.min(height - bgHeight, band.y + band.height + gap),
    width: band.width,
    height: bgHeight,
  };
}

/**
 * Merge model band candidates into existing proposed regions. Lanes the model
 * did not return keep their local proposal; vision-sourced lanes keep a prior
 * local background when one exists and are always marked for review.
 */
export function applyVisionCandidates(
  regions: LaneRegion[],
  bands: VisionBandCandidate[],
  options: { width: number; height: number; maxLane: number },
): LaneRegion[] {
  const byLane = new Map<number, VisionBandCandidate>();
  for (const band of bands) {
    if (band.lane < 1 || band.lane > options.maxLane) continue;
    if (!byLane.has(band.lane)) byLane.set(band.lane, band);
  }
  const merged: LaneRegion[] = regions.map((region) => {
    const candidate = byLane.get(region.lane);
    if (!candidate) return region;
    const band = clampRect(
      {
        x: candidate.rect.x * options.width,
        y: candidate.rect.y * options.height,
        width: candidate.rect.width * options.width,
        height: candidate.rect.height * options.height,
      },
      options.width,
      options.height,
    );
    return {
      ...region,
      band,
      source: "automatic",
      warnings: [
        ...new Set([...(region.warnings ?? []), VISION_CANDIDATE_WARNING]),
      ],
    };
  });
  const present = new Set(merged.map((region) => region.lane));
  for (const [lane, candidate] of byLane) {
    if (present.has(lane)) continue;
    const band = clampRect(
      {
        x: candidate.rect.x * options.width,
        y: candidate.rect.y * options.height,
        width: candidate.rect.width * options.width,
        height: candidate.rect.height * options.height,
      },
      options.width,
      options.height,
    );
    merged.push({
      lane,
      band,
      background: backgroundFor(band, options.height),
      source: "automatic",
      warnings: [VISION_CANDIDATE_WARNING],
    });
  }
  return merged.sort((a, b) => a.lane - b.lane);
}
