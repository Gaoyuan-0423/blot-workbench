import { decode as decodePng } from "fast-png";
import {
  array,
  bool,
  integer,
  invalid,
  nullable,
  number,
  object,
  oneOf,
  packProject,
  string,
  unpackProject,
} from "./project-archive";
import {
  inspectQuickImage,
  QUICK_IMAGE_LIMITS,
  type QuickImage,
} from "./quick/image";
import type { Polarity, QuickBand, Rect } from "./quick/analysis";
import {
  prepareRaster,
  type PreparedRaster,
  type PreparationConfig,
  type PreparationMetadata,
} from "./single/preparation";
import type { SinglePolarity } from "./single/model";

export interface SingleStripState {
  id: string;
  image: QuickImage;
  prepared: PreparedRaster;
  config: PreparationConfig;
  appearance: { brightness: number; contrast: number };
  mode: SinglePolarity;
  control: number;
  count: number;
  selected: number;
  bands: QuickBand[];
  warnings: string[];
  polarity: Polarity;
}
export interface SingleProject {
  strips: SingleStripState[];
  activeId: string;
  editing: boolean;
  kind: "rect" | "background";
}
export interface QuickRow {
  bounds: Rect;
  gray: Uint8Array;
  bands: QuickBand[];
  warnings: string[];
  label: string;
  automaticLabel?: number;
}
export interface QuickLoaded {
  image: QuickImage;
  rows: QuickRow[];
  warnings: string[];
  polarity: Polarity;
}
export interface QuickProject {
  data: QuickLoaded | null;
  external: QuickLoaded | null;
  inspectReference: boolean;
  externalActive: number;
  active: number;
  reference: string;
  control: number;
  labels: string[];
  polarity: Polarity;
  selected: number;
  editing: boolean;
  editBackground: boolean;
  count: number;
  showBoxes: boolean;
}

const rectCheck = object({
  x: integer(),
  y: integer(),
  width: integer(1, 16000),
  height: integer(1, 16000),
});
const point = object({ x: number, y: number });
const points = array(point, 8);
const twoPoints = (v: unknown) =>
  Array.isArray(v) && v.length === 2 && v.every(point);
const configCheck = object(
  {},
  {
    straighten: twoPoints,
    curve: (v) => Array.isArray(v) && v.length >= 3 && points(v),
    crop: rectCheck,
  },
);
const polarityCheck = oneOf("dark", "light");
const bandsCheck = array(
  object({ id: string, rect: rectCheck, background: nullable(rectCheck) }),
  32,
);
const warningsCheck = array(string, 1000);
const sizeCheck = object({
  width: integer(1, 16000),
  height: integer(1, 16000),
});
const metadataCheck = object({
  version: oneOf("single-preparation-v1"),
  coordinateSpace: oneOf("prepared-view-pixels"),
  measurement: oneOf("original-8-bit-pixel-centers"),
  order: oneOf("rotation-column-shift-crop"),
  sourceSize: sizeCheck,
  fullSize: sizeCheck,
  straighten: nullable(twoPoints),
  curve: points,
  rotationRadians: number,
  rotationDegrees: number,
  rotationCos: number,
  rotationSin: number,
  rotationTranslation: point,
  baseline: points,
  warpBaselineY: number,
  warpTranslationY: number,
  crop: rectCheck,
});
interface ImageRef {
  name: string;
  width: number;
  height: number;
  gray: number;
  preview: number;
  original: { mime: "image/png" | "image/jpeg"; file: number } | null;
  synthetic: boolean;
}
const fileIndex = integer(0, 2999);
const imageCheck = object({
  name: string,
  width: integer(1, 16000),
  height: integer(1, 16000),
  gray: fileIndex,
  preview: fileIndex,
  original: nullable(
    object({ mime: oneOf("image/png", "image/jpeg"), file: fileIndex }),
  ),
  synthetic: bool,
});
type PreparedRef = Omit<PreparedRaster, "source" | "gray" | "valid"> & {
  source: ImageRef;
  gray: number;
  valid: number;
};
const preparedCheck = object({
  source: imageCheck,
  gray: fileIndex,
  valid: fileIndex,
  width: integer(1, 16000),
  height: integer(1, 16000),
  fullWidth: integer(1, 16000),
  fullHeight: integer(1, 16000),
  crop: rectCheck,
  polarity: polarityCheck,
  metadata: metadataCheck,
});
type StripRef = Omit<SingleStripState, "image" | "prepared"> & {
  image: ImageRef;
  prepared: PreparedRef;
};
const stripCheck = object({
  id: string,
  image: imageCheck,
  prepared: preparedCheck,
  config: configCheck,
  appearance: object({ brightness: number, contrast: number }),
  mode: oneOf("auto", "dark", "light"),
  control: integer(0, 31),
  count: number,
  selected: integer(0, 31),
  bands: bandsCheck,
  warnings: warningsCheck,
  polarity: polarityCheck,
});
type RowRef = Omit<QuickRow, "gray"> & { gray: number };
type LoadedRef = Omit<QuickLoaded, "image" | "rows"> & {
  image: ImageRef;
  rows: RowRef[];
};
const loadedCheck = object({
  image: imageCheck,
  rows: array(
    object(
      {
        bounds: rectCheck,
        gray: fileIndex,
        bands: bandsCheck,
        warnings: warningsCheck,
        label: string,
      },
      { automaticLabel: integer(1, 16) },
    ),
    16,
  ),
  warnings: warningsCheck,
  polarity: polarityCheck,
});
const quickFields = {
  inspectReference: bool,
  externalActive: integer(0, 15),
  active: integer(0, 15),
  reference: string,
  control: integer(0, 31),
  labels: array(string, 32),
  polarity: polarityCheck,
  selected: integer(0, 31),
  editing: bool,
  editBackground: bool,
  count: number,
  showBoxes: bool,
};
const singleCheck = object({
  mode: oneOf("single"),
  strips: array(stripCheck, 6),
  activeId: string,
  editing: bool,
  kind: oneOf("rect", "background"),
  completeness: warningsCheck,
});
const quickCheck = object({
  mode: oneOf("quick"),
  data: nullable(loadedCheck),
  external: nullable(loadedCheck),
  ...quickFields,
  completeness: warningsCheck,
});

