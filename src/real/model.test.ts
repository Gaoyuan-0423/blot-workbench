import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { encode } from "fast-png";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { set } from "idb-keyval";
import * as pixels from "./pixels";
import { pairedTTest } from "./statistics";
import { APP_VERSION } from "../core/types";
import {
  analyzeAll,
  applyPairedDesign,
  applyNormalization,
  applyLaneDescription,
  createRealProject,
  descriptiveStatistics,
  exportRealCsv,
  exportRealStatisticsCsv,
  realPairedTests,
  exportRealProject,
  importRealImages,
  importRealProject,
  loadRealProject,
  results,
  saveRealProject,
  updateRealImage,
  updateRealProject,
  type RealProject,
} from "./model";

const database = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => database.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    database.set(key, structuredClone(value));
  }),
}));
beforeAll(() => {
  if (!globalThis.crypto?.subtle)
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
});
beforeEach(() => {
  database.clear();
  vi.clearAllMocks();
});

const regions = (): pixels.LaneRegion[] => [
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
/** Exact plateaus give known local-background integrals, independent of the model. */
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
async function experimentProject(): Promise<RealProject> {
  let project = applyLaneDescription(
    createRealProject("Quantification test"),
    "NC,Treatment,marker",
  );
  const files = [1, 2, 3].flatMap((replicate, index) => [
    {
      name: `Protein_${replicate}.png`,
      bytes: png([40, 80, 60][index], [20, 60, 60][index], replicate),
    },
    { name: `tublin_${replicate}.png`, bytes: png(20, 20, replicate + 4) },
  ]);
  project = await importRealImages(project, files);
  for (const image of project.images)
    project = updateRealImage(project, image.id, { regions: regions() });
  return project;
}
function review(project: RealProject): RealProject {
  let next = updateRealProject(project, { designConfirmed: true });
  for (const image of [...next.images].sort((a, b) =>
    a.role === b.role ? 0 : a.role === "reference" ? -1 : 1,
  ))
    next = updateRealImage(next, image.id, { reviewed: true });
  return next;
}
async function rewrite(
  project: RealProject,
  change: (entries: Record<string, Uint8Array>) => void,
): Promise<Blob> {
  const archive = await exportRealProject(project);
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  change(entries);
  return new Blob([new Uint8Array(zipSync(entries)).buffer]);
}
function manifestChange(
  entries: Record<string, Uint8Array>,
  change: (value: any) => void,
): void {
  const parsed = JSON.parse(strFromU8(entries["manifest.json"]));
  change(parsed);
  entries["manifest.json"] = strToU8(JSON.stringify(parsed));
}

describe("real local pixel results and experimental units", () => {
  it("calculates within-experiment target/reference folds from original pixels and summarizes three independent experiments", async () => {
    const project = review(
      applyNormalization(await experimentProject(), {
        kind: "matched-control",
      }),
    );
    const rows = results(project);
    expect(rows).toHaveLength(6); // The trailing marker never becomes a measured sample.
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    expect(
      rows.filter((row) => row.sample === "NC").map((row) => row.fold),
    ).toEqual([1, 1, 1]);
    expect(
      rows.filter((row) => row.sample === "Treatment").map((row) => row.fold),
    ).toEqual([0.5, 0.75, 1]);
    expect(rows[0].targetNet).toBe(40 * 32);
    expect(rows[0].referenceNet).toBe(20 * 32);
    const summary = descriptiveStatistics(project).find(
      (row) => row.sample === "Treatment",
    )!;
    expect(summary).toMatchObject({
      protein: "Protein",
      n: 3,
      mean: 0.75,
      sd: 0.25,
      unitLabel: "independent experiments",
      status: "ready",
    });
  });

  it("keeps unconfirmed design and manual review as draft; filename numbers alone do not confirm independence", async () => {
    const project = await experimentProject();
    expect(project.designConfirmed).toBe(false);
    expect(project.images[1]).toMatchObject({
      role: "reference",
      protein: "Tubulin",
      replicate: "1",
      membrane: "M1",
    });
    expect(results(project).every((row) => row.status === "draft")).toBe(true);
    expect(descriptiveStatistics(project)[0]).toMatchObject({
      n: 3,
      unitLabel: "paired sets",
      status: "draft",
    });
    const altered = updateRealImage(review(project), project.images[0].id, {
      membrane: "different-membrane",
    });
    expect(altered.designConfirmed).toBe(false);
    expect(results(altered)[0].status).toBe("blocked");
  });

  it("blocks ambiguous exposures and excludes repeat measurements from independent n", async () => {
    let project = applyNormalization(await experimentProject(), {
      kind: "matched-control",
    });
    project = review(project);
    const original = project.images[0];
    const duplicate = {
      ...structuredClone(original),
      id: crypto.randomUUID(),
      exposure: "4s",
    };
    project = { ...project, images: [...project.images, duplicate] };
    expect(
      results(project)
        .filter((row) => row.replicate === "1")
        .every((row) => row.status === "blocked" && row.fold === null),
    ).toBe(true);
    expect(
      descriptiveStatistics(project).find((row) => row.sample === "Treatment")!
        .n,
    ).toBe(2);
    // Even distinct membrane pairs sharing the same declared experiment do not increase n.
    const paired = [project.images[0], project.images[1]].map((image) => ({
      ...image,
      id: crypto.randomUUID(),
      membrane: "second-membrane",
    }));
    project = {
      ...project,
      images: [...project.images.slice(0, 6), ...paired],
    };
    const stats = descriptiveStatistics(project).find(
      (row) => row.sample === "Treatment",
    )!;
    expect(stats.n).toBe(2);
    expect(stats.warning).toContain("Repeated measurements");
  });

  it("retains clipping warnings in reviewed results, summaries, and CSV", async () => {
    let project = await importRealImages(createRealProject(), [
      { name: "Protein1.png", bytes: png(40, 20, 1, true) },
      { name: "tub1.png", bytes: png(20, 20, 2) },
    ]);
    for (const image of project.images)
      project = updateRealImage(project, image.id, { regions: regions() });
    project = review(project);
    const treatment = results(project).find(
      (row) => row.sample === "Treatment",
    )!;
    expect(treatment.clippedFraction).toBe(1);
    expect(treatment.fold).not.toBeNull();
    expect(treatment.status).toBe("draft");
    expect(
      descriptiveStatistics(project).find((row) => row.sample === "Treatment")!
        .status,
    ).toBe("draft");
    expect(exportRealCsv(project)).toContain("DRAFT");
    expect(exportRealCsv(project)).toContain("Clipped");
    expect(exportRealCsv(project)).toContain("descriptive only");
  });

  it("uses canonical experiment IDs across distinct membranes and cannot turn whitespace into independent n", async () => {
    const original = await experimentProject();
    let project = { ...original, images: original.images.slice(0, 4) };
    for (const image of project.images.slice(2))
      project = updateRealImage(project, image.id, { replicate: "1 " });
    project = review(project);
    expect(new Set(results(project).map((row) => row.replicate))).toEqual(
      new Set(["1"]),
    );
    expect(descriptiveStatistics(project).map((summary) => summary.n)).toEqual([
      0, 0,
    ]);
    expect(
      descriptiveStatistics(project).every(
        (summary) => summary.status === "blocked",
      ),
    ).toBe(true);
    const restored = await importRealProject(await exportRealProject(project));
    expect(descriptiveStatistics(restored).map((summary) => summary.n)).toEqual(
      [0, 0],
    );
  });

  it("blocks nonpositive normalization and any background overlapping another lane's band", async () => {
    let project = await experimentProject();
    const modified = regions();
    modified[0].background = { ...modified[1].band };
    project = updateRealImage(project, project.images[0].id, {
      regions: modified,
    });
    expect(results(project)[0]).toMatchObject({
      status: "blocked",
      fold: null,
    });
    expect(results(project)[0].warnings.join(" ")).toContain("overlaps");
    modified[0].background = { ...modified[0].band };
    project = updateRealImage(project, project.images[0].id, {
      regions: modified,
    });
    expect(() => results(project)).not.toThrow();
    expect(results(project)[0]).toMatchObject({
      status: "blocked",
      fold: null,
    });
    const noSignal = regions();
    noSignal[1].band.y = 12; // A flat-background region, not a band.
    project = updateRealImage(project, project.images[0].id, {
      regions: noSignal,
    });
    expect(results(project)[1]).toMatchObject({
      targetNet: 0,
      ratio: null,
      fold: null,
      status: "blocked",
    });
    const summaries = descriptiveStatistics(project);
    expect(summaries.map((summary) => summary.n)).toEqual([2, 2]);
    expect(summaries.map((summary) => summary.replicates)).toEqual([
      ["2", "3"],
      ["2", "3"],
    ]);
    expect(summaries[0].warning).toContain("Incomplete");
  });

  it("uses the explicitly labelled control lane rather than the first lane", async () => {
    const project = applyLaneDescription(
      await experimentProject(),
      "Treatment,NC,marker",
    );
    const row = results(review(project)).find(
      (entry) => entry.replicate === "1" && entry.sample === "Treatment",
    )!;
    expect(row.fold).toBe(2);
  });

  it("blocks overlapping measured bands while allowing shared background rectangles", async () => {
    let project = applyNormalization(await experimentProject(), {
      kind: "matched-control",
    });
    const overlapping = regions();
    overlapping[1].band = { ...overlapping[0].band };
    project = updateRealImage(project, project.images[0].id, {
      regions: overlapping,
    });
    expect(results(project)[0].status).toBe("blocked");
    expect(results(project)[0].warnings.join(" ")).toContain(
      "count pixels twice",
    );
    const sharedBackground = regions();
    sharedBackground[1].background = { ...sharedBackground[0].background };
    project = review(
      updateRealImage(project, project.images[0].id, {
        regions: sharedBackground,
      }),
    );
    expect(results(project)[0].status).toBe("ready");
  });

  it("allows reviewed automatic candidates while retaining method information and consequential warnings", async () => {
    let project = applyNormalization(await experimentProject(), {
      kind: "matched-control",
    });
    for (const image of project.images)
      project = updateRealImage(project, image.id, {
        regions: regions().map((region) => ({
          ...region,
          source: "automatic",
        })),
      });
    expect(results(project)[0].warnings.join(" ")).toContain(
      "CANDIDATES_REQUIRE_REVIEW",
    );
    project = review(project);
    expect(results(project).every((row) => row.status === "ready")).toBe(true);
    expect(results(project)[0].warnings.join(" ")).not.toContain(
      "CANDIDATES_REQUIRE_REVIEW",
    );
    const withWarning = updateRealImage(project, project.images[0].id, {
      regions: regions().map((region) => ({
        ...region,
        warnings: ["LOW_LANE_SEPARATION"],
      })),
    });
    expect(results(review(withWarning))[0].status).toBe("draft");
    expect(
      (await importRealProject(await exportRealProject(withWarning))).images[0]
        .regions[0].warnings,
    ).toEqual(["LOW_LANE_SEPARATION"]);
  });

  it("retains RGB/opaque-alpha method notes without equating them with clipping warnings", async () => {
    const rgba = (source: Uint8Array) => {
      const raster = pixels.decodeRaster(source, "fixture.png");
      const data = new Uint8Array(raster.width * raster.height * 4);
      for (let index = 0; index < raster.pixels.length; index++) {
        data.set(
          [
            raster.pixels[index],
            raster.pixels[index],
            raster.pixels[index],
            255,
          ],
          index * 4,
        );
      }
      return encode({
        width: raster.width,
        height: raster.height,
        data,
        channels: 4,
        depth: 8,
      });
    };
    let project = await importRealImages(createRealProject(), [
      { name: "Protein1.png", bytes: rgba(png(40, 20, 1)) },
      { name: "tub1.png", bytes: rgba(png(20, 20, 2)) },
    ]);
    for (const image of project.images)
      project = updateRealImage(project, image.id, { regions: regions() });
    project = applyNormalization(project, { kind: "matched-control" });
    project = review(project);
    expect(results(project)[0].status).toBe("ready");
    expect(results(project)[0].warnings).toContain("RGB_MEAN_INTENSITY");
    expect(results(project)[0].warnings).toContain("OPAQUE_ALPHA_IGNORED");
    expect(descriptiveStatistics(project)[0].status).toBe("ready");
  });

  it("keeps different proteins in separate summaries", async () => {
    const project = review(await experimentProject());
    const additional = {
      ...project.images[0],
      id: crypto.randomUUID(),
      protein: "AnotherProtein",
    };
    const multi = { ...project, images: [...project.images, additional] };
    expect(
      descriptiveStatistics(multi, "Protein").find(
        (row) => row.sample === "Treatment",
      )!.n,
    ).toBe(3);
    expect(
      descriptiveStatistics(multi, "AnotherProtein").find(
        (row) => row.sample === "Treatment",
      )!.n,
    ).toBe(1);
  });
});

describe("lane descriptions, analysis history, and batch proposals", () => {
  it("parses bounded Chinese/English numbered descriptions and refuses uncertain or duplicate lane mappings", () => {
    const project = createRealProject();
    expect(
      applyLaneDescription(
        project,
        "第一条NC，第二条Treatment，第三条marker（排除）",
      ).laneLabels,
    ).toEqual(["NC", "Treatment", "marker（排除）"]);
    expect(
      applyLaneDescription(
        project,
        "lane 1 NC, lane 2 Treatment, lane 3 marker excluded",
      ).laneLabels,
    ).toEqual(["NC", "Treatment", "marker excluded"]);
    expect(
      applyLaneDescription(project, "1=NC;2=Treatment;3=marker").laneLabels,
    ).toEqual(["NC", "Treatment", "marker"]);
    expect(() => applyLaneDescription(project, "1=NC;3=Treatment")).toThrow();
    expect(() =>
      applyLaneDescription(project, "NC,Treatment,Treatment"),
    ).toThrow();
    expect(() =>
      applyLaneDescription(
        project,
        "the left band is a control and everything else is treatment",
      ),
    ).toThrow();
    expect(createRealProject().targetLabel).toBe("Target");
  });

  it("retains original bytes and isolated ROI snapshots, invalidates dependent target review, and ignores no-op edits", async () => {
    const original = review(await experimentProject());
    const reference = original.images[1];
    const changedRegions = regions();
    changedRegions[0].band.x += 1;
    const changed = updateRealImage(original, reference.id, {
      regions: changedRegions,
    });
    expect(changed.images[0].reviewed).toBe(false);
    expect(changed.images[1].reviewed).toBe(false);
    expect(original.images[0].reviewed).toBe(true);
    expect(original.images[1].regions[0].band.x).toBe(2);
    expect(changed.images[1].history.at(-1)!.regions[0].band.x).toBe(2);
    changedRegions[0].band.x = 99;
    expect(changed.images[1].regions[0].band.x).toBe(3);
    expect(changed.images[1].bytes).toBe(original.images[1].bytes);
    expect(
      updateRealImage(changed, reference.id, { note: changed.images[1].note }),
    ).toBe(changed);
    expect(() =>
      updateRealImage(changed, reference.id, {
        bytes: new Uint8Array(),
      } as any),
    ).toThrow();
    expect(() =>
      updateRealImage(changed, reference.id, {
        regions: [
          { ...regions()[0], band: { x: 999, y: 0, width: 1, height: 1 } },
        ],
      }),
    ).toThrow();
  });

  it.each([
    "Image is too small to propose band and background ROIs.",
    "No band row has sufficient contrast; select ROIs manually.",
    "Multiple comparable band rows are ambiguous; select ROIs manually.",
    "Fewer resolved lanes than requested; overlapping or weak bands need manual ROIs.",
    "A requested lane has no resolvable band; overlapping or empty lanes need manual ROIs.",
    "Insufficient adjacent background space; select band/background ROIs manually.",
  ])("keeps the safe proposal failure actionable: %s", async (message) => {
    const original = await experimentProject();
    const spy = vi.spyOn(pixels, "proposeRegions").mockImplementation(() => {
      throw new Error(message);
    });
    try {
      const next = analyzeAll(original, true);
      expect(next.images.map((image) => image.analysisError)).toEqual(
        original.images.map(() => message),
      );
      expect(next.images.map((image) => image.regions)).toEqual(
        original.images.map((image) => image.regions),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("proposes only active trailing lanes, preserves manual ROIs, and isolates one image's proposal failure", async () => {
    let original = await experimentProject();
    for (const image of original.images.slice(1))
      original = updateRealImage(original, image.id, {
        regions: regions().map((region) =>
          region.lane === 2 ? { ...region, source: "automatic" } : region,
        ),
      });
    let calls = 0;
    const spy = vi
      .spyOn(pixels, "proposeRegions")
      .mockImplementation((_raster, laneCount) => {
        expect(laneCount).toBe(2);
        calls++;
        if (calls === 1)
          throw new Error("private upstream exception must not be stored");
        return regions().map((region) => ({
          ...region,
          source: "automatic",
          band: { ...region.band, y: 7 },
        }));
      });
    try {
      const preserved = analyzeAll(original);
      expect(calls).toBe(5);
      expect(preserved.images[0].regions[0].band.y).toBe(6);
      expect(preserved.images[1].regions).toEqual(original.images[1].regions);
      expect(preserved.images[1].analysisError).toContain(
        "Automatic proposal failed",
      );
      expect(preserved.images[1].analysisError).not.toContain(
        "private upstream",
      );
      const forced = analyzeAll(original, true);
      expect(forced.images[0].regions[0].band.y).toBe(7);
      expect(forced.images[0].regions[0].source).toBe("automatic");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("real project archives and persistence", () => {
  it("checks the aggregate pixel budget before allocating another decoded image", async () => {
    const header = vi
      .spyOn(pixels, "inspectRasterDimensions")
      .mockReturnValue({ width: 4096, height: 2048 });
    const decoder = vi.spyOn(pixels, "decodeRaster").mockReturnValue({
      width: 4096,
      height: 2048,
      bitDepth: 8,
      channels: 1,
      pixels: new Float64Array(),
      max: 255,
      format: "PNG",
      warnings: [],
    });
    try {
      const files = [1, 2, 3, 4, 5].map((seed) => ({
        name: `Protein${seed}.png`,
        bytes: png(40, 20, seed),
      }));
      await expect(
        importRealImages(createRealProject(), files),
      ).rejects.toThrow(/32 megapixels/);
      expect(decoder).toHaveBeenCalledTimes(4);
    } finally {
      header.mockRestore();
      decoder.mockRestore();
    }
  });

  it("round-trips untouched original bytes, analysis revisions, and draft warnings in its own archive format", async () => {
    let project = await experimentProject();
    project = updateRealImage(project, project.images[0].id, {
      note: "Original ROI reviewed later",
    });
    const restored = await importRealProject(await exportRealProject(project));
    expect(restored).toEqual(project);
    expect(restored.images[0].bytes).toEqual(project.images[0].bytes);
    expect(results(restored)).toEqual(results(project));
    const keys = Object.keys(
      unzipSync(
        new Uint8Array(await (await exportRealProject(project)).arrayBuffer()),
      ),
    );
    expect(keys).toContain("manifest.json");
    expect(keys.filter((key) => key.startsWith("originals/"))).toHaveLength(6);
  });

  it("rejects modified original bytes, duplicate originals, invalid schemas, traversal, and prototype pollution", async () => {
    const project = await experimentProject();
    await expect(
      importRealImages(project, [
        { name: "same-again.png", bytes: project.images[0].bytes },
      ]),
    ).rejects.toThrow(/Duplicate/);
    const cases: ((entries: Record<string, Uint8Array>) => void)[] = [
      (entries) =>
        manifestChange(entries, (manifest) => {
          manifest.images[0].hash = "0".repeat(64);
        }),
      (entries) =>
        manifestChange(entries, (manifest) => {
          manifest.images[0].regions[0].band.x = 9999;
        }),
      (entries) =>
        manifestChange(entries, (manifest) => {
          manifest.images[0].remoteUrl = "https://example.com/private.png";
        }),
      (entries) =>
        manifestChange(entries, (manifest) => {
          manifest.images[0].history[0].revision = 999;
        }),
      (entries) => {
        entries["../outside.png"] = new Uint8Array([1]);
      },
      (entries) => {
        entries["manifest.json"] = strToU8(
          strFromU8(entries["manifest.json"]).replace(
            '{"format":',
            '{"__proto__":{"polluted":true},"format":',
          ),
        );
      },
    ];
    for (const change of cases)
      await expect(
        importRealProject(await rewrite(project, change)),
      ).rejects.toThrow();
    const tampered = structuredClone(project);
    tampered.images[0].bytes[tampered.images[0].bytes.length - 1] ^= 1;
    await expect(exportRealProject(tampered)).rejects.toThrow(/checksum/);
    await expect(
      importRealProject(new Blob([new Uint8Array([1, 2, 3])])),
    ).rejects.toThrow();
  });

  it("escapes spreadsheet formulas while preserving explicit draft and blocked records", async () => {
    let project = await experimentProject();
    project = { ...project, laneLabels: ["NC", "=2+2", "marker"] };
    const csv = exportRealCsv(project);
    expect(csv).toContain('"\'=2+2"');
    expect(csv).toContain('"DRAFT"');
    expect(csv).toContain('"source_bit_depth"');
    expect(csv).toContain('"reference_sha256"');
    expect(csv).toContain('"control_reference_background_roi_json"');
    project = updateRealImage(project, project.images[0].id, {
      membrane: "unpaired",
    });
    expect(exportRealCsv(project)).toContain('"BLOCKED"');
  });

  it("exports negative measured numbers without a spreadsheet text prefix", async () => {
    let project = await experimentProject();
    project = updateRealImage(project, project.images[0].id, {
      signal: "light",
    });
    const row = results(project).find(
      (entry) => entry.imageId === project.images[0].id && entry.lane === 1,
    )!;
    expect(row.targetNet).toBe(-1280);
    expect(row.status).toBe("blocked");
    const csv = exportRealCsv(project);
    expect(csv).toContain('"-1280"');
    expect(csv).not.toContain('"\'-1280"');
  });

  it("snapshots pending saves, serializes writes, and uses storage separate from the synthetic demo", async () => {
    const first = createRealProject("first");
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(set).mockImplementationOnce(async (key, value) => {
      started();
      await gate;
      database.set(String(key), structuredClone(value));
    });
    const firstSave = saveRealProject(first);
    await began;
    first.name = "mutated after scheduling";
    const secondSave = saveRealProject(createRealProject("second"));
    expect(vi.mocked(set).mock.calls).toHaveLength(1);
    release();
    await Promise.all([firstSave, secondSave]);
    expect((vi.mocked(set).mock.calls[0][1] as RealProject).name).toBe("first");
    expect((await loadRealProject())!.name).toBe("second");
    expect([...database.keys()]).toEqual(["blot-workbench-real-project-v1"]);
  });
});

function tissueRegions(): pixels.LaneRegion[] {
  return Array.from({ length: 10 }, (_, index) => ({
    lane: index + 1,
    band: { x: 2 + index * 12, y: 6, width: 8, height: 4 },
    background: { x: 2 + index * 12, y: 16, width: 8, height: 4 },
    source: "manual",
  }));
}
function tissuePng(signals: number[], seed: number): Uint8Array {
  const width = 122,
    height = 24;
  const data = new Uint8Array(width * height).fill(220 + seed);
  for (const [index, region] of tissueRegions().entries())
    for (let y = region.band.y; y < region.band.y + region.band.height; y++)
      for (let x = region.band.x; x < region.band.x + region.band.width; x++)
        data[y * width + x] -= signals[index];
  return encode({ width, height, data, channels: 1, depth: 8 });
}
async function tissueProject(): Promise<RealProject> {
  let project = createRealProject("Synthetic individual pairs", "en");
  project = applyPairedDesign(
    project,
    ["SetA", "SetB"].flatMap((groupId, groupIndex) =>
      Array.from({ length: 5 }, (_, pairIndex) => ({
        groupId,
        unitId: `P${groupIndex * 5 + pairIndex + 1}`,
        normalLane: pairIndex * 2 + 1,
        tumorLane: pairIndex * 2 + 2,
      })),
    ),
  );
  const signals = [40, 20, 50, 50, 60, 90, 80, 40, 40, 80];
  project = await importRealImages(
    project,
    [0, 1].flatMap((index) => [
      { name: `Target_${index + 1}.png`, bytes: tissuePng(signals, index) },
      {
        name: `reference_${index + 1}.png`,
        bytes: tissuePng(Array(10).fill(20), index + 4),
      },
    ]),
  );
  for (const [index, image] of project.images.entries()) {
    project = updateRealImage(project, image.id, {
      protein: image.role === "target" ? "Target" : "Reference",
      replicate: index < 2 ? "SetA" : "SetB",
      membrane: index < 2 ? "MembraneA" : "MembraneB",
      regions: tissueRegions(),
    });
  }
  return review(project);
}

describe("explicit individual pairing and shared reference normalization", () => {
  it("counts ten explicitly distinct individuals across two source groups, with each T normalized to its own N", async () => {
    const project = applyNormalization(await tissueProject(), {
      kind: "matched-control",
    });
    const rows = results(project);
    expect(rows).toHaveLength(20);
    expect(
      rows.filter((row) => row.sample === "N").map((row) => row.fold),
    ).toEqual(Array(10).fill(1));
    expect(
      rows.filter((row) => row.sample === "T").map((row) => row.fold),
    ).toEqual([0.5, 1, 1.5, 0.5, 2, 0.5, 1, 1.5, 0.5, 2]);
    expect(
      rows.find((row) => row.unitId === "P3" && row.sample === "T"),
    ).toMatchObject({ lane: 6, controlLane: 5, replicate: "SetA" });
    expect(
      descriptiveStatistics(project).map((row) => [
        row.sample,
        row.n,
        row.unitLabel,
      ]),
    ).toEqual([
      ["N", 10, "individuals"],
      ["T", 10, "individuals"],
    ]);
    expect(descriptiveStatistics(project)[1].mean).toBe(1.1);
    const restored = await importRealProject(await exportRealProject(project));
    expect(restored.pairedDesign).toEqual(project.pairedDesign);
    expect(results(restored)).toEqual(rows);
    expect(exportRealCsv(restored)).toContain('"individual_id"');
  });

  it("omits both rows of an individual with missing normal regions, without reducing other patients", async () => {
    let project = await tissueProject();
    project = updateRealImage(project, project.images[0].id, {
      regions: tissueRegions().filter((region) => region.lane !== 3),
    });
    expect(
      results(project)
        .filter((row) => row.unitId === "P2")
        .every((row) => row.status === "blocked" && row.fold === null),
    ).toBe(true);
    expect(descriptiveStatistics(project).map((row) => row.n)).toEqual([9, 9]);
    expect(descriptiveStatistics(project)[0].replicates).not.toContain("P2");
  });

  it("canonicalizes IDs and never counts repeated individuals across groups as new n", async () => {
    let project = applyNormalization(await tissueProject(), {
      kind: "matched-control",
    });
    const pairs = project.pairedDesign!.pairs.map((pair) =>
      pair.unitId === "P6"
        ? { ...pair, groupId: " SetB ", unitId: " P1 " }
        : pair,
    );
    project = review(applyPairedDesign(project, pairs));
    expect(project.pairedDesign!.pairs[5].unitId).toBe("P1");
    expect(descriptiveStatistics(project).map((row) => row.n)).toEqual([8, 8]);
    expect(descriptiveStatistics(project)[0].warnings.join(" ")).toContain(
      "Repeated measurements of one individual",
    );
    expect(() =>
      applyPairedDesign(project, [pairs[0], { ...pairs[1], unitId: " P1 " }]),
    ).toThrow(/Duplicate individual/);
    expect(() =>
      applyPairedDesign(project, [pairs[0], { ...pairs[1], normalLane: 1 }]),
    ).toThrow(/multiple pairs/);
    expect(() =>
      applyPairedDesign(project, [{ ...pairs[0], tumorLane: 1 }]),
    ).toThrow(/must differ/);
  });

  it("preserves control variation when all three experiments use the first control as a shared baseline", async () => {
    let project = review(await experimentProject());
    project = applyNormalization(project, {
      kind: "reference-unit",
      unitId: " 1 ",
    });
    const rows = results(project);
    expect(
      rows.filter((row) => row.sample === "NC").map((row) => row.fold),
    ).toEqual([1, 2, 1.5]);
    expect(
      rows.filter((row) => row.sample === "Treatment").map((row) => row.fold),
    ).toEqual([0.5, 1.5, 1.5]);
    expect(
      rows.every((row) => row.status === "draft" && row.baselineUnitId === "1"),
    ).toBe(true);
    expect(rows[0].warnings.join(" ")).toContain("comparability is unverified");
    expect(descriptiveStatistics(project)[0]).toMatchObject({
      n: 3,
      mean: 1.5,
      sd: 0.5,
    });
    expect(exportRealCsv(project)).toContain('"reference-unit"');
    expect(
      (await importRealProject(await exportRealProject(project))).normalization,
    ).toEqual({ kind: "reference-unit", unitId: "1" });
    const matched = applyNormalization(project, { kind: "matched-control" });
    expect(
      results(matched)
        .filter((row) => row.sample === "NC")
        .map((row) => row.fold),
    ).toEqual([1, 1, 1]);
  });

  it("defaults new projects to the first control as a shared baseline without an explicit choice", async () => {
    const project = review(await experimentProject());
    expect(project.normalization).toBeUndefined();
    expect(project.normalizationPreference).toBe("reference-unit");
    const rows = results(project);
    expect(
      rows.filter((row) => row.sample === "NC").map((row) => row.fold),
    ).toEqual([1, 2, 1.5]);
    expect(
      rows.filter((row) => row.sample === "Treatment").map((row) => row.fold),
    ).toEqual([0.5, 1.5, 1.5]);
    expect(
      rows.every((row) => row.normalizationKind === "reference-unit"),
    ).toBe(true);
    expect(exportRealCsv(project)).toContain('"reference-unit"');
    const restored = await importRealProject(await exportRealProject(project));
    expect(restored.normalizationPreference).toBe("reference-unit");
    expect(results(restored)).toEqual(rows);
  });

  it("keeps archives without a normalization preference on matched-control", async () => {
    const project = review(await experimentProject());
    const legacy = await importRealProject(
      await rewrite(project, (entries) =>
        manifestChange(entries, (value) => {
          delete value.normalizationPreference;
        }),
      ),
    );
    expect(legacy.normalizationPreference).toBeUndefined();
    expect(
      results(legacy)
        .filter((row) => row.sample === "NC")
        .map((row) => row.fold),
    ).toEqual([1, 1, 1]);
  });

  it("blocks missing or ambiguous reference-unit controls instead of silently falling back", async () => {
    let project = review(await experimentProject());
    project = applyNormalization(project, {
      kind: "reference-unit",
      unitId: "missing",
    });
    expect(
      results(project).every(
        (row) => row.status === "blocked" && row.fold === null,
      ),
    ).toBe(true);
    expect(descriptiveStatistics(project).map((row) => row.n)).toEqual([0, 0]);
    project = applyNormalization(project, {
      kind: "reference-unit",
      unitId: "1",
    });
    const duplicates = project.images.slice(0, 2).map((image) => ({
      ...image,
      id: crypto.randomUUID(),
      membrane: "AnotherMembrane",
    }));
    project = { ...project, images: [...project.images, ...duplicates] };
    expect(results(project).every((row) => row.status === "blocked")).toBe(
      true,
    );
  });

  it("keeps protein-specific baselines and patient identities separate", async () => {
    let project = await tissueProject();
    const secondProtein = project.images
      .filter((image) => image.role === "target")
      .map((image) => ({
        ...image,
        id: crypto.randomUUID(),
        protein: "OtherTarget",
      }));
    project = applyNormalization(
      { ...project, images: [...project.images, ...secondProtein] },
      { kind: "reference-unit", unitId: "P1" },
    );
    expect(descriptiveStatistics(project)).toHaveLength(4);
    expect(descriptiveStatistics(project).every((row) => row.n === 10)).toBe(
      true,
    );
    expect(
      results(project).every(
        (row) =>
          project.images.find((image) => image.id === row.baselineImageId)
            ?.protein === row.protein,
      ),
    ).toBe(true);
  });

  it("validates paired archives, keeps legacy archives readable, and does not trust synthetic badges from imported files", async () => {
    const project = await tissueProject();
    const invalid = await rewrite(project, (entries) =>
      manifestChange(entries, (value) => {
        value.pairedDesign.pairs[1].normalLane = 1;
      }),
    );
    await expect(importRealProject(invalid)).rejects.toThrow(/multiple pairs/);
    const legacy = await experimentProject();
    expect(
      (await importRealProject(await exportRealProject(legacy))).pairedDesign,
    ).toBeUndefined();
    const bundled = updateRealProject(project, {
      exampleKind: "synthetic",
      statisticalTest: "paired-t",
    });
    await saveRealProject(bundled);
    expect((await loadRealProject())?.exampleKind).toBe("synthetic");
    const restored = await importRealProject(await exportRealProject(bundled));
    expect(restored.exampleKind).toBeUndefined();
    expect(restored.statisticalTest).toBe("paired-t");
    const shared = applyPairedDesign(project, null);
    expect(shared.pairedDesign).toBeUndefined();
    expect(shared.laneLabels).toEqual(["NC", "Treatment", "marker"]);
    expect(shared.designConfirmed).toBe(false);
  });
});

describe("explicit paired inference on original normalized signals", () => {
  it("uses the same raw target/reference inputs under matched or shared plot normalization", async () => {
    let project = applyNormalization(review(await experimentProject()), {
      kind: "matched-control",
    });
    expect(realPairedTests(project)[0]).toMatchObject({
      status: "unavailable",
      result: null,
      reason: "test-disabled",
    });
    project = updateRealProject(project, { statisticalTest: "paired-t" });
    const matched = realPairedTests(project)[0];
    expect(matched).toMatchObject({
      status: "ok",
      quality: "draft",
      reason: "",
      result: {
        n: 3,
        df: 2,
        method: "paired-t",
        inputBasis: "target/reference",
      },
    });
    expect(matched.result!.meanDifference).toBeCloseTo(-2 / 3, 12);
    expect(matched.result!.t).toBeCloseTo(-2, 12);
    expect(matched.result!.pValue).toBeCloseTo(1 - 2 / Math.sqrt(6), 10);
    project = applyNormalization(project, {
      kind: "reference-unit",
      unitId: "1",
    });
    const shared = realPairedTests(project)[0];
    expect(shared.result).toEqual(matched.result);
    expect(shared.quality).toBe("draft");
    expect(shared.warnings.join(" ")).toContain("comparability is unverified");
    expect(
      results(project)
        .filter((row) => row.sample === "NC")
        .map((row) => row.fold),
    ).toEqual([1, 2, 1.5]);
    const csv = exportRealStatisticsCsv(project);
    expect(csv).toContain('"p_value_unadjusted"');
    expect(csv).toContain('"target/reference"');
    expect(csv).toContain('"reference-unit"');
    expect(csv).toContain(String(matched.result!.pValue));
    expect(csv).toContain('"DRAFT"');
  });

  it("requires confirmed independence and exactly two groups before computing a test", async () => {
    let project = updateRealProject(await experimentProject(), {
      statisticalTest: "paired-t",
    });
    expect(realPairedTests(project)[0]).toMatchObject({
      result: null,
      status: "unavailable",
      reason: "design-unconfirmed",
    });
    project = applyLaneDescription(project, "NC,Treatment,Other");
    project = updateRealProject(review(project), {
      statisticalTest: "paired-t",
    });
    expect(realPairedTests(project)[0]).toMatchObject({
      result: null,
      status: "unavailable",
      reason: "requires-two-conditions",
    });
    project = review(await experimentProject());
    project = updateRealProject(
      { ...project, images: project.images.slice(0, 2) },
      { statisticalTest: "paired-t" },
    );
    expect(realPairedTests(project)[0]).toMatchObject({
      status: "unavailable",
      reason: "insufficient-pairs",
      result: { n: 1, pValue: null },
    });
  });

  it("uses the same complete unique individual pairs for bars and tests", async () => {
    let project = updateRealProject(
      applyNormalization(await tissueProject(), { kind: "matched-control" }),
      { statisticalTest: "paired-t" },
    );
    expect(realPairedTests(project)[0].result?.n).toBe(10);
    project = updateRealImage(project, project.images[0].id, {
      regions: tissueRegions().filter((region) => region.lane !== 3),
    });
    const missing = realPairedTests(project)[0];
    expect(missing.result?.n).toBe(9);
    expect(missing.result?.ids).toEqual(
      descriptiveStatistics(project)[0].replicates,
    );
    expect(missing.result?.ids).not.toContain("P2");
    project = applyPairedDesign(
      project,
      project.pairedDesign!.pairs.map((pair) =>
        pair.unitId === "P6" ? { ...pair, unitId: "P1" } : pair,
      ),
    );
    project = updateRealProject(review(project), {
      statisticalTest: "paired-t",
    });
    const duplicate = realPairedTests(project)[0];
    expect(duplicate.result?.n).toBe(7);
    expect(duplicate.result?.ids).not.toContain("P1");
    expect(duplicate.result?.ids).toEqual(
      descriptiveStatistics(project)[1].replicates,
    );
    expect(duplicate.quality).toBe("draft");
    expect(duplicate.warnings.join(" ")).toContain(
      "Repeated measurements of one individual",
    );
  });
});

describe("inference scale warnings and reproducible statistical export", () => {
  it("warns about pooled membrane scales independently of plot normalization", async () => {
    const project = updateRealProject(
      review(
        applyNormalization(await experimentProject(), {
          kind: "matched-control",
        }),
      ),
      { statisticalTest: "paired-t" },
    );
    expect(project.normalization).toEqual({ kind: "matched-control" });
    expect(results(project).every((row) => row.status === "ready")).toBe(true);
    const inference = realPairedTests(project)[0];
    expect(inference.quality).toBe("draft");
    expect(inference.warnings.join(" ")).toContain(
      "comparable scales have not been established",
    );
    expect(exportRealStatisticsCsv(project)).toContain(
      "comparable scales have not been established",
    );
    // Five patients measured within one source image pair do not imply cross-membrane pooling.
    const tissue = review(
      applyNormalization(await tissueProject(), { kind: "matched-control" }),
    );
    const singleMembrane = updateRealProject(
      { ...tissue, images: tissue.images.slice(0, 2) },
      { statisticalTest: "paired-t" },
    );
    expect(realPairedTests(singleMembrane)[0]).toMatchObject({
      quality: "ready",
      result: { n: 5 },
    });
    expect(realPairedTests(singleMembrane)[0].warnings.join(" ")).not.toContain(
      "comparable scales",
    );
  });

  it("exports exact paired inputs, provenance, versions and timestamps sufficient to reproduce the reported test", async () => {
    const project = updateRealProject(review(await experimentProject()), {
      statisticalTest: "paired-t",
    });
    const test = realPairedTests(project)[0];
    expect(
      test.inputPairs.map(({ id, control, treatment }) => ({
        id,
        control,
        treatment,
      })),
    ).toEqual([
      { id: "1", control: 2, treatment: 1 },
      { id: "2", control: 4, treatment: 3 },
      { id: "3", control: 3, treatment: 3 },
    ]);
    expect(pairedTTest(test.inputPairs)).toEqual(test.result);
    const input = test.inputPairs[0];
    expect(input.controlSource).toMatchObject({
      imageId: project.images[0].id,
      imageSha256: project.images[0].hash,
      analysisRevision: project.images[0].revision,
      referenceImageId: project.images[1].id,
      referenceSha256: project.images[1].hash,
      referenceRevision: project.images[1].revision,
      lane: 1,
    });
    expect(input.treatmentSource.lane).toBe(2);
    const csv = exportRealStatisticsCsv(project);
    expect(csv).toContain('"exact_input_pairs_and_provenance_json"');
    expect(csv).toContain(
      JSON.stringify(test.inputPairs).replaceAll('"', '""'),
    );
    expect(csv).toContain(`"${APP_VERSION}"`);
    expect(csv).toContain(`"${project.updatedAt}"`);
    expect(csv).toContain('"exported_at_utc"');
    const changed = updateRealImage(project, project.images[0].id, {
      note: "Reviewed source provenance",
    });
    expect(
      realPairedTests(changed)[0].inputPairs[0].controlSource.analysisRevision,
    ).toBeGreaterThan(input.controlSource.analysisRevision);
    expect(realPairedTests(changed)[0].result).toEqual(test.result);
  });
});

describe("rolling-ball background method", () => {
  it("validates the correction, invalidates review once, and round-trips archives", async () => {
    const project = review(await experimentProject());
    expect(() =>
      updateRealProject(project, {
        backgroundCorrection: { kind: "rolling-ball", radius: 9 },
      }),
    ).toThrow();
    expect(() =>
      updateRealProject(project, {
        backgroundCorrection: { kind: "rolling-ball", radius: 201 },
      }),
    ).toThrow();
    const changed = updateRealProject(project, {
      backgroundCorrection: { kind: "rolling-ball", radius: 50 },
    });
    expect(changed.backgroundCorrection).toEqual({
      kind: "rolling-ball",
      radius: 50,
    });
    expect(changed.images.every((image) => !image.reviewed)).toBe(true);
    // Re-applying the identical policy must not reset review again.
    const stable = updateRealProject(review(changed), {
      backgroundCorrection: { kind: "rolling-ball", radius: 50 },
    });
    expect(stable.images.every((image) => image.reviewed)).toBe(true);
    const archive = await exportRealProject(
      updateRealProject(await experimentProject(), {
        backgroundCorrection: { kind: "rolling-ball", radius: 25 },
      }),
    );
    const restored = await importRealProject(archive);
    expect(restored.backgroundCorrection).toEqual({
      kind: "rolling-ball",
      radius: 25,
    });
  });

  it("measures through the rolling-ball engine and labels rows and CSV", async () => {
    const local = review(
      applyNormalization(await experimentProject(), {
        kind: "matched-control",
      }),
    );
    const rolling = review(
      applyNormalization(
        updateRealProject(await experimentProject(), {
          backgroundCorrection: { kind: "rolling-ball", radius: 50 },
        }),
        { kind: "matched-control" },
      ),
    );
    const localRows = results(local);
    const rollingRows = results(rolling);
    expect(rollingRows.length).toBe(localRows.length);
    expect(
      rollingRows.every(
        (row) =>
          row.backgroundMethod === "rolling-ball" &&
          row.rollingBallRadius === 50,
      ),
    ).toBe(true);
    expect(
      localRows.every(
        (row) => row.backgroundMethod === "local" && row.rollingBallRadius === null,
      ),
    ).toBe(true);
    // The plateau fixture bridges completely: rolling-ball nets match the
    // local-mean nets within the per-pixel quantization budget.
    for (const [index, row] of rollingRows.entries()) {
      const reference = localRows[index];
      expect(Math.abs(row.targetNet! - reference.targetNet!)).toBeLessThanOrEqual(
        row.area!,
      );
      expect(
        Math.abs(row.referenceNet! - reference.referenceNet!),
      ).toBeLessThanOrEqual(row.area!);
      expect(row.status).toBe("ready");
    }
    const csv = exportRealCsv(rolling);
    expect(csv).toContain("background_method");
    expect(csv).toContain("rolling_ball_radius");
    expect(csv).toContain("rolling-ball");
    expect(csv).toContain("imagej1-rolling-ball-1");
    const localCsv = exportRealCsv(local);
    expect(localCsv).toContain("local");
  });
});
