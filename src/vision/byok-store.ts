/**
 * BYOK vision-config storage. The key and provider config live in page
 * memory by default; only an explicit "remember on this device" consent
 * writes them to localStorage (plaintext, clearable — same policy the
 * blotlens project established with the user).
 */

import { normalizeByokBaseUrl, type ByokConfig } from "./byok";

const STORAGE_KEY = "blot-workbench-vision-byok-v1";
const MAX_FIELD = 2048;

export interface ByokStoredConfig extends ByokConfig {
  remember: true;
}

function isValidConfig(value: unknown): value is ByokConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.baseUrl === "string" &&
    candidate.baseUrl.length > 0 &&
    candidate.baseUrl.length <= MAX_FIELD &&
    typeof candidate.model === "string" &&
    candidate.model.length > 0 &&
    candidate.model.length <= 200 &&
    typeof candidate.apiKey === "string" &&
    candidate.apiKey.length <= 4096
  );
}

function safeParse(text: string | null): ByokStoredConfig | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text, (key: string, value: unknown) => {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("Prototype pollution attempt.");
      return value;
    });
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).remember !== true ||
      !isValidConfig(parsed)
    )
      return null;
    return { ...(parsed as ByokConfig), remember: true };
  } catch {
    return null;
  }
}

/** Page-memory config (always present; cleared on refresh). */
let memoryConfig: ByokConfig | null = null;

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadByokConfig(): ByokConfig | null {
  if (memoryConfig) return memoryConfig;
  const stored = safeParse(storage()?.getItem(STORAGE_KEY) ?? null);
  if (stored) {
    memoryConfig = {
      baseUrl: stored.baseUrl,
      model: stored.model,
      apiKey: stored.apiKey,
    };
    return memoryConfig;
  }
  return null;
}

export function isByokRemembered(): boolean {
  return safeParse(storage()?.getItem(STORAGE_KEY) ?? null) !== null;
}

/**
 * Save into page memory; when `remember` is true also persist to
 * localStorage. The base URL is normalized first so stored values stay
 * canonical. Returns the normalized config.
 */
export function saveByokConfig(
  config: ByokConfig,
  remember: boolean,
): ByokConfig {
  const normalized: ByokConfig = {
    baseUrl: normalizeByokBaseUrl(config.baseUrl),
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
  };
  memoryConfig = normalized;
  if (remember) {
    const stored: ByokStoredConfig = { ...normalized, remember: true };
    storage()?.setItem(STORAGE_KEY, JSON.stringify(stored));
  }
  return normalized;
}

/** Forget both the memory config and any persisted copy. */
export function clearByokConfig(): void {
  memoryConfig = null;
  storage()?.removeItem(STORAGE_KEY);
}

/** Test-only: reset module state without touching localStorage. */
export function resetByokMemoryForTests(): void {
  memoryConfig = null;
}
