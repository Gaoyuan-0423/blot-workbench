import { zlibSync } from "fflate";
import {
  APP_VERSION,
  type Analysis,
  type ImageRecord,
  type Measurement,
  type Project,
  type Roi,
  type Sample,
  type Template,
} from "./types";

export const DEFAULT_TEMPLATE: Template = {
  id: "wb-basic",
  name: "WB demo / 基础矩形",
  version: 1,
  bandWidth: 72,
  bandHeight: 36,
  backgroundGap: 12,
};
export const DEMO_SAMPLES: Sample[] = Array.from({ length: 6 }, (_, i) => ({
  id: `sample-${i + 1}`,
  label: `S${i + 1}`,
  group: i < 3 ? "Control" : "Treatment",
  experimentalUnitId: `unit-${i + 1}`,
  technicalReplicateSetId: `technical-${i + 1}`,
}));

export function demoRois(template = DEFAULT_TEMPLATE): Roi[] {
  return Array.from({ length: 6 }, (_, i) => [
    {
      id: `band-${i + 1}`,
      laneId: `lane-${i + 1}`,
      kind: "band" as const,
      rect: {
        x: 48 + 104 * i,
        y: 108,
        width: template.bandWidth,
        height: template.bandHeight,
      },
    },
    {
      id: `background-${i + 1}`,
      laneId: `lane-${i + 1}`,
      kind: "background" as const,
      rect: {
        x: 48 + 104 * i,
        y: 108 + template.bandHeight + template.backgroundGap,
        width: template.bandWidth,
        height: template.bandHeight,
      },
    },
  ]).flat();
}

export const clone = <T>(value: T): T => structuredClone(value);
export function toBase64(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(result);
}
export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}
function concat(...arrays: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(
    arrays.reduce((sum, array) => sum + array.length, 0),
  );
  let position = 0;
  for (const array of arrays) {
    joined.set(array, position);
    position += array.length;
  }
  return joined;
}
function pngChunk(name: string, bytes: Uint8Array): Uint8Array {
  const content = concat(new TextEncoder().encode(name), bytes);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return concat(
    uint32(bytes.length),
    content,
    uint32((crc ^ 0xffffffff) >>> 0),
  );
}

interface Fixture {
  image: Omit<ImageRecord, "hash">;
  png: Uint8Array;
  net: number[];
  bandSum: number[];
  backgroundMean: number[];
  hash?: string;
  hashPromise?: Promise<string>;
}
let fixtureCache: Fixture[] | undefined;

