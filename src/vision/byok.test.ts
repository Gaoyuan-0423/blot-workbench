import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeByokBaseUrl,
  analyzeBandsByok,
  KNOWN_PROVIDERS,
} from "./byok";
import {
  clearByokConfig,
  isByokRemembered,
  loadByokConfig,
  resetByokMemoryForTests,
  saveByokConfig,
} from "./byok-store";

const completion = (content: unknown, status = 200): Response => {
  if (status !== 200) return Response.json({ error: "boom" }, { status });
  return Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(content) },
      },
    ],
  });
};
const bandsContent = {
  bands: [
    { lane: 1, x: 0.05, y: 0.2, width: 0.1, height: 0.3 },
    { lane: 2, x: 0.4, y: 0.2, width: 0.1, height: 0.3 },
  ],
};
const request = {
  laneCount: 2,
  laneLabels: ["NC", "Drug"],
  signal: "dark" as const,
  imageDataUrl: "data:image/png;base64,AAAA",
};

describe("BYOK base URL normalization", () => {
  it("trims trailing slashes and rejects hostile or malformed URLs", () => {
    expect(normalizeByokBaseUrl(" https://api.example.com/v1/ ")).toBe(
      "https://api.example.com/v1",
    );
    expect(() => normalizeByokBaseUrl("https://u:p@api.example.com/v1")).toThrow(
      /账号|credentials/i,
    );
    expect(() =>
      normalizeByokBaseUrl("https://api.example.com/v1?key=1"),
    ).toThrow(/查询|query/i);
    expect(() => normalizeByokBaseUrl("ftp://api.example.com/v1")).toThrow(
      /http/i,
    );
    expect(() =>
      normalizeByokBaseUrl("https://api.example.com/v1/chat/completions"),
    ).toThrow(/chat\/completions/);
  });

  it("lists the known CORS-friendly providers with https roots", () => {
    expect(KNOWN_PROVIDERS.length).toBeGreaterThanOrEqual(5);
    for (const provider of KNOWN_PROVIDERS)
      expect(normalizeByokBaseUrl(provider.baseUrl)).toBe(provider.baseUrl);
  });
});

describe("BYOK direct analyze", () => {
  afterEach(() => resetByokMemoryForTests());

  it("sends the key and lane labels, and returns validated candidates", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return completion(bandsContent);
    });
    const result = await analyzeBandsByok(
      { baseUrl: "https://api.example.com/v1", model: "vl-model", apiKey: "sk-test" },
      request,
      new AbortController().signal,
      fetchImpl as unknown as typeof globalThis.fetch,
    );
    expect(result.bands).toHaveLength(2);
    expect(result.bands[0]).toEqual({
      lane: 1,
      rect: { x: 0.05, y: 0.2, width: 0.1, height: 0.3 },
    });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test",
    );
    expect(sent.messages[1].content[0].text).toContain("1 = NC");
  });

  it("maps provider failures to readable errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completion({ nope: true }, 500)),
    );
    await expect(
      analyzeBandsByok(
        { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" },
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/HTTP 500/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completion({ bands: [{ lane: 9, x: 0, y: 0, width: 1, height: 1 }] })),
    );
    await expect(
      analyzeBandsByok(
        { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" },
        { ...request, laneCount: 2 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/lane beyond the declared count|validation/i);
    vi.unstubAllGlobals();
  });
});

describe("BYOK config storage", () => {
  const store = (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    };
  })();

  afterEach(() => {
    clearByokConfig();
    resetByokMemoryForTests();
    vi.unstubAllGlobals();
  });

  it("keeps the config in memory and only persists with explicit consent", () => {
    vi.stubGlobal("localStorage", store);
    const saved = saveByokConfig(
      { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" },
      false,
    );
    expect(saved.baseUrl).toBe("https://api.example.com/v1");
    expect(loadByokConfig()).toEqual(saved);
    expect(isByokRemembered()).toBe(false);
    clearByokConfig();
    expect(loadByokConfig()).toBeNull();

    saveByokConfig(
      { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" },
      true,
    );
    expect(isByokRemembered()).toBe(true);
    // A fresh page (empty memory) recovers the persisted copy.
    resetByokMemoryForTests();
    expect(loadByokConfig()?.apiKey).toBe("k");
    clearByokConfig();
    expect(isByokRemembered()).toBe(false);
    expect(loadByokConfig()).toBeNull();
  });

  it("rejects malformed or hostile persisted values", () => {
    vi.stubGlobal("localStorage", store);
    // A raw JSON text with a literal __proto__ key (object-literal spread
    // would set the prototype instead and never reach storage).
    store.setItem(
      "blot-workbench-vision-byok-v1",
      '{"__proto__":{"x":1},"baseUrl":"https://x","model":"m","apiKey":"k","remember":true}',
    );
    expect(loadByokConfig()).toBeNull();
    store.setItem("blot-workbench-vision-byok-v1", "not-json");
    expect(loadByokConfig()).toBeNull();
  });
});
