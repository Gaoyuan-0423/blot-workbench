import { afterEach, describe, expect, it } from "vitest";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { encode } from "fast-png";
import { createAnalyzeApi, type AnalyzeApiHandler } from "./analyze-api";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Uniform-background fixture: two painted bands, one faint (like the e2e). */
function png(levels: number[]): Uint8Array {
  const width = levels.length * 50,
    height = 64;
  const data = new Uint8Array(width * height).fill(220);
  for (let lane = 0; lane < levels.length; lane++)
    for (let y = 20; y < 28; y++)
      for (let x = 12 + lane * 43; x < 30 + lane * 43; x++)
        data[y * width + x] = levels[lane];
  return encode({ width, height, data, channels: 1, depth: 8 });
}
const imageBody = (levels: number[]) =>
  Buffer.from(png(levels)).toString("base64");

async function harness() {
  let handler: AnalyzeApiHandler | undefined;
  const server = createServer(((request, response) =>
    handler!(request, response)) as RequestListener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  handler = createAnalyzeApi({ origin });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function call(
    body: unknown,
    extraHeaders?: Record<string, string>,
  ) {
    const response = await fetch(`${origin}/api/analyze`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: JSON.parse(text) as Record<string, any>,
      text,
    };
  }
  const validBody = () => ({
    name: "API QA",
    laneDescription: "1=NC; 2=Drug; 3=marker",
    images: [
      { name: "Target_rep1.png", base64: imageBody([120, 160]) },
      { name: "tublin_rep1.png", base64: imageBody([150, 185]) },
    ],
  });
  return { origin, call, validBody };
}

describe("one-click local analysis API", () => {
  it("runs the full pipeline and returns report, results, and CSV", async () => {
    const api = await harness();
    const response = await api.call(api.validBody());
    expect(response.status).toBe(200);
    expect(response.body.report.format).toBe(
      "blot-workbench-analysis-report",
    );
    expect(response.body.report.project.name).toBe("API QA");
    expect(response.body.report.summary.images).toBe(2);
    expect(Array.isArray(response.body.report.issues)).toBe(true);
    expect(response.body.report.recommendations.length).toBeGreaterThan(0);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0]).toMatchObject({
      protein: "Target",
      lane: 1,
    });
    expect(response.body.csv).toContain("background_method");
    expect(response.body.csv).toContain("image_sha256");
  });

  it("honors rolling-ball and matched-control options in the report", async () => {
    const api = await harness();
    const body = {
      ...api.validBody(),
      designConfirmed: true,
      backgroundCorrection: { kind: "rolling-ball", radius: 25 },
      normalization: { kind: "matched-control" },
    };
    const response = await api.call(body);
    expect(response.status).toBe(200);
    expect(response.body.report.project.backgroundCorrection).toEqual({
      kind: "rolling-ball",
      radius: 25,
    });
    expect(response.body.report.project.normalization).toEqual({
      kind: "matched-control",
    });
    expect(
      response.body.report.recommendations.map(
        (item: { code: string }) => item.code,
      ),
    ).toContain("RESULTS_READY");
  });

  it("rejects cross-origin requests, bad lane descriptions, and invalid images", async () => {
    const api = await harness();
    const wrongOrigin = await fetch(`${api.origin}/api/analyze`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify(api.validBody()),
    });
    expect(wrongOrigin.status).toBe(403);

    const badLanes = await api.call({
      ...api.validBody(),
      laneDescription: "totally free text without mappings",
    });
    expect(badLanes.status).toBe(400);
    expect(badLanes.body.error.code).toBe("ANALYSIS_INVALID");
    expect(badLanes.body.error.detail.length).toBeGreaterThan(0);

    const badImage = await api.call({
      ...api.validBody(),
      images: [
        { name: "Target_rep1.png", base64: Buffer.from("not an image").toString("base64") },
      ],
    });
    expect(badImage.status).toBe(400);
    expect(badImage.body.error.code).toBe("ANALYSIS_INVALID");

    const unsupported = await api.call({
      ...api.validBody(),
      images: [
        { name: "Target_rep1.bmp", base64: imageBody([120, 160]) },
      ],
    });
    expect(unsupported.status).toBe(400);
  });

  it("enforces the request schema and body limits", async () => {
    const api = await harness();
    const empty = await api.call({ laneDescription: "1=NC" });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("INVALID_REQUEST");

    const huge = await api.call({
      ...api.validBody(),
      images: [
        { name: "Target_rep1.png", base64: "A".repeat(97 * 1024 * 1024) },
      ],
    });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("REQUEST_TOO_LARGE");
  });
});
