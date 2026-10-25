import { describe, expect, it } from "vitest";
import { encode } from "fast-png";
import { quickBandsTiff } from "../tests/fixtures/quick-tiff";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createQuickExample,
  loadQuickImage,
  createQuickReferenceExample,
  type QuickImage,
  imageMaximum,
  allocateGray,
} from "./quick/image";
import { detectBands, detectRows, measureBands } from "./quick/analysis";
import { recognizeSingle } from "./single/model";
import { measurePreparedBands, prepareRaster } from "./single/preparation";
import {
  exportQuickProject,
  exportSingleProject,
  importQuickProject,
  importSingleProject,
  type QuickLoaded,
  type QuickProject,
  type SingleProject,
} from "./cloud-project";
import { decodeJson, encodeJson } from "./project-archive";

function preview(prepared: ReturnType<typeof prepareRaster>): QuickImage {
  return {
    name: prepared.source.name,
    width: prepared.width,
    height: prepared.height,
    gray: prepared.gray,
    ...(prepared.source.bitDepth ? { bitDepth: prepared.source.bitDepth } : {}),
    dataUrl:
      "data:image/png;base64," +
      Buffer.from(
        encode({
          width: prepared.width,
          height: prepared.height,
          data: Uint8Array.from(prepared.gray, (value) =>
            Math.round((value * 255) / imageMaximum(prepared.source)),
          ),
          channels: 1,
          depth: 8,
        }),
      ).toString("base64"),
  };
}
function single(): SingleProject {
  const source = createQuickExample();
  // Treat the PNG as an uploaded file to verify original bytes are preserved.
  delete source.synthetic;
  const config = {
    straighten: [
      { x: 20, y: 80 },
      { x: 700, y: 95 },
    ] as const,
    curve: [
      { x: 20, y: 80 },
      { x: 360, y: 92 },
      { x: 700, y: 95 },
    ],
  };
  const full = prepareRaster(source, config);
  const prepared = prepareRaster(source, {
    ...config,
    crop: { x: 0, y: 0, width: full.width - 1, height: full.height - 1 },
  });
  const image = preview(prepared);
  const result = recognizeSingle(image, "dark", 6);
  result.bands[0].rect.x += 1;
  return {
    strips: [
      {
        id: "exposure-1",
        image,
        prepared,
        config: { ...config, crop: prepared.crop },
        appearance: { brightness: 140, contrast: 300 },
        mode: "auto",
        count: 6,
        control: 1,
        selected: 2,
        ...result,
      },
    ],
    activeId: "exposure-1",
    editing: true,
    kind: "background",
  };
}
function loaded(image: QuickImage): QuickLoaded {
  const result = detectRows(
    image.gray,
    image.width,
    image.height,
    "dark",
    imageMaximum(image),
  );
  const rows = result.rows.map((bounds) => {
    const gray = allocateGray(image.gray, bounds.width * bounds.height);
    for (let y = 0; y < bounds.height; y++)
      gray.set(
        image.gray.subarray(
          (bounds.y + y) * image.width + bounds.x,
          (bounds.y + y) * image.width + bounds.x + bounds.width,
        ),
        y * bounds.width,
      );
    return {
      bounds,
      gray,
      ...detectBands(
        gray,
        bounds.width,
        bounds.height,
        "dark",
        undefined,
        imageMaximum(image),
      ),
      label: "Target protein",
    };
  });
  return { image, rows, warnings: result.warnings, polarity: "dark" };
}
function quick(): QuickProject {
  return {
    data: loaded(createQuickExample()),
    external: loaded(createQuickReferenceExample()),
    inspectReference: true,
    externalActive: 0,
    active: 0,
    reference: "external:0",
    control: 1,
    labels: ["Control", "Test 1"],
    polarity: "dark",
    selected: 2,
    editing: true,
    editBackground: true,
    count: 6,
    showBoxes: false,
  };
}
async function mutate(
  blob: Blob,
  change: (manifest: any) => void,
): Promise<Blob> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = decodeJson(strFromU8(entries["manifest.json"]));
  change(manifest);
  entries["manifest.json"] = strToU8(encodeJson(manifest));
  return new Blob([Uint8Array.from(zipSync(entries)).buffer]);
}
describe("WB recoverable projects", () => {
  it("preserves source pixel-center measurements, geometry, crop, manual boxes and appearance", async () => {
    const source = single(),
      strip = source.strips[0];
    const expected = measurePreparedBands(
      strip.prepared,
      strip.bands,
      strip.polarity,
    );
    const result = await importSingleProject(
      (await exportSingleProject(source)).blob,
    );
    expect(result.completeness).toEqual([]);
    expect(result.project.strips[0].config).toEqual(strip.config);
    expect(result.project.strips[0].appearance).toEqual(strip.appearance);
    expect(result.project.strips[0].bands).toEqual(strip.bands);
    expect(result.project.strips[0].prepared.source.original!.bytes).toEqual(
      strip.prepared.source.original!.bytes,
    );
    const restored = result.project.strips[0];
    expect(
      measurePreparedBands(
        restored.prepared,
        restored.bands,
        restored.polarity,
      ),
    ).toEqual(expected);
    expect(result.project.activeId).toBe(source.activeId);
  });
  it("keeps multiple exposures independent", async () => {
    const source = single();
    const second = {
      ...source.strips[0],
      id: "exposure-2",
      control: 4,
      appearance: { brightness: 90, contrast: 80 },
    };
    source.strips.push(second);
    source.activeId = second.id;
    const restored = (
      await importSingleProject((await exportSingleProject(source)).blob)
    ).project;
    expect(restored.strips.map((s) => [s.id, s.control, s.appearance])).toEqual(
      source.strips.map((s) => [s.id, s.control, s.appearance]),
    );
    expect(restored.activeId).toBe(second.id);
  });
  it("states missing historical originals without manufacturing replacements", async () => {
    const source = single();
    delete source.strips[0].prepared.source.original;
    const restored = await importSingleProject(
      (await exportSingleProject(source)).blob,
    );
    expect(restored.completeness).toHaveLength(1);
    expect(restored.project.strips[0].prepared.source.original).toBeUndefined();
  });
  it("preserves quick rows, external reference, sample labels and ROI measurements", async () => {
    const source = quick();
    source.data!.rows[0].bands[0].rect.x += 1;
    const restored = (
      await importQuickProject((await exportQuickProject(source)).blob)
    ).project;
    expect(restored).toEqual(source);
    for (const value of [source.data!, source.external!]) {
      const after = value === source.data ? restored.data! : restored.external!;
      expect(
        measureBands(
          after.rows[0].gray,
          after.rows[0].bounds.width,
          after.rows[0].bounds.height,
          after.rows[0].bands,
          after.polarity,
        ),
      ).toEqual(
        measureBands(
          value.rows[0].gray,
          value.rows[0].bounds.width,
          value.rows[0].bounds.height,
          value.rows[0].bands,
          value.polarity,
        ),
      );
    }
  });
  it.each([
    "tool",
    "version",
    "transform",
    "crop",
    "roi",
    "active",
    "pixels",
    "secret",
  ])("rejects corrupt single %s before returning state", async (kind) => {
    const blob = (await exportSingleProject(single())).blob;
    const corrupted = await mutate(blob, (m) => {
      if (kind === "tool") m.tool = "wb-quick";
      if (kind === "version") m.version = 2;
      if (kind === "transform")
        m.state.strips[0].prepared.metadata.rotationRadians += 0.2;
      if (kind === "crop") m.state.strips[0].prepared.crop.x += 1;
      if (kind === "roi") m.state.strips[0].bands[0].rect.width = 16000;
      if (kind === "active") m.state.activeId = "unknown";
      if (kind === "pixels") m.state.strips[0].image.gray = 999;
      if (kind === "secret") m.state.accountToken = "not-allowed";
    });
    await expect(importSingleProject(corrupted)).rejects.toThrow();
  });
  it("rejects quick reference IDs and mismatched row data", async () => {
    const blob = (await exportQuickProject(quick())).blob;
    await expect(
      importQuickProject(
        await mutate(blob, (m) => {
          m.state.reference = "external:99";
        }),
      ),
    ).rejects.toThrow();
    await expect(
      importQuickProject(
        await mutate(blob, (m) => {
          m.state.data.rows[0].bounds.height = 100;
        }),
      ),
    ).rejects.toThrow();
  });
  it("rejects cross-mode packages", async () => {
    await expect(
      importSingleProject((await exportQuickProject(quick())).blob),
    ).rejects.toThrow();
    await expect(
      importQuickProject((await exportSingleProject(single())).blob),
    ).rejects.toThrow();
  });
});

