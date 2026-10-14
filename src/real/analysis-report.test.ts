import { beforeAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { encode } from "fast-png";
import {
  applyLaneDescription,
  applyNormalization,
  createRealProject,
  importRealImages,
  updateRealImage,
  updateRealProject,
  type RealProject,
} from "./model";
import { buildAnalysisReport } from "./analysis-report";

beforeAll(() => {
  if (!globalThis.crypto?.subtle)
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
});

const regions = (): import("./pixels").LaneRegion[] => [
  {
    lane: 1,
    band: { x: 2, y: 6, width: 8, height: 4 },
    background: { x: 2, y: 16, width: 8, height: 4 },
    source: "manual",
  },
  {
    lane: 2,
    band: { x: 22, y: 6, width: 8, height: 4 },
    background: { x: 22, y: 16, width: 8, height: 4 },
    source: "manual",
  },
];
function png(
  control: number,
  treatment: number,
  seed: number,
  clipped = false,
): Uint8Array {
  const width = 40,
    height = 24;
  const data = new Uint8Array(width * height).fill(210 + seed);
  for (const [index, region] of regions().entries())
    for (let y = region.band.y; y < region.band.y + region.band.height; y++)
      for (let x = region.band.x; x < region.band.x + region.band.width; x++)
        data[y * width + x] =
          clipped && index === 1
            ? 0
            : 210 + seed - (index === 0 ? control : treatment);
  return encode({ width, height, data, channels: 1, depth: 8 });
}
async function project(clipped = false): Promise<RealProject> {
  let next = applyLaneDescription(
    createRealProject("Report test"),
    "NC,Drug,marker",
  );
  next = await importRealImages(next, [
    { name: "Target_rep1.png", bytes: png(40, 20, 1, clipped) },
    { name: "tublin_rep1.png", bytes: png(20, 20, 5, clipped) },
  ]);
  for (const image of next.images)
    next = updateRealImage(next, image.id, { regions: regions() });
  return next;
}
function reviewed(base: RealProject): RealProject {
  let next = updateRealProject(base, { designConfirmed: true });
  // Reference first: reviewing a reference invalidates dependent targets.
  for (const image of [...next.images].sort((a, b) =>
    a.role === b.role ? 0 : a.role === "reference" ? -1 : 1,
  ))
    next = updateRealImage(next, image.id, { reviewed: true });
  return next;
}

describe("one-click analysis report", () => {
  it("flags the unconfirmed design and pending review on a fresh project", async () => {
    const report = buildAnalysisReport(await project());
    expect(report.format).toBe("blot-workbench-analysis-report");
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).toContain("DESIGN_UNCONFIRMED");
    expect(codes).toContain("REVIEW_REQUIRED");
    const recommendationCodes = report.recommendations.map((item) => item.code);
    expect(recommendationCodes).toContain("CONFIRM_DESIGN");
    expect(recommendationCodes).toContain("REVIEW_CANDIDATES");
    expect(report.summary.results.blocked).toBe(0);
    expect(report.summary.results.draft).toBeGreaterThan(0);
  });

  it("reports saturation with an exposure recommendation and stays draft", async () => {
    const report = buildAnalysisReport(
      applyNormalization(reviewed(await project(true)), {
        kind: "matched-control",
      }),
    );
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).toContain("CLIPPED_PIXELS");
    expect(
      report.recommendations.map((item) => item.code),
    ).toContain("EXPOSURE_SATURATION");
    expect(report.summary.issues.warning).toBeGreaterThan(0);
    expect(report.summary.results.draft).toBeGreaterThan(0);
  });

  it("reports a ready project with no blockers and a ready recommendation", async () => {
    const report = buildAnalysisReport(
      reviewed(
        applyNormalization(await project(), { kind: "matched-control" }),
      ),
    );
    expect(report.summary.issues.blocker).toBe(0);
    expect(report.summary.results.ready).toBeGreaterThan(0);
    expect(
      report.recommendations.map((item) => item.code),
    ).toContain("RESULTS_READY");
    expect(
      report.recommendations.map((item) => item.code),
    ).not.toContain("EXPOSURE_SATURATION");
  });

  it("records the active background method and normalization in the report", async () => {
    const rolling = updateRealProject(await project(), {
      backgroundCorrection: { kind: "rolling-ball", radius: 50 },
    });
    const report = buildAnalysisReport(
      applyNormalization(rolling, { kind: "matched-control" }),
    );
    expect(report.project.backgroundCorrection).toEqual({
      kind: "rolling-ball",
      radius: 50,
    });
    expect(report.project.normalization).toEqual({ kind: "matched-control" });
  });
});
