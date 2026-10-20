import { beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "fast-png";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createRealProject,
  exportRealProject,
  importRealImages,
  importRealProject,
  loadRealProject,
  results,
  saveRealProject,
  updateRealImage,
  updateRealPublication,
} from "./model";
import type { PublicationSettings } from "./publication-settings";

const database = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => database.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    database.set(key, structuredClone(value));
  }),
}));
beforeEach(() => database.clear());

async function fixture() {
  const files = [8, 16].map((depth) => {
    const scale = depth === 16 ? 257 : 1;
    const data = new Uint16Array(40 * 24).fill(200 * scale);
    for (let y = 6; y < 10; y++)
      for (let x = 2; x < 30; x++)
        data[y * 40 + x] = (x < 10 ? 80 : 120) * scale;
    return {
      name: depth === 8 ? "Target_rep1.png" : "Reference_rep1.png",
      bytes: encode({
        width: 40,
        height: 24,
        channels: 1,
        depth: depth as 8 | 16,
        data: depth === 8 ? Uint8Array.from(data) : data,
      }),
    };
  });
  let project = await importRealImages(createRealProject("Publication"), files);
  for (const image of project.images)
    project = updateRealImage(project, image.id, {
      regions: [2, 22].map((x, index) => ({
        lane: index + 1,
        band: { x, y: 6, width: 8, height: 4 },
        background: { x, y: 16, width: 8, height: 4 },
        source: "manual",
      })),
    });
  const settings: PublicationSettings = {
    title: "Figure <1>",
    widthMm: 120,
    rows: [
      {
        id: "row-1",
        imageId: project.images[0].id,
        label: "Target",
        panel: "A",
        molecularWeight: "42",
        crop: { x: 0, y: 4, width: 40, height: 10 },
      },
    ],
    sources: project.images.map((image) => ({
      imageId: image.id,
      kind: "ecl",
    })),
  };
  return { project, settings };
}

describe("publication persistence", () => {
  it("keeps the source bytes, measurement results, revisions and review unchanged", async () => {
    const { project, settings } = await fixture();
    const before = results(project);
    const snapshot = structuredClone(project);
    const next = updateRealPublication(project, settings);
    expect(next.images).toBe(project.images);
    expect(results(next)).toEqual(before);
    expect(project).toEqual(snapshot);
    settings.rows[0].crop.x = 7;
    settings.sources[0].kind = "overlay";
    expect(next.publication!.rows[0].crop.x).toBe(0);
    expect(next.publication!.sources[0].kind).toBe("ecl");
    expect(updateRealPublication(next, next.publication!)).toBe(next);
  });

  it("restores presentation settings and exact originals from both storage and archives", async () => {
    const { project, settings } = await fixture();
    const next = updateRealPublication(project, settings);
    await saveRealProject(next);
    expect((await loadRealProject())!.publication).toEqual(settings);
    const restored = await importRealProject(await exportRealProject(next));
    expect(restored.publication).toEqual(settings);
    expect(results(restored)).toEqual(results(project));
    for (let i = 0; i < restored.images.length; i++) {
      expect(restored.images[i].bytes).toEqual(project.images[i].bytes);
      expect(restored.images[i].hash).toBe(project.images[i].hash);
    }
  });

  it("continues to load old projects that have no publication settings", async () => {
    const { project } = await fixture();
    const restored = await importRealProject(await exportRealProject(project));
    expect(restored.publication).toBeUndefined();
    expect(results(restored)).toEqual(results(project));
  });

  it("rejects unknown references, duplicate identities, invalid sizes and out-of-bounds crops", async () => {
    const { project, settings } = await fixture();
    const bad = [
      { ...settings, widthMm: 0 },
      { ...settings, widthMm: Number.NaN },
      { ...settings, rows: [{ ...settings.rows[0], imageId: "missing" }] },
      { ...settings, sources: [{ imageId: "missing", kind: "ecl" }] },
      { ...settings, sources: [settings.sources[0], settings.sources[0]] },
      { ...settings, rows: [settings.rows[0], settings.rows[0]] },
      {
        ...settings,
        rows: [
          { ...settings.rows[0], crop: { x: 1, y: 0, width: 40, height: 24 } },
        ],
      },
      {
        ...settings,
        rows: [
          {
            ...settings.rows[0],
            crop: { x: 0.5, y: 0, width: 20, height: 10 },
          },
        ],
      },
      { ...settings, unexpected: true },
    ];
    for (const value of bad)
      expect(() =>
        updateRealPublication(project, value as PublicationSettings),
      ).toThrow();
  });

  it("validates presentation references and bounds when importing external archives", async () => {
    const { project, settings } = await fixture();
    const archive = await exportRealProject(
      updateRealPublication(project, settings),
    );
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    manifest.publication.rows[0].crop.width = 41;
    entries["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(
      importRealProject(new Blob([new Uint8Array(zipSync(entries)).buffer])),
    ).rejects.toThrow(/crop|裁剪/i);
    manifest.publication.rows[0].crop.width = 40;
    manifest.publication.sources[0].imageId = "missing";
    entries["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(
      importRealProject(new Blob([new Uint8Array(zipSync(entries)).buffer])),
    ).rejects.toThrow(/original|原图/i);
  });
});