/** Original deterministic illustrations; these are fixtures, not a user-image quantifier. */
export function getFixtures(): Fixture[] {
  if (fixtureCache) return fixtureCache;
  fixtureCache = [];
  for (const batch of ["a", "b"])
    for (const role of ["target", "reference"] as const)
      for (const exposure of [1000, 4000]) {
        const id = `${batch}-${role}-${exposure}`;
        const qc: ImageRecord["qc"] =
          batch === "a" && role === "target" && exposure === 4000
            ? "saturated"
            : batch === "b" && role === "target" && exposure === 1000
              ? "weak"
              : batch === "b" &&
                  ((role === "reference" && exposure === 1000) ||
                    (role === "target" && exposure === 4000))
                ? "background"
                : "normal";
        const width = 720,
          height = 280;
        const pixels = new Uint8Array(width * height);
        const net = Array(6).fill(0) as number[],
          bandSum = Array(6).fill(0) as number[],
          backgroundMean = Array(6).fill(0) as number[];
        const strengths =
          role === "target"
            ? [40, 46, 43, 72, 79, 75]
            : [64, 67, 62, 65, 69, 66];
        const scale = qc === "weak" ? 0.25 : exposure === 4000 ? 1.8 : 1;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const noise = ((x * 17 + y * 23 + x * y * 3) % 7) - 3;
            const background =
              18 + noise + (qc === "background" ? Math.floor(x / 24) : 0);
            let signal = background;
            for (let lane = 0; lane < 6; lane++) {
              const dx = (x - (84 + 104 * lane)) / 27;
              const dy = (y - 126) / 7;
              if (Math.abs(dx) < 1.3 && Math.abs(dy) < 2.5) {
                const intensity =
                  strengths[lane] *
                  scale *
                  Math.exp(-Math.pow(dx, 6) - dy * dy);
                signal += qc === "saturated" ? intensity * 7 : intensity;
              }
            }
            pixels[y * width + x] =
              255 - Math.min(255, Math.max(0, Math.round(signal)));
          }
        // Store fixed expected values from the deterministic fixture generator, never from imported/user pixels.
        for (const roi of demoRois()) {
          const lane = Number(roi.laneId.split("-")[1]) - 1;
          let sum = 0;
          for (let y = roi.rect.y; y < roi.rect.y + roi.rect.height; y++)
            for (let x = roi.rect.x; x < roi.rect.x + roi.rect.width; x++)
              sum += 255 - pixels[y * width + x];
          if (roi.kind === "band") bandSum[lane] = sum;
          else backgroundMean[lane] = sum / (roi.rect.width * roi.rect.height);
        }
        for (let lane = 0; lane < 6; lane++)
          net[lane] = bandSum[lane] - 72 * 36 * backgroundMean[lane];
        const filtered = new Uint8Array((width + 1) * height);
        for (let y = 0; y < height; y++)
          filtered.set(
            pixels.subarray(y * width, (y + 1) * width),
            y * (width + 1) + 1,
          );
        const png = concat(
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          pngChunk(
            "IHDR",
            concat(
              uint32(width),
              uint32(height),
              new Uint8Array([8, 0, 0, 0, 0]),
            ),
          ),
          pngChunk("IDAT", zlibSync(filtered, { level: 6 })),
          pngChunk("IEND", new Uint8Array()),
        );
        fixtureCache.push({
          image: {
            id,
            name: `Demo ${batch.toUpperCase()} · ${role} · ${exposure / 1000}s`,
            batchId: `batch-${batch}`,
            membraneId: `membrane-${batch}`,
            protein: role === "target" ? "Target-demo" : "Reference-demo",
            role,
            exposureMs: exposure,
            width,
            height,
            dataUrl: `data:image/png;base64,${toBase64(png)}`,
            source: "synthetic",
            qc,
          },
          png,
          net,
          bandSum,
          backgroundMean,
        });
      }
  return fixtureCache;
}

export async function fixtureHash(fixture: Fixture): Promise<string> {
  fixture.hashPromise ??= sha256(fixture.png).then((hash) => {
    fixture.hash = hash;
    return hash;
  });
  return fixture.hashPromise;
}

