import { describe, expect, it } from "vitest";
import {
  applyVisionCandidates,
  VisionCandidateCache,
  visionCacheKey,
  VISION_CANDIDATE_WARNING,
} from "./vision-candidates";
import type { LaneRegion } from "./pixels";

const localRegion = (lane: number): LaneRegion => ({
  lane,
  band: { x: 10, y: 20, width: 30, height: 12 },
  background: { x: 10, y: 40, width: 30, height: 6 },
  source: "automatic",
});

describe("vision candidate merge and cache", () => {
  it("overrides returned lanes, keeps local lanes and backgrounds, and marks review", () => {
    const regions = [localRegion(1), localRegion(2), localRegion(3)];
    const merged = applyVisionCandidates(
      regions,
      [
        { lane: 2, rect: { x: 0.5, y: 0.25, width: 0.2, height: 0.2 } },
        { lane: 1, rect: { x: 0.05, y: 0.1, width: 0.1, height: 0.1 } },
      ],
      { width: 200, height: 100, maxLane: 3 },
    );
    expect(merged.map((region) => region.lane)).toEqual([1, 2, 3]);
    expect(merged[0].band).toEqual({ x: 10, y: 10, width: 20, height: 10 });
    expect(merged[0].background).toEqual(regions[0].background);
    expect(merged[1].band).toEqual({ x: 100, y: 25, width: 40, height: 20 });
    expect(merged[1].warnings).toContain(VISION_CANDIDATE_WARNING);
    expect(merged[2].band).toEqual(regions[2].band);
    expect(merged[2].warnings ?? []).not.toContain(VISION_CANDIDATE_WARNING);
    expect(merged.every((region) => region.source === "automatic")).toBe(true);
  });

  it("adds clamped regions for lanes the local pass did not cover", () => {
    const merged = applyVisionCandidates(
      [localRegion(1)],
      [{ lane: 3, rect: { x: 0.95, y: 0.9, width: 0.3, height: 0.3 } }],
      { width: 200, height: 100, maxLane: 4 },
    );
    const added = merged.find((region) => region.lane === 3)!;
    expect(added.band.x + added.band.width).toBeLessThanOrEqual(200);
    expect(added.band.y + added.band.height).toBeLessThanOrEqual(100);
    expect(added.background.y).toBeGreaterThanOrEqual(0);
    expect(added.warnings).toContain(VISION_CANDIDATE_WARNING);
  });

  it("ignores lanes beyond the declared count and caches by every key part", () => {
    expect(
      applyVisionCandidates(
        [],
        [{ lane: 5, rect: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } }],
        { width: 100, height: 100, maxLane: 4 },
      ),
    ).toEqual([]);
    const cache = new VisionCandidateCache();
    const base = {
      imageHash: "a",
      uploadPreviewWidth: 1024,
      baseUrl: "https://x",
      model: "m",
      promptVersion: "p",
      laneCount: 3,
      laneLabels: ["a"],
      signal: "dark" as const,
      revision: 1,
    };
    cache.set(visionCacheKey(base), [{ lane: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }]);
    expect(cache.get(visionCacheKey(base))).toHaveLength(1);
    for (const patch of [{ model: "other" }, { revision: 2 }, { laneLabels: ["b"] }]) {
      expect(cache.get(visionCacheKey({ ...base, ...patch }))).toBeNull();
    }
  });
});
