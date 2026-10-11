import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServer,
  request as httpRequest,
  type RequestListener,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createVisionApi, type VisionApiHandler } from "./api";
import { getFixtures } from "../src/core/fixtures";

const SECRET = "sk-test-secret-DO-NOT-RETURN";
const bands = (count = 6) =>
  Array.from({ length: count }, (_, i) => ({
    x: 48 + i * 104,
    y: 108,
    width: 72,
    height: 36,
  }));
function completion(
  content: unknown = { bands: bands() },
  options: {
    finish_reason?: string;
    refusal?: string;
    tool_calls?: unknown;
  } = {},
): Response {
  return Response.json({
    id: "example",
    choices: [
      {
        finish_reason: options.finish_reason ?? "stop",
        message: {
          role: "assistant",
          content: JSON.stringify(content),
          ...(options.refusal && { refusal: options.refusal }),
          ...(options.tool_calls !== undefined && {
            tool_calls: options.tool_calls,
          }),
        },
      },
    ],
  });
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function harness(
  fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => completion()),
  timeoutMs = 1000,
) {
  let handler: VisionApiHandler | undefined;
  const server = createServer(((request, response) =>
    handler!(request, response)) as RequestListener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  handler = createVisionApi({ origin, fetchImpl, timeoutMs });
  cleanups.push(async () => {
    handler!.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: JSON.parse(text) as Record<string, any>,
      text,
      headers: response.headers,
    };
  }
  const config = (patch: Record<string, unknown> = {}) =>
    call("/api/vision/config", "POST", {
      baseUrl: "https://provider.example/v1",
      model: "vision-test",
      apiKey: SECRET,
      ...patch,
    });
  const test = (revision = 1, extra: Record<string, unknown> = {}) =>
    call("/api/vision/test", "POST", { revision, ...extra });
  return { server, origin, handler, call, config, test, fetchImpl };
}

describe("in-memory configuration and credential boundary", () => {
  it("never returns a key, retains it only within the same provider origin, clears it explicitly or on deletion", async () => {
    const api = await harness();
    expect((await api.call("/api/vision/config")).body).toEqual({
      baseUrl: "",
      model: "",
      keyConfigured: false,
      revision: 0,
      protocol: "openai-chat-completions",
    });
    const saved = await api.config();
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(SECRET);
    expect(saved.body).toMatchObject({ keyConfigured: true, revision: 1 });
    const read = await api.call("/api/vision/config");
    expect(read.text).not.toContain(SECRET);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const same = await api.call("/api/vision/config", "POST", {
      baseUrl: "https://provider.example/alternate/",
      model: "new-model",
    });
    expect(same.body).toMatchObject({
      baseUrl: "https://provider.example/alternate",
      keyConfigured: true,
      revision: 2,
    });
    await api.test(2);
    expect(
      (api.fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe(`Bearer ${SECRET}`);
    const different = await api.call("/api/vision/config", "POST", {
      baseUrl: "https://another.example/v1",
      model: "vision-test",
    });
    expect(different.body).toMatchObject({ keyConfigured: false, revision: 3 });
    await api.test(3);
    expect(
      (api.fetchImpl.mock.calls[1][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBeUndefined();
    await api.config();
    expect((await api.config({ apiKey: "" })).body.keyConfigured).toBe(false);
    const deleted = await api.call("/api/vision/config", "DELETE");
    expect(deleted.body).toMatchObject({
      baseUrl: "",
      model: "",
      keyConfigured: false,
    });
    expect((await api.test(deleted.body.revision)).body.error.code).toBe(
      "CONFIG_REQUIRED",
    );
  });
  it("does not retain a key when the provider port or scheme changes", async () => {
    const api = await harness();
    await api.config();
    const changed = await api.call("/api/vision/config", "POST", {
      baseUrl: "https://provider.example:8443/v1",
      model: "v",
    });
    expect(changed.body.keyConfigured).toBe(false);
    await api.config({ baseUrl: "https://localhost:4319/v1" });
    expect(
      (
        await api.call("/api/vision/config", "POST", {
          baseUrl: "http://localhost:4319/v1",
          model: "v",
        })
      ).body.keyConfigured,
    ).toBe(false);
  });
  it("requires an exact same-origin Host and Origin; GET also blocks cross-site and unmarked requests", async () => {
    const api = await harness();
    expect((await api.config()).status).toBe(200);
    for (const path of ["/api/vision/config", "/api/vision/test"]) {
      expect(
        (await api.call(path, "POST", {}, { Origin: "https://evil.example" }))
          .status,
      ).toBe(403);
      expect(
        (await api.call(path, "POST", {}, { Origin: "null" })).status,
      ).toBe(403);
    }
    expect(
      (
        await api.call("/api/vision/config", "GET", undefined, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api.call("/api/vision/config", "GET", undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
    ).toBe(403);
    const wrongHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          `${api.origin}/api/vision/config`,
          { headers: { Host: "evil.example", Origin: api.origin } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
    expect(wrongHostStatus).toBe(403);
    expect(
      (
        await api.call("/api/vision/config", "DELETE", undefined, {
          Origin: "http://127.0.0.1:1",
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${api.origin}/api/vision/config`)).status).toBe(403);
    expect(
      (
        await fetch(`${api.origin}/api/vision/config`, {
          headers: { "Sec-Fetch-Site": "same-origin" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${api.origin}/api/vision/config`, {
          method: "DELETE",
          headers: { "Sec-Fetch-Site": "same-origin" },
        })
      ).status,
    ).toBe(403);
    const read = await api.call("/api/vision/config");
    expect(read.headers.get("access-control-allow-origin")).toBeNull();
    expect(read.body.keyConfigured).toBe(true);
  });
  it("rejects insecure remote providers, credentials, query/fragment URLs and surprising local aliases", async () => {
    const api = await harness();
    for (const baseUrl of [
      "http://example.com/v1",
      "http://192.168.1.3/v1",
      "http://127.1/v1",
      "http://2130706433/v1",
      "http://[::1]:8000/v1",
      "file:///etc/passwd",
      "https://user:secret@example.com/v1",
      "https://@example.com/v1",
      "https://example.com/v1?key=secret",
      "https://example.com/v1#secret",
      "https://example.com/v1?",
      "https://example.com/v1#",
      "https://example.com/v1\\bad",
      "https://example.com/v1/chat/completions/",
    ]) {
      const result = await api.config({ baseUrl });
      expect(result.status, baseUrl).toBe(400);
      expect(result.text).not.toContain("secret");
    }
    for (const baseUrl of [
      "http://127.0.0.1:11434/v1",
      "http://localhost:8000/v1",
      "https://valid.example/v1",
    ])
      expect((await api.config({ baseUrl })).status).toBe(200);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects extra fields, invalid JSON, oversized content, query routes and header injection without echo", async () => {
    const api = await harness();
    expect((await api.config({ unexpected: SECRET })).status).toBe(400);
    expect(
      (await api.config({ apiKey: `${SECRET}\r\nX-Injected: true` })).status,
    ).toBe(400);
    expect((await api.call("/api/vision/config?apiKey=secret")).status).toBe(
      400,
    );
    const invalid = await fetch(`${api.origin}/api/vision/config`, {
      method: "POST",
      headers: { Origin: api.origin, "Content-Type": "application/json" },
      body: `{"apiKey":"${SECRET}"`,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain(SECRET);
    const large = await api.config({ model: "x".repeat(10000) });
    expect(large.status).toBe(413);
    const chunked = await new Promise<{ status?: number; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          `${api.origin}/api/vision/config`,
          {
            method: "POST",
            headers: {
              Origin: api.origin,
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked",
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode,
                body: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        request.on("error", reject);
        request.write("x".repeat(4096));
        request.end("x".repeat(4097));
      },
    );
    expect(chunked.status).toBe(413);
    expect(JSON.parse(chunked.body).error.code).toBe("REQUEST_TOO_LARGE");
    const pollution = await fetch(`${api.origin}/api/vision/config`, {
      method: "POST",
      headers: { Origin: api.origin, "Content-Type": "application/json" },
      body: '{"__proto__":{"polluted":true}}',
    });
    expect(pollution.status).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await api.call("/api/unknown")).body.error.code).toBe("NOT_FOUND");
  });
});

describe("synthetic-only connection test", () => {
  it("sends only the fixed synthetic PNG and prompt, validates candidates, and returns safe summary metadata", async () => {
    const api = await harness();
    await api.config();
    const result = await api.test();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      baseUrl: "https://provider.example/v1",
      model: "vision-test",
      synthetic: true,
      promptVersion: "wb-synthetic-band-candidates-v1",
      bandCount: 6,
      expectedBandCount: 6,
      matchesExpectedCount: true,
    });
    expect(result.body.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.body.bands).toBeUndefined();
    expect(result.text).not.toContain(SECRET);
    expect(api.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = api.fetchImpl.mock.calls[0];
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(init?.redirect).toBe("manual");
    const body = JSON.parse(init?.body as string);
    expect(body.messages[1].content[1].image_url.url).toBe(
      getFixtures().find((entry) => entry.image.id === "a-target-1000")!.image
        .dataUrl,
    );
    expect(body.messages[1].content[0].text).toContain("720 by 280");
    expect(body.messages[0].content).toContain("Do not measure intensity");
    expect(body.messages[0].content).toContain('"bands"');
    // Provider-specific generation parameters must not prevent configuration
    // of otherwise compatible image-capable Chat Completions endpoints.
    expect(Object.keys(body).sort()).toEqual(["messages", "model"]);
    expect(body).not.toHaveProperty("apiKey");
  });
  it("rejects stale revision and arbitrary image/text fields before contacting a provider", async () => {
    const api = await harness();
    await api.config();
    await api.config({ model: "changed" });
    expect((await api.test(1)).body.error.code).toBe("CONFIG_CHANGED");
    expect(
      (await api.test(2, { image: "data:image/png;base64,secret" })).status,
    ).toBe(400);
    expect((await api.test(2, { prompt: "arbitrary text" })).status).toBe(400);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
  it("reports a legal count mismatch without implying localization accuracy", async () => {
    const api = await harness(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () => completion({ bands: bands(5) })),
    );
    await api.config();
    expect((await api.test()).body).toMatchObject({
      bandCount: 5,
      expectedBandCount: 6,
      matchesExpectedCount: false,
      synthetic: true,
    });
  });
  it("accepts absent or empty tool-call metadata but refuses actual tool calls", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = await harness(fetchMock);
    await api.config();
    for (const calls of [undefined, null, []]) {
      fetchMock.mockImplementationOnce(async () =>
        completion({ bands: bands() }, { tool_calls: calls }),
      );
      expect((await api.test()).body.bandCount).toBe(6);
    }
    for (const calls of [[{ type: "function" }], "invalid"]) {
      fetchMock.mockImplementationOnce(async () =>
        completion({ bands: bands() }, { tool_calls: calls }),
      );
      expect((await api.test()).body.error.code).toBe("INVALID_RESPONSE");
    }
  });
  it("rejects malformed, extra, duplicate, out-of-bounds, fractional and truncated candidates without reflecting content", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = await harness(fetchMock);
    await api.config();
    const invalid = [
      null,
      { bands: [] },
      { bands: bands(), secret: SECRET },
      { bands: [{ x: 719, y: 0, width: 2, height: 1 }] },
      { bands: [{ x: 1.5, y: 0, width: 2, height: 1 }] },
      { bands: [{ x: 0, y: 0, width: 2, height: 1, intensity: SECRET }] },
      { bands: [bands()[0], bands()[0]] },
      { bands: [{ x: 0, y: 279, width: 2, height: 2 }] },
    ];
    for (const value of invalid) {
      fetchMock.mockImplementationOnce(async () => completion(value));
      const response = await api.test();
      expect(response.body.error.code).toBe("INVALID_RESPONSE");
      expect(response.text).not.toContain(SECRET);
    }
    fetchMock.mockImplementationOnce(async () =>
      completion({ bands: bands() }, { finish_reason: "length" }),
    );
    expect((await api.test()).body.error.code).toBe("INVALID_RESPONSE");
    fetchMock.mockImplementationOnce(async () =>
      completion({ bands: bands() }, { refusal: SECRET }),
    );
    expect((await api.test()).body.error.code).toBe("INVALID_RESPONSE");
    fetchMock.mockImplementationOnce(
      async () => new Response(SECRET, { status: 200 }),
    );
    const raw = await api.test();
    expect(raw.body.error.code).toBe("INVALID_RESPONSE");
    expect(raw.text).not.toContain(SECRET);
  });
  it("never follows redirects or returns provider failures or thrown secrets", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = await harness(fetchMock);
    await api.config();
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(SECRET, {
          status: 302,
          headers: { Location: "https://evil.example" },
        }),
    );
    const redirect = await api.test();
    expect(redirect.body.error.code).toBe("UPSTREAM_REDIRECT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementationOnce(
      async () => new Response(SECRET, { status: 401 }),
    );
    const denied = await api.test();
    expect(denied.body.error.code).toBe("UPSTREAM_FAILED");
    expect(denied.text).not.toContain(SECRET);
    fetchMock.mockImplementationOnce(async () => {
      throw new Error(`Provider echoed ${SECRET}`);
    });
    const thrown = await api.test();
    expect(thrown.body.error.code).toBe("UPSTREAM_FAILED");
    expect(thrown.text).not.toContain(SECRET);
  });
  it("enforces response size for both advertised and streamed bodies", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = await harness(fetchMock);
    await api.config();
    fetchMock.mockImplementationOnce(
      async () =>
        new Response("{}", {
          headers: { "Content-Length": String(512 * 1024 + 1) },
        }),
    );
    expect((await api.test()).body.error.code).toBe("RESPONSE_TOO_LARGE");
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(512 * 1024 + 1));
              controller.close();
            },
          }),
        ),
    );
    expect((await api.test()).body.error.code).toBe("RESPONSE_TOO_LARGE");
  });
  it("times out even if a provider ignores cancellation, and releases the busy state without retry", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        signal = options?.signal;
        return new Promise<Response>(() => undefined);
      });
    const api = await harness(fetchMock, 35);
    await api.config();
    const result = await api.test();
    expect(result.status).toBe(504);
    expect(result.body.error.code).toBe("UPSTREAM_TIMEOUT");
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await api.config({ model: "after-timeout" })).status).toBe(200);
  });
  it("times out a stalled response stream as well as a stalled fetch", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(new ReadableStream({ start() {} })),
      );
    const api = await harness(fetchMock, 35);
    await api.config();
    expect((await api.test()).body.error.code).toBe("UPSTREAM_TIMEOUT");
  });
  it("allows only one test and rejects configuration writes/deletion while it runs", async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const api = await harness(fetchMock);
    await api.config();
    const running = api.test();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((await api.test()).body.error.code).toBe("TEST_BUSY");
    expect((await api.config({ apiKey: "replacement" })).body.error.code).toBe(
      "TEST_BUSY",
    );
    expect(
      (await api.call("/api/vision/config", "DELETE")).body.error.code,
    ).toBe("TEST_BUSY");
    expect((await api.call("/api/vision/config")).body.revision).toBe(1);
    finish!(completion());
    expect((await running).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels upstream work after browser disconnect and when the handler closes", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        signal = options?.signal;
        return new Promise<Response>(() => undefined);
      });
    const api = await harness(fetchMock);
    await api.config();
    const request = httpRequest(`${api.origin}/api/vision/test`, {
      method: "POST",
      headers: { Origin: api.origin, "Content-Type": "application/json" },
    });
    request.on("error", () => undefined);
    request.end(JSON.stringify({ revision: 1 }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    request.destroy();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect((await api.config()).status).toBe(200);
    const running = api.test(2);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    api.handler!.close();
    await running;
    expect(signal?.aborted).toBe(true);
    expect((await api.call("/api/vision/config")).body.error.code).toBe(
      "SERVER_CLOSED",
    );
  });
});