function sampleDesign(samples: Sample[]) {
  return samples
    .map(({ id, group, experimentalUnitId, technicalReplicateSetId }) => ({
      id,
      group,
      experimentalUnitId,
      technicalReplicateSetId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function designMatchesFixture(project: Project): boolean {
  return (
    JSON.stringify(sampleDesign(project.samples)) ===
      JSON.stringify(sampleDesign(DEMO_SAMPLES)) &&
    JSON.stringify(project.lanes) ===
      JSON.stringify(
        DEMO_SAMPLES.map((sample, index) => ({
          id: `lane-${index + 1}`,
          number: index + 1,
          sampleId: sample.id,
        })),
      )
  );
}
export function canonicalReference(image: ImageRecord): string | null {
  return image.role === "target"
    ? `${image.batchId.slice(-1)}-reference-${image.exposureMs}`
    : null;
}
export function fixtureSignature(imageId: string): string {
  return `demo-v1:${imageId}:${JSON.stringify({ rois: demoRois(), template: DEFAULT_TEMPLATE, design: sampleDesign(DEMO_SAMPLES) })}`;
}
export function analysisMatchesFixture(
  project: Project,
  analysis: Analysis,
): boolean {
  const image = project.images.find((item) => item.id === analysis.imageId);
  const fixture = getFixtures().find(
    (item) => item.image.id === analysis.imageId,
  );
  return (
    !!image &&
    !!fixture &&
    !!fixture.hash &&
    image.hash === fixture.hash &&
    image.dataUrl === fixture.image.dataUrl &&
    image.width === fixture.image.width &&
    image.height === fixture.image.height &&
    image.role === fixture.image.role &&
    image.batchId === fixture.image.batchId &&
    image.membraneId === fixture.image.membraneId &&
    image.protein === fixture.image.protein &&
    image.exposureMs === fixture.image.exposureMs &&
    image.source === fixture.image.source &&
    image.qc === fixture.image.qc &&
    analysis.fixtureSignature === fixtureSignature(image.id) &&
    JSON.stringify(analysis.rois) === JSON.stringify(demoRois()) &&
    JSON.stringify(analysis.templateSnapshot) ===
      JSON.stringify(DEFAULT_TEMPLATE) &&
    analysis.referenceImageId === canonicalReference(image) &&
    designMatchesFixture(project)
  );
}

export function presetMeasurements(
  project: Project,
  image: ImageRecord,
): Measurement[] {
  const fixture = getFixtures().find((entry) => entry.image.id === image.id)!;
  const reference =
    getFixtures().find(
      (entry) => entry.image.id === canonicalReference(image),
    ) ?? fixture;
  const ratios = fixture.net.map(
    (value, index) => value / reference.net[index],
  );
  const controlMean = (ratios[0] + ratios[1] + ratios[2]) / 3;
  return project.lanes.map((lane, index) => ({
    imageId: image.id,
    sampleId: lane.sampleId,
    bandSum: fixture.bandSum[index],
    area: 72 * 36,
    backgroundMean: fixture.backgroundMean[index],
    net: fixture.net[index],
    referenceNet: reference.net[index],
    ratio: ratios[index],
    relative: ratios[index] / controlMean,
    demo: true,
  }));
}

export function createEmptyProject(name: string): Project {
  const date = new Date().toISOString();
  return {
    schemaVersion: 1,
    appVersion: APP_VERSION,
    id: globalThis.crypto.randomUUID(),
    name: name.trim().slice(0, 200) || "Untitled / 未命名项目",
    description:
      "Alpha demonstration project. Synthetic images and fixture values only. / 仅含合成示例与预设演示值。",
    createdAt: date,
    updatedAt: date,
    demo: true,
    batches: [],
    samples: [],
    lanes: [],
    images: [],
    template: clone(DEFAULT_TEMPLATE),
    analyses: [],
    history: [],
    ui: {
      view: "overview",
      selectedImageId: "",
      batchFilter: "all",
      language: "zh",
    },
  };
}
export async function createExampleProject(): Promise<Project> {
  const project = createEmptyProject("WB 示例项目 / Demonstration");
  project.batches = [
    { id: "batch-a", label: "Batch A / 批次 A", date: "2026-09-01" },
    { id: "batch-b", label: "Batch B / 批次 B", date: "2026-09-08" },
  ];
  project.samples = clone(DEMO_SAMPLES);
  project.lanes = project.samples.map((sample, index) => ({
    id: `lane-${index + 1}`,
    number: index + 1,
    sampleId: sample.id,
  }));
  project.images = await Promise.all(
    getFixtures().map(async (fixture) => ({
      ...fixture.image,
      hash: await fixtureHash(fixture),
    })),
  );
  project.analyses = project.images.map((image) => ({
    imageId: image.id,
    revision: 1,
    status: "unreviewed",
    rois: demoRois(),
    templateSnapshot: clone(DEFAULT_TEMPLATE),
    referenceImageId: canonicalReference(image),
    excluded: image.qc === "saturated",
    note: "",
    fixtureSignature: fixtureSignature(image.id),
  }));
  project.ui.selectedImageId = project.images[0].id;
  return project;
}