function bytesFromDataUrl(dataUrl: string): Uint8Array {
  if (
    !dataUrl.startsWith("data:image/png;base64,") ||
    dataUrl.length > 150_000_000
  )
    invalid();
  const binary = atob(dataUrl.slice("data:image/png;base64,".length));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}
function dataUrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "data:image/png;base64," + btoa(binary);
}
function checkPreview(bytes: Uint8Array, width: number, height: number): void {
  // A preview is a browser-generated PNG, not arbitrary HTML/SVG or a remote URL.
  if (
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
  )
    invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (width * height > QUICK_IMAGE_LIMITS.maxPixels) invalid();
  if (
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR" ||
    view.getUint32(16) !== width ||
    view.getUint32(20) !== height ||
    bytes[24] !== 8
  )
    invalid();
  const decoded = decodePng(bytes, { checkCrc: true });
  if (decoded.width !== width || decoded.height !== height) invalid();
}
class PackageWriter {
  files: File[] = [];
  private arrays = new Map<Uint8Array, number>();
  private images = new Map<QuickImage, ImageRef>();
  binary(
    bytes: Uint8Array,
    name: string,
    type = "application/octet-stream",
  ): number {
    const previous = this.arrays.get(bytes);
    if (previous !== undefined) return previous;
    const i =
      this.files.push(
        new File([Uint8Array.from(bytes).buffer], name, {
          type,
          lastModified: 0,
        }),
      ) - 1;
    this.arrays.set(bytes, i);
    return i;
  }
  image(image: QuickImage): ImageRef {
    const previous = this.images.get(image);
    if (previous) return previous;
    const preview = bytesFromDataUrl(image.dataUrl);
    checkPreview(preview, image.width, image.height);
    const ref: ImageRef = {
      name: image.name,
      width: image.width,
      height: image.height,
      gray: this.binary(image.gray, "measurement-gray.bin"),
      preview: this.binary(preview, "preview.png", "image/png"),
      original: image.original
        ? {
            mime: image.original.mime,
            file: this.binary(
              image.original.bytes,
              image.name,
              image.original.mime,
            ),
          }
        : null,
      synthetic: image.synthetic === true,
    };
    this.images.set(image, ref);
    return ref;
  }
  prepared(value: PreparedRaster): PreparedRef {
    return {
      ...value,
      source: this.image(value.source),
      gray: this.binary(value.gray, "prepared-gray.bin"),
      valid: this.binary(value.valid, "prepared-valid.bin"),
    };
  }
  loaded(value: QuickLoaded | null): LoadedRef | null {
    return (
      value && {
        ...value,
        image: this.image(value.image),
        rows: value.rows.map((row) => ({
          ...row,
          gray: this.binary(row.gray, "row-gray.bin"),
        })),
      }
    );
  }
}
class PackageReader {
  used = new Set<number>();
  private bytes = new Map<number, Uint8Array>();
  constructor(private files: File[]) {}
  async binary(i: number): Promise<Uint8Array> {
    if (!this.files[i]) invalid();
    this.used.add(i);
    const previous = this.bytes.get(i);
    if (previous) return previous;
    const result = new Uint8Array(await this.files[i].arrayBuffer());
    this.bytes.set(i, result);
    return result;
  }
  async image(ref: ImageRef): Promise<QuickImage> {
    if (ref.width * ref.height > QUICK_IMAGE_LIMITS.maxPixels) invalid();
    const gray = await this.binary(ref.gray);
    if (gray.length !== ref.width * ref.height) invalid();
    const preview = await this.binary(ref.preview);
    checkPreview(preview, ref.width, ref.height);
    const original = ref.original
      ? { mime: ref.original.mime, bytes: await this.binary(ref.original.file) }
      : undefined;
    if (original) {
      const header = inspectQuickImage(original.bytes);
      if (
        header.width !== ref.width ||
        header.height !== ref.height ||
        header.mime !== original.mime
      )
        invalid();
    }
    return {
      name: ref.name,
      width: ref.width,
      height: ref.height,
      gray,
      dataUrl: dataUrlFromBytes(preview),
      ...(original ? { original } : {}),
      ...(ref.synthetic ? { synthetic: true } : {}),
    };
  }
  async prepared(
    ref: PreparedRef,
    config: PreparationConfig,
  ): Promise<PreparedRaster> {
    const source = await this.image(ref.source),
      gray = await this.binary(ref.gray),
      valid = await this.binary(ref.valid);
    if (
      ref.width * ref.height > QUICK_IMAGE_LIMITS.maxPixels ||
      gray.length !== ref.width * ref.height ||
      valid.length !== gray.length ||
      valid.some((v) => v > 1)
    )
      invalid();
    const prepared: PreparedRaster = { ...ref, source, gray, valid };
    // v1 geometry must reproduce the saved coordinate transform exactly. A future
    // incompatible geometry engine needs a format migration, never silent replay.
    const check = prepareRaster(source, config);
    if (
      !sameMetadata(check.metadata, ref.metadata) ||
      check.width !== ref.width ||
      check.height !== ref.height ||
      check.fullWidth !== ref.fullWidth ||
      check.fullHeight !== ref.fullHeight ||
      !(["x", "y", "width", "height"] as const).every(
        (key) => check.crop[key] === ref.crop[key],
      ) ||
      check.polarity !== ref.polarity ||
      !sameBytes(check.gray, gray) ||
      !sameBytes(check.valid, valid)
    )
      invalid();
    return prepared;
  }
  async loaded(ref: LoadedRef | null): Promise<QuickLoaded | null> {
    if (!ref) return null;
    const image = await this.image(ref.image);
    const rows: QuickRow[] = [];
    for (const row of ref.rows) {
      checkRect(row.bounds, image.width, image.height);
      const gray = await this.binary(row.gray);
      if (gray.length !== row.bounds.width * row.bounds.height) invalid();
      for (let y = 0; y < row.bounds.height; y++)
        for (let x = 0; x < row.bounds.width; x++) {
          if (
            gray[y * row.bounds.width + x] !==
            image.gray[(row.bounds.y + y) * image.width + row.bounds.x + x]
          )
            invalid();
        }
      checkBands(row.bands, row.bounds.width, row.bounds.height);
      rows.push({ ...row, gray });
    }
    return { ...ref, image, rows };
  }
  done(): void {
    if (this.used.size !== this.files.length) invalid();
  }
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function sameMetadata(a: PreparationMetadata, b: PreparationMetadata): boolean {
  // Property order is not part of JSON semantics.
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
function checkRect(rect: Rect, width: number, height: number): void {
  if (rect.x + rect.width > width || rect.y + rect.height > height) invalid();
}
function checkBands(bands: QuickBand[], width: number, height: number): void {
  if (new Set(bands.map((b) => b.id)).size !== bands.length) invalid();
  for (const band of bands) {
    checkRect(band.rect, width, height);
    if (band.background) checkRect(band.background, width, height);
  }
}
const missing = (image: QuickImage): string[] =>
  image.original || image.synthetic
    ? []
    : [
        `缺历史原文件；保留测量像素和预览 / Historical original missing; measurement pixels and preview retained: ${image.name}`,
      ];

export async function exportSingleProject(
  project: SingleProject,
): Promise<{ blob: Blob; completeness: string[] }> {
  const writer = new PackageWriter();
  const completeness = project.strips.flatMap((strip) =>
    missing(strip.prepared.source),
  );
  const state = {
    ...project,
    mode: "single",
    strips: project.strips.map((strip) => ({
      ...strip,
      image: writer.image(strip.image),
      prepared: writer.prepared(strip.prepared),
    })),
    completeness,
  };
  if (!singleCheck(state)) invalid();
  return {
    blob: await packProject("wb-single", state, writer.files),
    completeness,
  };
}
export async function importSingleProject(
  blob: Blob,
): Promise<{ project: SingleProject; completeness: string[] }> {
  const { state: raw, files } = await unpackProject(
    blob,
    "wb-single",
    singleCheck,
  );
  const state = raw as {
    strips: StripRef[];
    activeId: string;
    editing: boolean;
    kind: "rect" | "background";
  };
  const reader = new PackageReader(files);
  const strips: SingleStripState[] = [];
  if (
    state.strips.reduce(
      (sum, strip) =>
        sum + strip.prepared.source.width * strip.prepared.source.height,
      0,
    ) > 30_000_000
  )
    invalid();
  for (const strip of state.strips) {
    const image = await reader.image(strip.image),
      prepared = await reader.prepared(strip.prepared, strip.config);
    if (
      image.width !== prepared.width ||
      image.height !== prepared.height ||
      !sameBytes(image.gray, prepared.gray)
    )
      invalid();
    checkBands(strip.bands, image.width, image.height);
    if (
      strip.control >= Math.max(1, strip.bands.length) ||
      strip.selected >= Math.max(1, strip.bands.length) ||
      strip.appearance.brightness < 40 ||
      strip.appearance.brightness > 200 ||
      strip.appearance.contrast < 25 ||
      strip.appearance.contrast > 300
    )
      invalid();
    strips.push({ ...strip, image, prepared });
  }
  if (
    new Set(strips.map((s) => s.id)).size !== strips.length ||
    (strips.length
      ? !strips.some((s) => s.id === state.activeId)
      : state.activeId !== "")
  )
    invalid();
  reader.done();
  return {
    project: {
      strips,
      activeId: state.activeId,
      editing: state.editing,
      kind: state.kind,
    },
    completeness: strips.flatMap((strip) => missing(strip.prepared.source)),
  };
}
export async function exportQuickProject(
  project: QuickProject,
): Promise<{ blob: Blob; completeness: string[] }> {
  const writer = new PackageWriter();
  const completeness = [project.data, project.external].flatMap((loaded) =>
    loaded ? missing(loaded.image) : [],
  );
  const state = {
    ...project,
    mode: "quick",
    data: writer.loaded(project.data),
    external: writer.loaded(project.external),
    completeness,
  };
  if (!quickCheck(state)) invalid();
  return {
    blob: await packProject("wb-quick", state, writer.files),
    completeness,
  };
}
export async function importQuickProject(
  blob: Blob,
): Promise<{ project: QuickProject; completeness: string[] }> {
  const { state: raw, files } = await unpackProject(
    blob,
    "wb-quick",
    quickCheck,
  );
  const state = raw as Omit<QuickProject, "data" | "external"> & {
    data: LoadedRef | null;
    external: LoadedRef | null;
    mode: string;
    completeness: string[];
  };
  const reader = new PackageReader(files),
    data = await reader.loaded(state.data),
    external = await reader.loaded(state.external);
  if (
    state.active >= Math.max(1, data?.rows.length ?? 0) ||
    state.externalActive >= Math.max(1, external?.rows.length ?? 0) ||
    (state.inspectReference && !external)
  )
    invalid();
  const row = state.inspectReference
    ? external?.rows[state.externalActive]
    : data?.rows[state.active];
  if (
    state.selected >= Math.max(1, row?.bands.length ?? 0) ||
    state.control >= Math.max(1, data?.rows[state.active]?.bands.length ?? 0)
  )
    invalid();
  if (state.reference !== "none") {
    const match = /^(row|external):(\d+)$/.exec(state.reference);
    if (
      !match ||
      !(match[1] === "row" ? data : external)?.rows[Number(match[2])] ||
      (match[1] === "row" && Number(match[2]) === state.active)
    )
      invalid();
  }
  reader.done();
  const { mode: _mode, completeness: _completeness, ...rest } = state;
  return {
    project: { ...rest, data, external },
    completeness: [data, external].flatMap((loaded) =>
      loaded ? missing(loaded.image) : [],
    ),
  };
}
