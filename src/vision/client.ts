export interface VisionConfig {
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  revision: number;
  protocol: "openai-chat-completions";
}

export interface VisionTestResult {
  baseUrl: string;
  model: string;
  synthetic: true;
  promptVersion: string;
  bandCount: number;
  expectedBandCount: 6;
  matchesExpectedCount: boolean;
  elapsedMs: number;
}

export class VisionClientError extends Error {
  constructor(
    public readonly kind:
      "service" | "network" | "invalid-response" | "local-only",
    message = "",
    public readonly code = "",
  ) {
    super(message);
    this.name = "VisionClientError";
  }
}

export function isLocalVisionPage(
  location: Pick<Location, "hostname" | "protocol"> = window.location,
): boolean {
  return (
    ["http:", "https:"].includes(location.protocol) &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname)
  );
}

export function serviceOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength = 2048): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function parseConfig(value: unknown): VisionConfig {
  if (
    !record(value) ||
    !text(value.baseUrl) ||
    (value.baseUrl !== "" && serviceOrigin(value.baseUrl) === null) ||
    !text(value.model, 256) ||
    typeof value.keyConfigured !== "boolean" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    value.protocol !== "openai-chat-completions"
  )
    throw new VisionClientError("invalid-response");
  return {
    baseUrl: value.baseUrl,
    model: value.model,
    keyConfigured: value.keyConfigured,
    revision: value.revision as number,
    protocol: value.protocol,
  };
}

function parseResult(value: unknown): VisionTestResult {
  if (
    !record(value) ||
    !text(value.baseUrl) ||
    serviceOrigin(value.baseUrl) === null ||
    !text(value.model, 256) ||
    !value.model ||
    value.synthetic !== true ||
    !text(value.promptVersion, 128) ||
    !value.promptVersion ||
    !Number.isSafeInteger(value.bandCount) ||
    (value.bandCount as number) < 0 ||
    value.expectedBandCount !== 6 ||
    value.matchesExpectedCount !== (value.bandCount === 6) ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0
  )
    throw new VisionClientError("invalid-response");
  return {
    baseUrl: value.baseUrl,
    model: value.model,
    synthetic: true,
    promptVersion: value.promptVersion,
    bandCount: value.bandCount as number,
    expectedBandCount: 6,
    matchesExpectedCount: value.matchesExpectedCount,
    elapsedMs: value.elapsedMs,
  };
}

export interface VisionBandCandidate {
  lane: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface VisionAnalyzeRequest {
  revision: number;
  laneCount: number;
  /** Declared lane labels; may be empty when only counts are known. */
  laneLabels: string[];
  signal: "dark" | "light";
  /** PNG data URL of the upload preview. */
  imageDataUrl: string;
}

export interface VisionAnalyzeResult {
  baseUrl: string;
  model: string;
  promptVersion: string;
  bands: VisionBandCandidate[];
  elapsedMs: number;
}

async function request(
  path: "/api/vision/config" | "/api/vision/test" | "/api/vision/analyze",
  method: "GET" | "POST" | "DELETE",
  signal: AbortSignal,
  body?: object,
): Promise<unknown> {
  if (!isLocalVisionPage()) throw new VisionClientError("local-only");
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      mode: "same-origin",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw new VisionClientError("network");
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new VisionClientError("invalid-response");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw new VisionClientError("invalid-response");
  }
  if (!response.ok) {
    if (
      record(payload) &&
      record(payload.error) &&
      text(payload.error.code, 80) &&
      /^[a-zA-Z0-9_-]+$/.test(payload.error.code) &&
      text(payload.error.message, 1000) &&
      payload.error.message
    )
      throw new VisionClientError(
        "service",
        payload.error.message,
        payload.error.code,
      );
    throw new VisionClientError("invalid-response");
  }
  return payload;
}

export async function getVisionConfig(signal: AbortSignal) {
  return parseConfig(await request("/api/vision/config", "GET", signal));
}

export async function saveVisionConfig(
  config: { baseUrl: string; model: string; apiKey?: string },
  signal: AbortSignal,
) {
  return parseConfig(
    await request("/api/vision/config", "POST", signal, config),
  );
}

export async function clearVisionConfig(signal: AbortSignal) {
  return parseConfig(await request("/api/vision/config", "DELETE", signal));
}

export async function testVisionConfig(revision: number, signal: AbortSignal) {
  return parseResult(
    await request("/api/vision/test", "POST", signal, { revision }),
  );
}

function parseBandCandidates(value: unknown): VisionBandCandidate[] {
  if (!record(value) || !Array.isArray(value.bands)) {
    throw new VisionClientError("invalid-response");
  }
  if (value.bands.length > 32) throw new VisionClientError("invalid-response");
  return value.bands.map((entry) => {
    if (
      !record(entry) ||
      !Number.isSafeInteger(entry.lane) ||
      (entry.lane as number) < 1 ||
      !record(entry.rect)
    ) {
      throw new VisionClientError("invalid-response");
    }
    const rect = entry.rect as Record<string, unknown>;
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof rect[key] !== "number" || !Number.isFinite(rect[key] as number)) {
        throw new VisionClientError("invalid-response");
      }
    }
    return {
      lane: entry.lane as number,
      rect: {
        x: rect.x as number,
        y: rect.y as number,
        width: rect.width as number,
        height: rect.height as number,
      },
    };
  });
}

export async function analyzeVisionCandidates(
  body: VisionAnalyzeRequest,
  signal: AbortSignal,
): Promise<VisionAnalyzeResult> {
  const payload = await request(
    "/api/vision/analyze",
    "POST",
    signal,
    body as unknown as object,
  );
  if (
    !record(payload) ||
    !text(payload.baseUrl) ||
    serviceOrigin(payload.baseUrl) === null ||
    !text(payload.model, 256) ||
    !text(payload.promptVersion, 128) ||
    typeof payload.elapsedMs !== "number" ||
    !Number.isFinite(payload.elapsedMs)
  ) {
    throw new VisionClientError("invalid-response");
  }
  return {
    baseUrl: payload.baseUrl,
    model: payload.model,
    promptVersion: payload.promptVersion,
    bands: parseBandCandidates(payload),
    elapsedMs: payload.elapsedMs,
  };
}
