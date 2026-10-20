import { z } from "../schema-validator";

/**
 * Shared validation for vision-provider band candidates. The local server
 * (`server/api.ts`) and the browser-direct BYOK client (`byok.ts`) both parse
 * provider output through this exact schema, so the strictness can never
 * drift between the two paths.
 */

export const VISION_BAND_LANES_MAX = 32;

export const normalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .strict()
  .refine(
    (rectangle) =>
      rectangle.x + rectangle.width <= 1 + 1e-9 &&
      rectangle.y + rectangle.height <= 1 + 1e-9,
  );

export const providerBandSchema = z
  .object({
    lane: z.number().int().min(1).max(VISION_BAND_LANES_MAX),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .strict()
  .refine(
    (band) => band.x + band.width <= 1 + 1e-9 && band.y + band.height <= 1 + 1e-9,
  );

export const providerBandsSchema = z
  .object({ bands: z.array(providerBandSchema).max(VISION_BAND_LANES_MAX) })
  .strict()
  .refine(
    ({ bands }) => new Set(bands.map((band) => band.lane)).size === bands.length,
  );

export interface VisionBand {
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Parse a chat-completions payload and validate the embedded candidate JSON.
 * `maxLane` bounds the declared lane count for this request (the static
 * schema only knows the global ceiling). Throws Error on any deviation.
 */
export function parseProviderBandCandidates(
  payload: unknown,
  maxLane: number,
): VisionBand[] {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length !== 1)
    throw new Error("Provider response has no single choice.");
  const choice: unknown = choices[0];
  if (!choice || typeof choice !== "object") {
    throw new Error("Provider response choice is invalid.");
  }
  const { message, finish_reason: reason } = choice as {
    message?: unknown;
    finish_reason?: unknown;
  };
  const toolCalls = (message as { tool_calls?: unknown } | undefined)
    ?.tool_calls;
  const hasToolCalls = toolCalls != null && (!Array.isArray(toolCalls) || toolCalls.length > 0);
  if (
    reason !== "stop" ||
    !message ||
    typeof message !== "object" ||
    typeof (message as { content?: unknown }).content !== "string" ||
    (message as { refusal?: unknown }).refusal ||
    hasToolCalls
  )
    throw new Error("Provider did not return usable content.");
  let candidatePayload: unknown;
  try {
    candidatePayload = JSON.parse((message as { content: string }).content) as unknown;
  } catch {
    throw new Error("Provider content is not valid JSON.");
  }
  const candidates = providerBandsSchema.safeParse(candidatePayload);
  if (!candidates.success) {
    throw new Error(
      "Provider band candidates failed validation (lanes, bounds, or duplicates).",
    );
  }
  if (candidates.data.bands.some((band) => band.lane > maxLane))
    throw new Error("Provider returned a lane beyond the declared count.");
  return candidates.data.bands;
}