describe("TIFF project round trips", () => {
  it("preserves exact 16-bit source samples, preparation, measurements and original bytes", async () => {
    const bytes = quickBandsTiff();
    const source = await loadQuickImage(
      new File([bytes.buffer as ArrayBuffer], "source.tiff"),
    );
    const prepared = prepareRaster(source),
      image = preview(prepared),
      detected = recognizeSingle(image);
    const project: SingleProject = {
      strips: [
        {
          id: "tiff",
          image,
          prepared,
          config: {},
          appearance: { brightness: 100, contrast: 100 },
          mode: "auto",
          control: 0,
          count: 6,
          selected: 0,
          ...detected,
        },
      ],
      activeId: "tiff",
      editing: false,
      kind: "rect",
    };
    const expected = measurePreparedBands(prepared, detected.bands, "dark");
    expect(expected.map((row) => row.net)).toEqual(
      Array.from({ length: 6 }, (_, i) => 384 * (10001 + i * 5000)),
    );
    const restored = (
      await importSingleProject((await exportSingleProject(project)).blob)
    ).project.strips[0];
    expect(restored.prepared.source.original!.bytes).toEqual(bytes);
    expect(restored.image.bitDepth).toBe(16);
    expect(restored.image.gray).toEqual(image.gray);
    expect(restored.prepared.metadata.measurement).toBe(
      "original-16-bit-pixel-centers",
    );
    expect(
      measurePreparedBands(restored.prepared, restored.bands, "dark"),
    ).toEqual(expected);
  });
  it("round-trips target and reference rows without truncating high-depth values", async () => {
    const bytes = quickBandsTiff();
    const image = await loadQuickImage(
      new File([bytes.buffer as ArrayBuffer], "source.tif"),
    );
    const project = quick();
    project.data = loaded(image);
    project.external = loaded(image);
    const restored = (
      await importQuickProject((await exportQuickProject(project)).blob)
    ).project;
    expect(restored.data!.image.gray).toEqual(image.gray);
    expect(restored.data!.rows[0].gray).toEqual(image.gray);
    expect(restored.external!.rows[0].gray).toEqual(image.gray);
    expect(restored.data!.image.bitDepth).toBe(16);
    expect(
      measureBands(
        restored.data!.rows[0].gray,
        image.width,
        image.height,
        restored.data!.rows[0].bands,
        "dark",
        65535,
      ).map((row) => row.net),
    ).toEqual(Array.from({ length: 6 }, (_, i) => 384 * (10001 + i * 5000)));
  });
});

describe("invalid high-depth archive samples", () => {
  for (const value of [NaN, Infinity, -1, 65536]) {
    it(`rejects a Float64 archive containing ${value} before restoring it`, async () => {
      const bytes = quickBandsTiff();
      const image = await loadQuickImage(
        new File([bytes.buffer as ArrayBuffer], "source.tif"),
      );
      const project = quick();
      project.data = loaded(image);
      image.gray[0] = value;
      const archive = await exportQuickProject(project);
      await expect(importQuickProject(archive.blob)).rejects.toThrow(
        /Invalid|项目包/,
      );
    });
  }
});
