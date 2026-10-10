import { beforeAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { strFromU8, strToU8, unzlibSync, unzipSync, zipSync } from "fflate";
import type { Project } from "./types";
import {
  applyTemplate,
  createEmptyProject,
  createExampleProject,
  editTemplate,
  exportCsv,
  exportProject,
  getMeasurements,
  importProject,
  restoreExampleAnalysis,
  updateAnalysis,
  updateRoi,
  updateSample,
} from "./index";
import { fromBase64 } from "./fixtures";

beforeAll(() => {
  if (!globalThis.crypto?.subtle)
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
});
let example: Project;
beforeAll(async () => {
  example = await createExampleProject();
});
const fresh = () => structuredClone(example);
const analysis = (project: Project, id = "a-target-1000") =>
  project.analyses.find((item) => item.imageId === id)!;

async function rewriteArchive(
  project: Project,
  change: (entries: Record<string, Uint8Array>) => void,
): Promise<Blob> {
  const zip = await exportProject(project);
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  change(entries);
  return new Blob([new Uint8Array(zipSync(entries)).buffer]);
}
function mutateManifest(
  entries: Record<string, Uint8Array>,
  change: (manifest: Record<string, any>) => void,
): void {
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as Record<
    string,
    any
  >;
  change(manifest);
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
}

describe("synthetic fixture and experimental units", () => {
  it("keeps six independent units despite eight images, two dates and two exposures", () => {
    const project = fresh();
    expect(project.images).toHaveLength(8);
    expect(project.batches).toHaveLength(2);
    expect(
      new Set(project.samples.map((sample) => sample.experimentalUnitId)).size,
    ).toBe(6);
    expect(project.lanes.map((lane) => lane.sampleId)).toEqual(
      project.samples.map((sample) => sample.id),
    );
    expect(getMeasurements(project, "a-target-1000")).toHaveLength(6);
    expect(getMeasurements(project, "a-target-4000")).toEqual([]); // Saturated example is explicitly excluded.
    project.batches[0].date = "2026-10-01";
    expect(
      new Set(project.samples.map((sample) => sample.experimentalUnitId)).size,
    ).toBe(6);
  });
  it("encodes a real grayscale PNG whose synthetic pixels agree with the declared fixture arithmetic", () => {
    const project = fresh(),
      image = project.images.find((item) => item.id === "a-target-1000")!;
    const bytes = fromBase64(image.dataUrl.split(",")[1]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16)).toBe(720);
    expect(view.getUint32(20)).toBe(280);
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(0);
    let offset = 8;
    let raw: Uint8Array | undefined;
    while (offset < bytes.length) {
      const size = view.getUint32(offset),
        name = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
      if (name === "IDAT")
        raw = unzlibSync(bytes.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
    }
    expect(raw?.length).toBe(721 * 280);
    const values = getMeasurements(project, image.id);
    for (const [index, row] of values.entries()) {
      let sum = 0,
        background = 0;
      for (const roi of analysis(project).rois.filter(
        (item) => item.laneId === `lane-${index + 1}`,
      )) {
        let integrated = 0;
        for (let y = roi.rect.y; y < roi.rect.y + roi.rect.height; y++)
          for (let x = roi.rect.x; x < roi.rect.x + roi.rect.width; x++)
            integrated += 255 - raw![y * 721 + 1 + x];
        if (roi.kind === "band") sum = integrated;
        else background = integrated / (roi.rect.width * roi.rect.height);
      }
      expect(row.bandSum).toBe(sum);
      expect(row.backgroundMean).toBe(background);
      expect(row.net).toBe(sum - row.area * background);
      expect(row.demo).toBe(true);
    }
  });
});

describe("immutable versions and result invalidation", () => {
  it("does not create versions for no-op edits, repeated invalidation or pristine restores", () => {
    const original = fresh();
    expect(editTemplate(original, original.template)).toBe(original);
    expect(applyTemplate(original, ["a-target-1000", "a-reference-1000"])).toBe(
      original,
    );
    expect(restoreExampleAnalysis(original, "a-reference-1000")).toBe(original);
    expect(updateSample(original, "sample-1", { label: "S1" })).toBe(original);
    expect(updateAnalysis(original, "a-target-1000", { note: undefined })).toBe(
      original,
    );
    const first = updateRoi(original, "a-reference-1000", "band-1", {
      x: 49,
      y: 108,
      width: 72,
      height: 36,
    });
    const second = updateRoi(first, "a-reference-1000", "band-1", {
      x: 50,
      y: 108,
      width: 72,
      height: 36,
    });
    expect(second.history.length).toBe(first.history.length + 1);
    expect(analysis(second).revision).toBe(analysis(first).revision);
    expect(
      updateAnalysis(second, "a-target-1000", { status: "unreviewed" }),
    ).toBe(second);
    const resetReview = restoreExampleAnalysis(
      updateAnalysis(original, "a-reference-1000", { status: "confirmed" }),
      "a-reference-1000",
    );
    expect(analysis(resetReview).status).toBe("unreviewed");
    expect(getMeasurements(resetReview, "a-target-1000")).toHaveLength(6);
  });
  it("template edits never modify an old snapshot until explicitly applied", () => {
    const original = fresh();
    const edited = editTemplate(original, {
      bandWidth: 80,
      bandHeight: 40,
      backgroundGap: 12,
    });
    expect(edited.template.version).toBe(2);
    expect(analysis(edited).templateSnapshot.version).toBe(1);
    expect(getMeasurements(edited, "a-target-1000")).toHaveLength(6);
    const applied = applyTemplate(edited, ["a-target-1000"]);
    expect(analysis(applied).status).toBe("stale");
    expect(analysis(applied).templateSnapshot.version).toBe(2);
    expect(applied.history[0].templateSnapshot.version).toBe(1);
    expect(getMeasurements(applied, "a-target-1000")).toEqual([]);
    analysis(applied).rois[0].rect.x = 0;
    expect(applied.history[0].rois[0].rect.x).toBe(48);
    expect(analysis(original).rois[0].rect.x).toBe(48);
  });
  it("ROI changes preserve the original image and snapshot, clamp coordinates, and block confirmation", () => {
    const original = fresh(),
      image = original.images[0];
    const next = updateRoi(original, image.id, "band-1", {
      x: -20,
      y: 1000,
      width: 72,
      height: 36,
    });
    expect(analysis(next).rois[0].rect).toEqual({
      x: 0,
      y: 244,
      width: 72,
      height: 36,
    });
    expect(next.images[0].dataUrl).toBe(image.dataUrl);
    expect(next.images[0].hash).toBe(image.hash);
    expect(analysis(original).rois[0].rect.x).toBe(48);
    expect(getMeasurements(next, image.id)).toEqual([]);
    expect(() =>
      updateAnalysis(next, image.id, { status: "confirmed" }),
    ).toThrow();
    expect(() =>
      updateRoi(original, image.id, "band-1", {
        x: NaN,
        y: 2,
        width: 10,
        height: 10,
      }),
    ).toThrow();
  });
  it("invalidates paired targets when reference regions or exclusion change", () => {
    const original = fresh();
    const changed = updateRoi(original, "a-reference-1000", "background-1", {
      x: 49,
      y: 156,
      width: 72,
      height: 36,
    });
    expect(analysis(changed).status).toBe("stale");
    expect(getMeasurements(changed, "a-target-1000")).toEqual([]);
    const excluded = updateAnalysis(original, "a-reference-1000", {
      excluded: true,
    });
    expect(analysis(excluded).status).toBe("stale");
    expect(getMeasurements(excluded, "a-target-1000")).toEqual([]);
    const restoredRef = restoreExampleAnalysis(changed, "a-reference-1000");
    expect(getMeasurements(restoredRef, "a-target-1000")).toEqual([]);
    const restoredTarget = restoreExampleAnalysis(restoredRef, "a-target-1000");
    expect(getMeasurements(restoredTarget, "a-target-1000")).toHaveLength(6);
    expect(restoredTarget.history.length).toBeGreaterThan(
      changed.history.length,
    );
  });
  it("invalidates changes to pairing and sample design but allows harmless notes and labels", () => {
    const original = fresh();
    const changed = updateAnalysis(original, "a-target-1000", {
      referenceImageId: "a-reference-4000",
    });
    expect(analysis(changed).status).toBe("stale");
    expect(getMeasurements(changed, "a-target-1000")).toEqual([]);
    expect(() =>
      updateAnalysis(original, "a-target-1000", {
        referenceImageId: "b-reference-1000",
      }),
    ).toThrow();
    const sampleChanged = updateSample(original, "sample-1", {
      experimentalUnitId: "unit-2",
    });
    expect(getMeasurements(sampleChanged, "a-target-1000")).toEqual([]);
    expect(analysis(sampleChanged).status).toBe("stale");
    expect(
      getMeasurements(
        restoreExampleAnalysis(sampleChanged, "a-target-1000"),
        "a-target-1000",
      ),
    ).toEqual([]);
    const noteChanged = updateAnalysis(original, "a-target-1000", {
      note: "Reviewed region",
    });
    expect(getMeasurements(noteChanged, "a-target-1000")).toHaveLength(6);
    expect(
      getMeasurements(
        updateSample(original, "sample-1", { label: "Readable label" }),
        "a-target-1000",
      ),
    ).toHaveLength(6);
  });
  it("never provides fixture values if original bytes or their checksum are changed", () => {
    const hashChanged = fresh();
    hashChanged.images[0].hash = "0".repeat(64);
    expect(getMeasurements(hashChanged, "a-target-1000")).toEqual([]);
    const bytesChanged = fresh();
    bytesChanged.images[0].dataUrl += "A";
    expect(getMeasurements(bytesChanged, "a-target-1000")).toEqual([]);
  });
  it("cannot turn a saturated example into valid measurements by merely unchecking exclusion", () => {
    const unchecked = updateAnalysis(fresh(), "a-target-4000", {
      excluded: false,
    });
    expect(getMeasurements(unchecked, "a-target-4000")).toEqual([]);
    expect(() =>
      updateAnalysis(unchecked, "a-target-4000", { status: "confirmed" }),
    ).toThrow();
  });
  it("restores canonical ROI and pairing without erasing history or annotation", () => {
    let changed = updateAnalysis(fresh(), "a-target-1000", {
      referenceImageId: null,
      note: "Keep this note",
    });
    changed = updateRoi(changed, "a-target-1000", "band-1", {
      x: 52,
      y: 108,
      width: 72,
      height: 36,
    });
    const history = structuredClone(changed.history),
      restored = restoreExampleAnalysis(changed, "a-target-1000");
    expect(analysis(restored).referenceImageId).toBe("a-reference-1000");
    expect(analysis(restored).rois[0].rect.x).toBe(48);
    expect(analysis(restored).note).toBe("Keep this note");
    expect(analysis(restored).status).toBe("unreviewed");
    expect(restored.history.slice(0, history.length)).toEqual(history);
    expect(getMeasurements(restored, "a-target-1000")).toHaveLength(6);
  });
});

describe("portable project archives", () => {
  it("round trips actual images, hashes, history, original project ID and UI", async () => {
    const project = updateAnalysis(fresh(), "a-target-1000", {
      note: "Saved note",
      status: "confirmed",
    });
    const file = await exportProject(project),
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    expect(Object.keys(entries)).toHaveLength(9);
    expect(entries["images/a-target-1000.png"]).toBeInstanceOf(Uint8Array);
    const restored = await importProject(file);
    expect(restored).toEqual(project);
    expect(getMeasurements(restored, "a-target-1000")).toHaveLength(6);
    expect(
      await importProject(await exportProject(createEmptyProject("New"))),
    ).toMatchObject({ name: "New", images: [] });
  });
  it("rejects corrupt pixels and invalid checksums", async () => {
    const alteredPixel = await rewriteArchive(fresh(), (entries) => {
      entries["images/a-target-1000.png"][50] ^= 1;
    });
    await expect(importProject(alteredPixel)).rejects.toThrow(/checksum/);
    const alteredHash = await rewriteArchive(fresh(), (entries) =>
      mutateManifest(entries, (manifest) => {
        manifest.project.images[0].hash = "0".repeat(64);
      }),
    );
    await expect(importProject(alteredHash)).rejects.toThrow(/checksum/);
  });
  it("rejects unknown schemas, duplicate IDs, invalid references, coordinates and external resources", async () => {
    const changes: ((manifest: Record<string, any>) => void)[] = [
      (manifest) => {
        manifest.project.schemaVersion = 2;
      },
      (manifest) => {
        manifest.project.samples[1].id = manifest.project.samples[0].id;
      },
      (manifest) => {
        manifest.project.lanes[0].sampleId = "missing";
      },
      (manifest) => {
        manifest.project.analyses[0].rois[0].rect.x = 1000;
      },
      (manifest) => {
        manifest.project.images[0].width = 700;
      },
      (manifest) => {
        manifest.project.images[0].exposureMs = 2000;
      },
      (manifest) => {
        manifest.project.images[1].qc = "normal";
      },
      (manifest) => {
        manifest.project.images[0].path = "https://example.com/source.png";
      },
      (manifest) => {
        manifest.project.images[0].dataUrl = "https://example.com/source.png";
      },
      (manifest) => {
        manifest.project.analyses[0].referenceImageId = "b-reference-1000";
      },
      (manifest) => {
        manifest.project.analyses[0].rois[0].rect.x = 49;
        manifest.project.analyses[0].status = "confirmed";
      },
      (manifest) => {
        manifest.project.analyses[1].excluded = false;
        manifest.project.analyses[1].status = "confirmed";
      },
    ];
    for (const change of changes)
      await expect(
        importProject(
          await rewriteArchive(fresh(), (entries) =>
            mutateManifest(entries, change),
          ),
        ),
      ).rejects.toThrow();
  });
  it("rejects pollution, path traversal, excess data and non-ZIP files", async () => {
    const pollution = await rewriteArchive(fresh(), (entries) => {
      entries["manifest.json"] = strToU8(
        strFromU8(entries["manifest.json"]).replace(
          '"archiveVersion": 1',
          '"__proto__": {"polluted": true}, "archiveVersion": 1',
        ),
      );
    });
    await expect(importProject(pollution)).rejects.toThrow(/Unsafe JSON/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const traversal = await rewriteArchive(fresh(), (entries) => {
      entries["../escape"] = strToU8("x");
    });
    await expect(importProject(traversal)).rejects.toThrow();
    const bomb = new Blob([
      new Uint8Array(
        zipSync({ "manifest.json": new Uint8Array(9 * 1024 * 1024) }),
      ).buffer,
    ]);
    await expect(importProject(bomb)).rejects.toThrow(/too large/);
    await expect(importProject(new Blob(["not zip"]))).rejects.toThrow();
  });
});

describe("CSV export", () => {
  it("requires both target and reference to be confirmed, protects formulas, and identifies demo provenance", () => {
    let project = fresh();
    expect(() => exportCsv(project)).toThrow();
    project = updateAnalysis(project, "a-target-1000", { status: "confirmed" });
    expect(() => exportCsv(project)).toThrow();
    project = updateAnalysis(project, "a-reference-1000", {
      status: "confirmed",
    });
    project = updateSample(project, "sample-1", {
      label: '  =HYPERLINK("https://example.com")',
    });
    const csv = exportCsv(project);
    expect(csv).toContain("TRUE_SYNTHETIC_PRESET");
    expect(csv).toContain("experimental_unit_id");
    expect(csv).toContain("analysis_revision");
    expect(csv).toContain("'  =HYPERLINK");
    expect(csv.trim().split("\r\n")).toHaveLength(7);
    project = updateRoi(project, "a-reference-1000", "band-1", {
      x: 49,
      y: 108,
      width: 72,
      height: 36,
    });
    expect(() => exportCsv(project)).toThrow();
  });
});
