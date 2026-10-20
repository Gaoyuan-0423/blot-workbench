import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { get, set } from "idb-keyval";
import { z } from "../schema-validator";
import { pairedTTest, type PairedTestResult } from "./statistics";
import { APP_VERSION } from "../core/types";
import {
  publicationSchema,
  validatePublicationSettings,
  type PublicationSettings,
} from "./publication-settings";
import {
  decodeRaster,
  inspectRasterDimensions,
  measureRegion,
  proposeRegions,
  type LaneMeasurement,
  type LaneRegion,
  type Raster,
  type Signal,
} from "./pixels";
import {
  cachedRollingBallBackground,
  ROLLING_BALL_ALGORITHM,
  ROLLING_BALL_RADIUS_RANGE,
  measureRegionRollingBall,
} from "./rolling-ball";

export interface ImageAnalysis {
  protein: string;
  role: "target" | "reference";
  replicate: string;
  membrane: string;
  exposure: string;
  regions: LaneRegion[];
  signal: Signal;
  reviewed: boolean;
  excluded: boolean;
  note: string;
  analysisError: string;
  revision: number;
}
export interface RealImageHistory extends ImageAnalysis {
  at: string;
  reason: string;
}
export interface RealImage extends ImageAnalysis {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  history: RealImageHistory[];
}
export interface PairedLanePair {
  groupId: string;
  unitId: string;
  normalLane: number;
  tumorLane: number;
}
export type NormalizationPolicy =
  { kind: "matched-control" } | { kind: "reference-unit"; unitId: string };
/**
 * Project-wide background correction. Absent means the historical local
 * mean-background method; "rolling-ball" is ImageJ-compatible (see
 * src/real/rolling-ball.ts) and carries its radius.
 */
export type BackgroundCorrection =
  | { kind: "local" }
  | { kind: "rolling-ball"; radius: number };
export interface RealProject {
  format: "blot-workbench-real";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  language: "zh" | "en";
  laneLabels: string[];
  laneDescription: string;
  targetLabel: string;
  referenceLabel: string;
  designConfirmed: boolean;
  pairedDesign?: { pairs: PairedLanePair[] };
  normalization?: NormalizationPolicy;
  backgroundCorrection?: BackgroundCorrection;
  /** New projects prefer one shared baseline; archives created before this field keep matched-control until chosen. */
  normalizationPreference?: "reference-unit";
  statisticalTest?: "none" | "paired-t";
  exampleKind?: "synthetic";
  /** Figure layout and source-document labels never affect measurement regions. */
  publication?: PublicationSettings;
  images: RealImage[];
}
export type ResultStatus = "draft" | "ready" | "blocked";
export interface RealResult {
  imageId: string;
  name: string;
  protein: string;
  replicate: string;
  membrane: string;
  exposure: string;
  lane: number;
  sample: string;
  unitId: string | null;
  controlLane: number | null;
  normalizationKind: NormalizationPolicy["kind"];
  baselineUnitId: string | null;
  baselineImageId: string | null;
  analysisRevision: number;
  referenceImageId: string | null;
  referenceRevision: number | null;
  targetNet: number | null;
  referenceNet: number | null;
  bandSum: number | null;
  area: number | null;
  backgroundMean: number | null;
  backgroundMethod: "local" | "rolling-ball";
  /** Rolling-ball radius when backgroundMethod is "rolling-ball"; else null. */
  rollingBallRadius: number | null;
  clippedFraction: number | null;
  referenceClippedFraction: number | null;
  ratio: number | null;
  controlRatio: number | null;
  fold: number | null;
  status: ResultStatus;
  warnings: string[];
}
export interface RealStatistics {
  protein: string;
  sample: string;
  mean: number | null;
  sd: number | null;
  n: number;
  values: number[];
  replicates: string[];
  status: ResultStatus;
  warning: string;
  warnings: string[];
  unitLabel: "independent experiments" | "paired sets" | "individuals";
}

const MAX_IMAGES = 48;
const MAX_LANES = 32;
const MAX_HISTORY = 2000;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_PIXELS = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES + 1024 * 1024;
const rasterCache = new WeakMap<Uint8Array, Raster>();
const now = () => new Date().toISOString();
const copyRegions = (regions: LaneRegion[]): LaneRegion[] =>
  regions.map((region) => ({
    ...region,
    band: { ...region.band },
    background: { ...region.background },
    ...(region.warnings ? { warnings: [...region.warnings] } : {}),
  }));
const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function markUpdated(project: RealProject, images: RealImage[]): RealProject {
  return { ...project, updatedAt: now(), images };
}
export function imageRaster(image: RealImage): Raster {
  let raster = rasterCache.get(image.bytes);
  if (!raster) {
    raster = decodeRaster(image.bytes, image.name);
    rasterCache.set(image.bytes, raster);
  }
  return raster;
}
function snapshot(image: RealImage, reason: string): RealImageHistory {
  return {
    protein: image.protein,
    role: image.role,
    replicate: image.replicate,
    membrane: image.membrane,
    exposure: image.exposure,
    regions: copyRegions(image.regions),
    signal: image.signal,
    reviewed: image.reviewed,
    excluded: image.excluded,
    note: image.note,
    analysisError: image.analysisError,
    revision: image.revision,
    at: now(),
    reason,
  };
}
function revise(
  image: RealImage,
  patch: Partial<ImageAnalysis>,
  reason: string,
): RealImage {
  ensure(
    image.history.length < MAX_HISTORY,
    "Image history limit reached / 图像历史记录已达到上限",
  );
  return {
    ...image,
    ...patch,
    regions: patch.regions ? copyRegions(patch.regions) : image.regions,
    revision: image.revision + 1,
    history: [...image.history, snapshot(image, reason)],
  };
}
export function createRealProject(
  name = "Western blot",
  language: "zh" | "en" = "zh",
): RealProject {
  const at = now();
  return {
    format: "blot-workbench-real",
    version: 1,
    id: crypto.randomUUID(),
    name: name.trim() || "Western blot",
    createdAt: at,
    updatedAt: at,
    language,
    laneLabels: ["NC", "Treatment", "marker"],
    laneDescription: "NC, Treatment, marker",
    targetLabel: "Target",
    referenceLabel: "Reference",
    designConfirmed: false,
    normalizationPreference: "reference-unit",
    images: [],
  };
}
export function updateRealProject(
  project: RealProject,
  patch: Partial<
    Pick<
      RealProject,
      | "name"
      | "language"
      | "targetLabel"
      | "referenceLabel"
      | "designConfirmed"
      | "exampleKind"
      | "statisticalTest"
      | "backgroundCorrection"
    >
  >,
): RealProject {
  const allowed = new Set([
    "name",
    "language",
    "targetLabel",
    "referenceLabel",
    "designConfirmed",
    "exampleKind",
    "statisticalTest",
    "backgroundCorrection",
  ]);
  ensure(
    Object.keys(patch).every((key) => allowed.has(key)),
    "Unsupported project field / 不支持修改该项目字段",
  );
  for (const field of ["name", "targetLabel", "referenceLabel"] as const)
    if (patch[field] !== undefined)
      ensure(
        typeof patch[field] === "string" &&
          patch[field]!.trim().length > 0 &&
          patch[field]!.length <= 200,
        "Invalid project text / 项目文字无效",
      );
  if (patch.language !== undefined)
    ensure(
      patch.language === "zh" || patch.language === "en",
      "Invalid language / 语言无效",
    );
  if (patch.statisticalTest !== undefined)
    ensure(
      patch.statisticalTest === "none" || patch.statisticalTest === "paired-t",
      "Invalid statistical test / 统计检验选项无效",
    );
  if (patch.exampleKind !== undefined)
    ensure(
      patch.exampleKind === "synthetic",
      "Invalid example kind / 示例类型无效",
    );
  if (patch.designConfirmed !== undefined)
    ensure(
      typeof patch.designConfirmed === "boolean",
      "Invalid design confirmation / 实验设计确认值无效",
    );
  if (patch.backgroundCorrection !== undefined) {
    const correction = patch.backgroundCorrection;
    ensure(
      correction.kind === "local" ||
        (correction.kind === "rolling-ball" &&
          Number.isSafeInteger(correction.radius) &&
          correction.radius >= ROLLING_BALL_RADIUS_RANGE.min &&
          correction.radius <= ROLLING_BALL_RADIUS_RANGE.max),
      "Invalid background correction / 背景扣除方法无效",
    );
  }
  if (
    Object.entries(patch).every(
      ([key, value]) => value === project[key as keyof RealProject],
    )
  )
    return project;
  const labelsChanged =
    (patch.targetLabel !== undefined &&
      patch.targetLabel !== project.targetLabel) ||
    (patch.referenceLabel !== undefined &&
      patch.referenceLabel !== project.referenceLabel);
  const correctionChanged =
    patch.backgroundCorrection !== undefined &&
    JSON.stringify(patch.backgroundCorrection) !==
      JSON.stringify(project.backgroundCorrection);
  const methodChanged = labelsChanged || correctionChanged;
  const images = methodChanged
    ? project.images.map((image) =>
        image.reviewed
          ? revise(
              image,
              { reviewed: false },
              correctionChanged
                ? "background-method-changed"
                : "protein-settings-changed",
            )
          : image,
      )
    : project.images;
  return {
    ...markUpdated(project, images),
    ...patch,
    ...(labelsChanged ? { designConfirmed: false } : {}),
  };
}
/** Save presentation settings without invalidating measurements or review. */
export function updateRealPublication(
  project: RealProject,
  value: PublicationSettings,
): RealProject {
  const publication = validatePublicationSettings(
    value,
    project.images.map((image) => {
      const raster = imageRaster(image);
      return { id: image.id, width: raster.width, height: raster.height };
    }),
  );
  if (JSON.stringify(project.publication) === JSON.stringify(publication))
    return project;
  return { ...project, publication, updatedAt: now() };
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Filename information is a suggestion only: every imported image starts unreviewed. */
function inferMetadata(
  project: RealProject,
  name: string,
): Pick<RealImage, "protein" | "role" | "replicate" | "membrane" | "exposure"> {
  const stem = name.replace(/\.(?:png|tiff?)$/i, "");
  const isReference =
    /(?:^|[^a-z])(?:tubulin|tublin|tub|gapdh|actin|reference|ref)(?=$|[^a-z])/i.test(
      stem,
    ) ||
    (normalized(project.referenceLabel).length > 1 &&
      normalized(stem).includes(normalized(project.referenceLabel)));
  const explicitRep = stem.match(
    /(?:rep(?:licate)?|exp(?:eriment)?|实验|重复)[\s_-]*(\d+)(?=$|[^\d])/i,
  );
  const exposureMatch = stem.match(
    /(?:^|[\s_-])(\d+(?:\.\d+)?)\s*(ms|s|sec)(?=$|[\s_-])/i,
  );
  const withoutExposure = exposureMatch
    ? stem.replace(exposureMatch[0], "")
    : stem;
  const tailRep = withoutExposure.match(/(?:^|[^\d])(\d{1,3})$/);
  const replicate = explicitRep?.[1] ?? tailRep?.[1] ?? "";
  const alias = stem
    .match(/(?:^|[^a-z])(tubulin|tublin|tub|gapdh|actin)(?=$|[^a-z])/i)?.[1]
    .toLowerCase();
  const canonicalReference =
    alias && ["tub", "tublin", "tubulin"].includes(alias)
      ? "Tubulin"
      : alias === "gapdh"
        ? "GAPDH"
        : alias === "actin"
          ? "Actin"
          : project.referenceLabel;
  const inferredStem = withoutExposure
    .replace(
      /[\s_-]*(?:rep(?:licate)?|exp(?:eriment)?|实验|重复)?\d{1,3}$/i,
      "",
    )
    .replace(/[\s_-]+$/, "");
  const inferredTarget = /^[A-Za-z][A-Za-z0-9 _-]*$/.test(inferredStem)
    ? inferredStem
    : undefined;
  return {
    protein: isReference
      ? canonicalReference
      : normalized(project.targetLabel) !== "target"
        ? project.targetLabel
        : inferredTarget &&
            !/^(?:image|scan|blot|target)$/i.test(inferredTarget)
          ? inferredTarget
          : project.targetLabel,
    role: isReference ? "reference" : "target",
    replicate,
    membrane: replicate ? `M${replicate}` : "",
    exposure: exposureMatch ? `${exposureMatch[1]}${exposureMatch[2]}` : "",
  };
}
export async function importRealImages(
  project: RealProject,
  files: { name: string; bytes: Uint8Array }[],
): Promise<RealProject> {
  ensure(
    files.length > 0 && project.images.length + files.length <= MAX_IMAGES,
    "Import 1–48 images per project / 每个项目最多 48 张图像",
  );
  let total = project.images.reduce(
    (sum, image) => sum + image.bytes.length,
    0,
  );
  let pixelCount = project.images.reduce((sum, image) => {
    const raster = imageRaster(image);
    return sum + raster.width * raster.height;
  }, 0);
  const hashes = new Set(project.images.map((image) => image.hash));
  const additions: RealImage[] = [];
  for (const file of files) {
    ensure(
      file.name.length > 0 &&
        file.name.length <= 500 &&
        !/[\u0000-\u001f]/.test(file.name),
      "Invalid image name / 图像名称无效",
    );
    ensure(
      file.bytes.length > 0 && file.bytes.length <= MAX_IMAGE_BYTES,
      "Image file exceeds 64 MiB / 图像文件须小于 64 MiB",
    );
    total += file.bytes.length;
    ensure(
      total <= MAX_TOTAL_BYTES,
      "Original images exceed 256 MiB / 原始图像总量超出 256 MiB",
    );
    const bytes = new Uint8Array(file.bytes);
    const dimensions = inspectRasterDimensions(bytes, file.name);
    ensure(
      pixelCount + dimensions.width * dimensions.height <= MAX_TOTAL_PIXELS,
      "Decoded project exceeds 32 megapixels / 项目解码后的图像总量超出 32 兆像素",
    );
    const raster = decodeRaster(bytes, file.name);
    pixelCount += raster.width * raster.height;
    ensure(
      pixelCount <= MAX_TOTAL_PIXELS,
      "Decoded project exceeds 32 megapixels / 项目解码后的图像总量超出 32 兆像素",
    );
    const hash = await sha256(bytes);
    ensure(
      !hashes.has(hash),
      "Duplicate original image / 已存在相同原始图像，不能作为新的重复导入",
    );
    hashes.add(hash);
    rasterCache.set(bytes, raster);
    additions.push({
      id: crypto.randomUUID(),
      name: file.name,
      bytes,
      hash,
      ...inferMetadata(project, file.name),
      signal: "dark",
      regions: [],
      reviewed: false,
      excluded: false,
      note: "",
      analysisError: "",
      revision: 1,
      history: [],
    });
  }
  // Adding files can introduce ambiguous pairings; retain previous review snapshots.
  const existing = project.images.map((image) =>
    image.reviewed ? revise(image, { reviewed: false }, "images-added") : image,
  );
  return {
    ...markUpdated(project, [...existing, ...additions]),
    exampleKind: undefined,
    statisticalTest: "none",
    designConfirmed: false,
  };
}

export function isExcludedLane(label: string): boolean {
  return (
    /^(?:marker|ladder|分子量(?:标记)?|标记)(?:$|[\s(（:：_-])/i.test(
      label.trim(),
    ) || /^!/.test(label.trim())
  );
}
export function isControlLane(label: string): boolean {
  return ["nc", "control", "negativecontrol", "对照", "阴性对照"].includes(
    normalized(label),
  );
}
function laneNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digit = (char: string) => "零一二三四五六七八九".indexOf(char);
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (tens ? digit(tens) : 1) * 10 + (ones ? digit(ones) : 0);
  }
  return digit(text);
}
/** Deliberately deterministic: CSV labels or explicit lane-number assignments only. */
export function applyLaneDescription(
  project: RealProject,
  description: string,
): RealProject {
  ensure(
    description.length <= 4000,
    "Lane description is too long / 泳道说明过长",
  );
  const text = description.trim();
  let labels: string[];
  const assignments = text
    .split(/[,，;；\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const explicit = assignments.map((part) =>
    part.match(
      /^(?:第([一二三四五六七八九十]{1,3}|\d+)(?:条|个)?(?:泳道)?|(?:lane|泳道)\s*(\d+)|(\d+)\s*(?=[=:：]))\s*(?:是|为|[=:：])?\s*(.+)$/i,
    ),
  );
  if (explicit.length && explicit.every(Boolean)) {
    const numbered = explicit
      .map((match) => ({
        lane: laneNumber(match![1] ?? match![2] ?? match![3]),
        label: match![4].trim(),
      }))
      .sort((a, b) => a.lane - b.lane);
    ensure(
      numbered.every((entry, index) => entry.lane === index + 1),
      "Number lanes consecutively from 1 / 泳道编号须从 1 连续排列",
    );
    labels = numbered.map((entry) => entry.label);
  } else {
    ensure(
      !explicit.some(Boolean) && !/[;；\n=:：]/.test(text),
      "Use CSV labels or explicit lane numbers / 请用逗号列表或明确的泳道编号，暂不解析自由描述",
    );
    labels = text.split(/[,，、]/).map((label) => label.trim());
  }
  ensure(
    labels.length >= 2 &&
      labels.length <= MAX_LANES &&
      labels.every((label) => label.length > 0 && label.length <= 100),
    "Specify 2–32 nonempty lane labels / 请填写 2–32 个非空泳道标签",
  );
  ensure(
    labels.filter(isControlLane).length === 1,
    "Exactly one NC/control lane is required / 须明确指定一个 NC 或对照泳道",
  );
  const included = labels
    .filter((label) => !isExcludedLane(label))
    .map(normalized);
  ensure(
    new Set(included).size === included.length,
    "Duplicate condition labels require an explicit technical-replicate model / 当前请为每个条件设置一个泳道，不能将重复泳道当独立样本",
  );
  if (
    !project.pairedDesign &&
    JSON.stringify(labels) === JSON.stringify(project.laneLabels) &&
    text === project.laneDescription
  )
    return project;
  const changed =
    Boolean(project.pairedDesign) ||
    JSON.stringify(labels) !== JSON.stringify(project.laneLabels);
  return {
    ...markUpdated(
      project,
      changed
        ? project.images.map((image) =>
            revise(
              image,
              {
                reviewed: false,
                regions: image.regions.filter(
                  (region) => region.lane <= labels.length,
                ),
              },
              "lane-labels-changed",
            ),
          )
        : project.images,
    ),
    pairedDesign: undefined,
    laneLabels: labels,
    laneDescription: text,
    statisticalTest: changed ? "none" : project.statisticalTest,
    designConfirmed: changed ? false : project.designConfirmed,
  };
}

/** Explicit individual identities, never inferred from lane order or file names. */
export function applyPairedDesign(
  project: RealProject,
  pairs: PairedLanePair[] | null,
): RealProject {
  if (pairs === null) {
    if (!project.pairedDesign) return project;
    return applyLaneDescription(
      { ...project, pairedDesign: undefined, designConfirmed: false },
      "NC, Treatment, marker",
    );
  }
  const checked = validatePairedPairs(pairs);
  if (JSON.stringify(checked) === JSON.stringify(project.pairedDesign?.pairs))
    return project;
  const laneCount = Math.max(
    ...checked.flatMap((pair) => [pair.normalLane, pair.tumorLane]),
  );
  const laneLabels = Array.from({ length: laneCount }, (_, index) => {
    const roles = new Set(
      checked.flatMap((pair) => [
        ...(pair.normalLane === index + 1 ? ["N"] : []),
        ...(pair.tumorLane === index + 1 ? ["T"] : []),
      ]),
    );
    return roles.size === 1
      ? `${[...roles][0]} · ${index + 1}`
      : `Lane ${index + 1}`;
  });
  return {
    ...markUpdated(
      project,
      project.images.map((image) =>
        revise(
          image,
          {
            reviewed: false,
            regions: image.regions.filter((region) => region.lane <= laneCount),
          },
          "paired-design-changed",
        ),
      ),
    ),
    pairedDesign: { pairs: checked },
    statisticalTest: "none",
    laneLabels,
    laneDescription: "Explicit individual N/T pairs / 明确个体 N/T 配对",
    designConfirmed: false,
  };
}
export function applyNormalization(
  project: RealProject,
  policy: NormalizationPolicy,
): RealProject {
  const parsed = normalizationSchema.parse(policy);
  const checked: NormalizationPolicy =
    parsed.kind === "reference-unit"
      ? { ...parsed, unitId: parsed.unitId.trim() }
      : parsed;
  ensure(
    checked.kind !== "reference-unit" || checked.unitId.length > 0,
    "Select a reference unit / 请选择归一化基准个体或实验",
  );
  // Only a stored policy equal to the target is a true no-op. An explicit
  // choice that matches the implicit default is still recorded, so the
  // default can be confirmed or overridden predictably.
  if (
    project.normalization &&
    JSON.stringify(project.normalization) === JSON.stringify(checked)
  )
    return project;
  return {
    ...markUpdated(
      project,
      project.images.map((image) =>
        image.reviewed
          ? revise(image, { reviewed: false }, "normalization-changed")
          : image,
      ),
    ),
    normalization: checked,
  };
}

function validatePairedPairs(pairs: PairedLanePair[]): PairedLanePair[] {
  const checked = pairedDesignSchema.parse({ pairs }).pairs.map((pair) => ({
    ...pair,
    groupId: pair.groupId.trim(),
    unitId: pair.unitId.trim(),
  }));
  const identities = new Set<string>();
  const lanes = new Set<string>();
  for (const pair of checked) {
    ensure(
      pair.groupId && pair.unitId,
      "Pair group and individual IDs must be nonempty / 配对组及个体编号不能为空",
    );
    ensure(
      pair.normalLane !== pair.tumorLane,
      "Normal and tumor lanes must differ / 正常和肿瘤泳道不能相同",
    );
    const identity = JSON.stringify([pair.groupId, pair.unitId]);
    ensure(
      !identities.has(identity),
      "Duplicate individual within a group / 同一组的个体编号重复",
    );
    identities.add(identity);
    for (const lane of [pair.normalLane, pair.tumorLane]) {
      const key = JSON.stringify([pair.groupId, lane]);
      ensure(
        !lanes.has(key),
        "A lane cannot belong to multiple pairs in a group / 同一组的泳道不能属于多个配对",
      );
      lanes.add(key);
    }
  }
  return checked;
}

export type RealImagePatch = Partial<Omit<ImageAnalysis, "revision">>;
export function updateRealImage(
  project: RealProject,
  imageId: string,
  patch: RealImagePatch,
): RealProject {
  const image = project.images.find((entry) => entry.id === imageId);
  ensure(image, "Image not found / 找不到图像");
  const allowed = new Set([
    "protein",
    "role",
    "replicate",
    "membrane",
    "exposure",
    "regions",
    "signal",
    "reviewed",
    "excluded",
    "note",
    "analysisError",
  ]);
  ensure(
    Object.keys(patch).every((key) => allowed.has(key)),
    "Original image properties cannot be changed / 原始图像字段不可修改",
  );
  const candidate = { ...image, ...patch };
  analysisSchema.parse(candidateAnalysis(candidate));
  validateRegions(candidate.regions, imageRaster(image));
  const changedKeys = Object.keys(patch).filter(
    (key) =>
      JSON.stringify(image[key as keyof RealImage]) !==
      JSON.stringify(patch[key as keyof RealImagePatch]),
  );
  if (!changedKeys.length) return project;
  const analyticalChange = changedKeys.some(
    (key) => key !== "note" && key !== "reviewed",
  );
  const own = revise(
    image,
    {
      ...patch,
      ...(patch.regions ? { analysisError: patch.analysisError ?? "" } : {}),
      ...(analyticalChange ? { reviewed: false } : {}),
    },
    "image-updated",
  );
  const pairMatches = (target: RealImage, reference: RealImage) =>
    target.replicate === reference.replicate &&
    target.membrane === reference.membrane;
  const updated = markUpdated(
    project,
    project.images.map((entry) => {
      if (entry.id === imageId) return own;
      if (
        (image.role === "reference" || own.role === "reference") &&
        changedKeys.some((key) => key !== "note") &&
        entry.role === "target" &&
        entry.reviewed &&
        (pairMatches(entry, image) || pairMatches(entry, own))
      )
        return revise(entry, { reviewed: false }, "reference-changed");
      return entry;
    }),
  );
  return changedKeys.some((key) =>
    ["protein", "role", "replicate", "membrane", "exposure"].includes(key),
  )
    ? { ...updated, designConfirmed: false }
    : updated;
}
// Only known, user-actionable proposal failures may be persisted in projects.
// Unexpected exception text can contain implementation details and stays private.
const publicProposalErrors = new Set([
  "Image is too small to propose band and background ROIs.",
  "No band row has sufficient contrast; select ROIs manually.",
  "Multiple comparable band rows are ambiguous; select ROIs manually.",
  "Fewer resolved lanes than requested; overlapping or weak bands need manual ROIs.",
  "A requested lane has no resolvable band; overlapping or empty lanes need manual ROIs.",
  "Insufficient adjacent background space; select band/background ROIs manually.",
]);

export function analyzeAll(project: RealProject, force = false): RealProject {
  ensure(
    project.laneLabels.length >= 2 && project.laneLabels.length <= MAX_LANES,
    "Set lane labels first / 请先设置泳道标签",
  );
  let next = project;
  const laneCount = project.laneLabels.reduce(
    (count, label, index) => (isExcludedLane(label) ? count : index + 1),
    0,
  );
  ensure(
    laneCount >= 2,
    "At least two active lanes are required / 至少需要两个有效泳道",
  );
  for (const image of project.images) {
    if (image.excluded) continue;
    const manual = new Map(
      image.regions
        .filter((region) => region.source === "manual")
        .map((region) => [region.lane, region]),
    );
    const activeLanes = project.pairedDesign
      ? [
          ...new Set(
            project.pairedDesign.pairs
              .filter((pair) => pair.groupId.trim() === image.replicate.trim())
              .flatMap((pair) => [pair.normalLane, pair.tumorLane]),
          ),
        ]
      : project.laneLabels
          .map((label, index) => (isExcludedLane(label) ? 0 : index + 1))
          .filter(Boolean);
    if (!activeLanes.length) {
      next = updateRealImage(next, image.id, {
        analysisError:
          "No paired lane design for this group / 此组尚未设置配对泳道",
      });
      continue;
    }
    if (!force && activeLanes.every((lane) => manual.has(lane))) continue;
    try {
      const proposals = proposeRegions(
        imageRaster(image),
        project.pairedDesign ? Math.max(...activeLanes) : laneCount,
        image.signal,
      );
      const regions = proposals.map((region) =>
        !force && manual.has(region.lane) ? manual.get(region.lane)! : region,
      );
      next = updateRealImage(next, image.id, { regions, analysisError: "" });
    } catch (problem) {
      next = updateRealImage(next, image.id, {
        analysisError:
          problem instanceof Error && publicProposalErrors.has(problem.message)
            ? problem.message
            : "Automatic proposal failed; review regions manually / 自动定位未完成，请人工检查区域",
      });
    }
  }
  return next;
}

function measurement(
  project: RealProject,
  image: RealImage,
  lane: number,
): LaneMeasurement | null {
  const region = image.regions.find((entry) => entry.lane === lane);
  if (!region) return null;
  try {
    const correction = project.backgroundCorrection;
    const result =
      correction?.kind === "rolling-ball"
        ? measureRegionRollingBall(
            imageRaster(image),
            region,
            image.signal,
            cachedRollingBallBackground(
              imageRaster(image),
              correction.radius,
              image.signal,
            ),
          )
        : measureRegion(imageRaster(image), region, image.signal);
    return {
      ...result,
      warnings: result.warnings.filter(
        (warning) => !image.reviewed || warning !== "CANDIDATES_REQUIRE_REVIEW",
      ),
    };
  } catch {
    // Invalid geometry is a blocked row, never a reason to crash the result view.
    return null;
  }
}
function pairKey(image: RealImage): string {
  return JSON.stringify([image.replicate.trim(), image.membrane.trim()]);
}
const distinct = (messages: string[]) => [...new Set(messages)];
function requiresAttention(warning: string): boolean {
  return !/^(?:(?:Control target|Control reference|Reference): )?(?:RGB_MEAN_INTENSITY|OPAQUE_ALPHA_IGNORED|WHITE_IS_ZERO_INVERTED|METADATA_SUBDIRECTORIES_IGNORED)$/.test(
    warning,
  );
}
function hasBandBackgroundOverlap(image: RealImage): boolean {
  return image.regions.some(({ band }) =>
    image.regions.some(
      ({ background }) =>
        band.x < background.x + background.width &&
        band.x + band.width > background.x &&
        band.y < background.y + background.height &&
        band.y + band.height > background.y,
    ),
  );
}
function hasActiveBandOverlap(image: RealImage, labels: string[]): boolean {
  const active = image.regions.filter(
    (region) =>
      labels[region.lane - 1] !== undefined &&
      !isExcludedLane(labels[region.lane - 1]),
  );
  return active.some(({ band: a }, index) =>
    active
      .slice(index + 1)
      .some(
        ({ band: b }) =>
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y,
      ),
  );
}
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
/** Units eligible as a common baseline: pair individuals, or non-excluded target experiment IDs. */
export function normalizationUnitIds(project: RealProject): string[] {
  return project.pairedDesign
    ? uniqueStrings(project.pairedDesign.pairs.map((pair) => pair.unitId))
    : uniqueStrings(
        project.images
          .filter((entry) => entry.role === "target" && !entry.excluded)
          .map((entry) => entry.replicate.trim())
          .filter(Boolean),
      );
}
/**
 * The policy results actually use. New projects default to one shared
 * baseline (first available unit) until an explicit policy is chosen;
 * archives without the preference keep the historical matched-control.
 */
export function effectiveNormalization(
  project: RealProject,
): NormalizationPolicy {
  if (project.normalization) return project.normalization;
  if (project.normalizationPreference === "reference-unit") {
    const units = normalizationUnitIds(project);
    if (units.length > 0) return { kind: "reference-unit", unitId: units[0] };
  }
  return { kind: "matched-control" };
}
export function results(project: RealProject): RealResult[] {
  const output: RealResult[] = [];
  const policy = effectiveNormalization(project);
  const controlIndexes = project.laneLabels
    .map((label, index) => (isControlLane(label) ? index + 1 : 0))
    .filter(Boolean);
  const controlLane = controlIndexes.length === 1 ? controlIndexes[0] : 0;
  for (const target of project.images.filter(
    (image) => image.role === "target",
  )) {
    const group = pairKey(target);
    const references = project.images.filter(
      (image) =>
        image.role === "reference" &&
        !image.excluded &&
        pairKey(image) === group,
    );
    const reference = references.length === 1 ? references[0] : null;
    const targets = project.images.filter(
      (image) =>
        image.role === "target" &&
        !image.excluded &&
        pairKey(image) === group &&
        normalized(image.protein) === normalized(target.protein),
    );
    const baseWarnings: string[] = [];
    let baseBlocked = false;
    const block = (warning: string) => {
      baseWarnings.push(warning);
      baseBlocked = true;
    };
    if (target.excluded) block("Target image is excluded / 目标图像已排除");
    if (target.analysisError || reference?.analysisError)
      block(
        "Automatic proposal needs attention / 自动定位尚有问题，请人工处理",
      );
    if (
      hasBandBackgroundOverlap(target) ||
      (reference && hasBandBackgroundOverlap(reference))
    )
      block(
        "A background region overlaps a band region / 背景区域与条带区域重叠",
      );
    if (
      hasActiveBandOverlap(target, project.laneLabels) ||
      (reference && hasActiveBandOverlap(reference, project.laneLabels))
    )
      block(
        "Included band regions overlap and would count pixels twice / 有效条带区域重叠，会重复计算同一像素",
      );
    if (!target.replicate.trim() || !target.membrane.trim())
      block("Confirm an experiment and membrane identifier / 缺少实验或膜编号");
    if (targets.length > 1)
      block(
        "Multiple target images for this experiment/membrane; select one exposure / 同实验同膜有多个目标图，请明确选择一个曝光",
      );
    if (references.length !== 1)
      block(
        "Exactly one reference image from the same experiment/membrane is required / 同实验同膜须有唯一内参图像",
      );
    if (
      reference &&
      normalized(project.referenceLabel) !== "reference" &&
      normalized(reference.protein) !== normalized(project.referenceLabel)
    )
      block(
        "Reference protein does not match project settings / 内参蛋白与项目设置不一致",
      );
    if (!controlLane && !project.pairedDesign)
      block("Exactly one NC/control lane is required / 须有唯一 NC 或对照泳道");
    if (!project.designConfirmed)
      baseWarnings.push(
        "Experimental independence and lane assignments are unconfirmed / 实验独立性及泳道设计尚未确认",
      );
    if (!target.reviewed || (reference && !reference.reviewed))
      baseWarnings.push(
        "Target and reference require manual review / 目标与内参均须人工复核",
      );
    const rasterWarnings = distinct([
      ...imageRaster(target).warnings,
      ...(reference ? imageRaster(reference).warnings : []),
    ]);
    baseWarnings.push(...rasterWarnings);
    const groupPairs = project.pairedDesign?.pairs.filter(
      (pair) => pair.groupId.trim() === target.replicate.trim(),
    );
    if (groupPairs && !groupPairs.length)
      block("No paired lane design for this group / 此组尚未设置配对泳道");
    const entries = groupPairs?.length
      ? groupPairs.flatMap((pair) => [
          {
            lane: pair.normalLane,
            sample: "N",
            unitId: pair.unitId.trim(),
            controlLane: pair.normalLane,
          },
          {
            lane: pair.tumorLane,
            sample: "T",
            unitId: pair.unitId.trim(),
            controlLane: pair.normalLane,
          },
        ])
      : project.laneLabels.flatMap((sample, index) =>
          isExcludedLane(sample)
            ? []
            : [
                {
                  lane: index + 1,
                  sample,
                  unitId: null,
                  controlLane,
                },
              ],
        );
    for (const entry of entries) {
      const { lane, sample, unitId, controlLane } = entry;
      const warnings = [...baseWarnings];
      let blocked = baseBlocked;
      const blockRow = (warning: string) => {
        warnings.push(warning);
        blocked = true;
      };
      const targetControl = controlLane
        ? measurement(project, target, controlLane)
        : null;
      const referenceControl =
        reference && controlLane ? measurement(project, reference, controlLane) : null;
      if (!targetControl || !referenceControl)
        blockRow(
          "Control band/background regions are missing / 缺少对照条带或背景区域",
        );
      if (
        (targetControl && targetControl.net <= 0) ||
        (referenceControl && referenceControl.net <= 0)
      )
        blockRow(
          "Control net signal is nonpositive / 对照净信号非正，不能归一化",
        );
      warnings.push(
        ...(targetControl?.warnings ?? []).map(
          (warning) => `Control target: ${warning}`,
        ),
        ...(referenceControl?.warnings ?? []).map(
          (warning) => `Control reference: ${warning}`,
        ),
      );
      if (
        (targetControl?.clippedFraction ?? 0) > 0 ||
        (referenceControl?.clippedFraction ?? 0) > 0
      )
        warnings.push(
          "Control contains clipped pixels; linearity is unverified / 对照区域存在端点截断，线性范围未验证",
        );
      const controlRatio =
        targetControl &&
        referenceControl &&
        targetControl.net > 0 &&
        referenceControl.net > 0
          ? targetControl.net / referenceControl.net
          : null;
      const measured = measurement(project, target, lane);
      const measuredReference = reference ? measurement(project, reference, lane) : null;
      if (!measured || !measuredReference) {
        blocked = true;
        warnings.push(
          "Band/background regions are missing / 缺少条带或背景区域",
        );
      }
      if (
        (measured && measured.net <= 0) ||
        (measuredReference && measuredReference.net <= 0)
      ) {
        blocked = true;
        warnings.push("Net signal is nonpositive / 净信号非正，不能计算比值");
      }
      warnings.push(
        ...(measured?.warnings ?? []),
        ...(measuredReference?.warnings ?? []).map(
          (warning) => `Reference: ${warning}`,
        ),
      );
      if (
        (measured?.clippedFraction ?? 0) > 0 ||
        (measuredReference?.clippedFraction ?? 0) > 0
      )
        warnings.push(
          "Clipped pixels; review cannot establish linearity / 存在端点截断，人工确认不能证明信号线性",
        );
      const ratio =
        !blocked && measured && measuredReference
          ? measured.net / measuredReference.net
          : null;
      const fold =
        ratio !== null && controlRatio !== null ? ratio / controlRatio : null;
      if (
        (ratio !== null && !Number.isFinite(ratio)) ||
        (fold !== null && !Number.isFinite(fold))
      ) {
        blocked = true;
        warnings.push("Non-finite normalization / 归一化结果不是有限值");
      }
      const allWarnings = distinct(warnings);
      output.push({
        imageId: target.id,
        name: target.name,
        protein: target.protein,
        replicate: target.replicate.trim(),
        membrane: target.membrane.trim(),
        exposure: target.exposure,
        lane,
        sample,
        unitId,
        controlLane: controlLane || null,
        normalizationKind: "matched-control",
        baselineUnitId: unitId ?? target.replicate.trim(),
        baselineImageId: target.id,
        analysisRevision: target.revision,
        referenceImageId: reference?.id ?? null,
        referenceRevision: reference?.revision ?? null,
        targetNet: measured?.net ?? null,
        referenceNet: measuredReference?.net ?? null,
        bandSum: measured?.bandSum ?? null,
        area: measured?.area ?? null,
        backgroundMean: measured?.backgroundMean ?? null,
        backgroundMethod:
          project.backgroundCorrection?.kind === "rolling-ball"
            ? "rolling-ball"
            : "local",
        rollingBallRadius:
          project.backgroundCorrection?.kind === "rolling-ball"
            ? project.backgroundCorrection.radius
            : null,
        clippedFraction: measured?.clippedFraction ?? null,
        referenceClippedFraction: measuredReference?.clippedFraction ?? null,
        ratio: blocked ? null : ratio,
        controlRatio: blocked ? null : controlRatio,
        fold: blocked ? null : fold,
        status: blocked
          ? "blocked"
          : allWarnings.some(requiresAttention)
            ? "draft"
            : "ready",
        warnings: allWarnings,
      });
    }
  }
  if (policy.kind === "reference-unit") {
    const baselineId = policy.unitId.trim();
    for (const row of output) {
      const controls = output.filter(
        (candidate) =>
          !project.images.find((image) => image.id === candidate.imageId)
            ?.excluded &&
          normalized(candidate.protein) === normalized(row.protein) &&
          (candidate.unitId ?? candidate.replicate) === baselineId &&
          candidate.lane === candidate.controlLane,
      );
      // Resolve against source ratios, never a previously normalized fold.
      const baseline =
        controls.length === 1 &&
        controls[0].ratio !== null &&
        controls[0].status !== "blocked"
          ? controls[0]
          : null;
      row.normalizationKind = "reference-unit";
      row.baselineUnitId = baselineId;
      row.baselineImageId = baseline?.imageId ?? null;
      row.controlRatio = baseline?.ratio ?? null;
      if (!baseline || !baseline.ratio || baseline.ratio <= 0) {
        row.fold = null;
        row.status = "blocked";
        row.warnings = distinct([
          ...row.warnings,
          "Reference-unit control is missing or ambiguous / 基准个体或实验的对照缺失或不唯一",
        ]);
        continue;
      }
      row.fold = row.ratio === null ? null : row.ratio / baseline.ratio;
      if (row.fold !== null && !Number.isFinite(row.fold)) {
        row.fold = null;
        row.status = "blocked";
        row.warnings.push("Non-finite normalization / 归一化结果不是有限值");
      }
      row.warnings = distinct([
        ...row.warnings,
        ...baseline.warnings,
        "Cross-experiment comparability is unverified; a shared baseline does not calibrate membranes or exposures / 跨实验可比性未验证，共同基准不能校准不同膜或曝光",
      ]);
      if (row.status !== "blocked") row.status = "draft";
    }
  }
  return output;
}

/** Descriptive summaries only. Multiple images or membranes never increase independent n. */
export function descriptiveStatistics(
  project: RealProject,
  protein?: string,
): RealStatistics[] {
  const rows = results(project);
  const proteins = [...new Set(rows.map((row) => row.protein))].filter(
    (label) => protein === undefined || label === protein,
  );
  const conditions = project.pairedDesign
    ? ["N", "T"]
    : project.laneLabels.filter((label) => !isExcludedLane(label));
  return proteins.flatMap((protein) => {
    const candidates = rows.filter(
      (row) =>
        row.protein === protein &&
        row.fold !== null &&
        row.status !== "blocked",
    );
    const grouped = new Map<string, RealResult[]>();
    for (const row of candidates)
      grouped.set(row.unitId ?? row.replicate, [
        ...(grouped.get(row.unitId ?? row.replicate) ?? []),
        row,
      ]);
    const complete = [...grouped.values()].filter((group) =>
      conditions.every(
        (condition) =>
          group.filter((row) => row.sample === condition).length === 1,
      ),
    );
    const summaryWarnings: string[] = [];
    if (
      [...grouped.values()].some((group) =>
        conditions.some(
          (condition) =>
            group.filter((row) => row.sample === condition).length > 1,
        ),
      )
    )
      summaryWarnings.push(
        project.pairedDesign
          ? "Repeated measurements of one individual were excluded from the summary / 同一个体的重复测量未作为独立个体汇总"
          : "Repeated measurements from one experiment were excluded from the summary / 同一实验的多次测量未作为独立重复汇总",
      );
    const allExperiments = new Set(
      rows
        .filter((row) => row.protein === protein)
        .map((row) => row.unitId ?? row.replicate),
    );
    if (complete.length < allExperiments.size)
      summaryWarnings.push(
        project.pairedDesign
          ? "Incomplete or ambiguous individual pairs were omitted from both N and T / 不完整或配对不明确的个体均未纳入 N 和 T 汇总"
          : "Incomplete or ambiguous paired experiments were omitted from every condition / 不完整或配对不明确的实验未纳入任何条件的汇总",
      );
    if (!project.designConfirmed)
      summaryWarnings.push(
        project.pairedDesign
          ? "n counts paired sets, not confirmed distinct individuals / n 仅为配对组数，不同个体尚未确认"
          : "n counts paired sets, not confirmed independent experiments / n 仅为配对组数，独立实验尚未确认",
      );
    return conditions.map((sample) => {
      const eligible = complete.map((group) =>
        group.find((row) => row.sample === sample)!,
      );
      const values = eligible.map((row) => row.fold!);
      const mean = values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
      const sd =
        values.length > 1 && mean !== null
          ? Math.sqrt(
              values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
                (values.length - 1),
            )
          : null;
      const warnings = distinct([
        ...eligible.flatMap((row) => row.warnings),
        ...summaryWarnings,
      ]);
      return {
        protein,
        sample,
        mean,
        sd,
        n: values.length,
        values,
        replicates: eligible.map((row) => row.unitId ?? row.replicate),
        status:
          values.length === 0
            ? "blocked"
            : warnings.some(requiresAttention)
              ? "draft"
              : "ready",
        warning: warnings.join("; "),
        warnings,
        unitLabel: project.designConfirmed
          ? project.pairedDesign
            ? "individuals"
            : "independent experiments"
          : "paired sets",
      };
    });
  });
}

export interface PairedInputSource {
  imageId: string;
  imageSha256: string;
  analysisRevision: number;
  referenceImageId: string | null;
  referenceSha256: string | null;
  referenceRevision: number | null;
  sourceGroup: string;
  membrane: string;
  exposure: string;
  referenceExposure: string;
  lane: number;
}
export interface RealPairedInput {
  id: string;
  control: number;
  treatment: number;
  controlSource: PairedInputSource;
  treatmentSource: PairedInputSource;
}
export interface RealPairedTest {
  protein: string;
  result: PairedTestResult | null;
  inputPairs: RealPairedInput[];
  status: "ok" | "unavailable";
  reason: string;
  quality: "draft" | "ready";
  warnings: string[];
}
/** A plot baseline never changes the paired t-test input: use original target/reference ratios. */
export function realPairedTests(project: RealProject): RealPairedTest[] {
  const rows = results(project);
  const proteins = [...new Set(rows.map((row) => row.protein))];
  const conditions = project.pairedDesign
    ? ["N", "T"]
    : project.laneLabels.filter((label) => !isExcludedLane(label));
  const summaries = descriptiveStatistics(project);
  return proteins.map((protein) => {
    const proteinSummaries = summaries.filter(
      (summary) => summary.protein === protein,
    );
    const warnings = distinct(
      proteinSummaries.flatMap((summary) => summary.warnings),
    );
    let quality = warnings.some(requiresAttention)
      ? ("draft" as const)
      : ("ready" as const);
    const unavailable = (reason: string): RealPairedTest => ({
      protein,
      result: null,
      inputPairs: [],
      status: "unavailable",
      reason,
      quality,
      warnings,
    });
    if (project.statisticalTest !== "paired-t")
      return unavailable("test-disabled");
    if (!project.designConfirmed) return unavailable("design-unconfirmed");
    if (conditions.length !== 2) return unavailable("requires-two-conditions");
    // The same complete, unambiguous unit set is used for both plotted groups and testing.
    const eligibleIds =
      proteinSummaries.length === 2
        ? proteinSummaries[0].replicates.filter((id) =>
            proteinSummaries[1].replicates.includes(id),
          )
        : [];
    const eligible = rows.filter(
      (row) =>
        row.protein === protein &&
        row.status !== "blocked" &&
        row.ratio !== null &&
        row.fold !== null,
    );
    const source = (row: RealResult): PairedInputSource => {
      const image = project.images.find((image) => image.id === row.imageId)!;
      const reference = project.images.find(
        (image) => image.id === row.referenceImageId,
      );
      return {
        imageId: row.imageId,
        imageSha256: image.hash,
        analysisRevision: row.analysisRevision,
        referenceImageId: row.referenceImageId,
        referenceSha256: reference?.hash ?? null,
        referenceRevision: row.referenceRevision,
        sourceGroup: row.replicate,
        membrane: row.membrane,
        exposure: image.exposure,
        referenceExposure: reference?.exposure ?? "",
        lane: row.lane,
      };
    };
    const pairs: RealPairedInput[] = eligibleIds.flatMap((id) => {
      const unitRows = eligible.filter(
        (row) => (row.unitId ?? row.replicate) === id,
      );
      const control = unitRows.filter((row) => row.lane === row.controlLane);
      const treatment = unitRows.filter((row) => row.lane !== row.controlLane);
      return control.length === 1 && treatment.length === 1
        ? [
            {
              id,
              control: control[0].ratio!,
              treatment: treatment[0].ratio!,
              controlSource: source(control[0]),
              treatmentSource: source(treatment[0]),
            },
          ]
        : [];
    });
    const measurementContexts = new Set(
      pairs.flatMap((pair) =>
        [pair.controlSource, pair.treatmentSource].map((entry) =>
          JSON.stringify([
            entry.sourceGroup,
            entry.membrane,
            entry.exposure.trim(),
            entry.referenceExposure.trim(),
          ]),
        ),
      ),
    );
    if (measurementContexts.size > 1) {
      warnings.push(
        "Inference combines target/reference ratios across membranes or acquisition settings; comparable scales have not been established / 检验合并了跨膜或不同采集条件的目标/内参比值，其尺度可比性尚未验证",
      );
      quality = "draft";
    }
    const result = pairedTTest(pairs);
    return {
      protein,
      result,
      inputPairs: pairs,
      status: result.status,
      reason: result.reason ?? "",
      quality,
      warnings,
    };
  });
}
export function exportRealStatisticsCsv(project: RealProject): string {
  const exportedAt = now();
  const policy = effectiveNormalization(project);
  const rows: (string | number | null)[][] = [
    [
      "project_id",
      "project_updated_at_utc",
      "exported_at_utc",
      "app_version",
      "project_format_version",
      "protein",
      "test_requested",
      "test_status",
      "unavailable_reason",
      "quality_status",
      "quality_warnings",
      "method",
      "alternative",
      "input_basis",
      "n_complete_pairs",
      "df",
      "t",
      "p_value_unadjusted",
      "mean_difference_treatment_minus_control",
      "ci95_low",
      "ci95_high",
      "individual_or_experiment_ids_json",
      "exact_input_pairs_and_provenance_json",
      "design_confirmed",
      "plot_normalization_method",
      "plot_reference_unit",
      "interpretation",
    ],
  ];
  for (const test of realPairedTests(project)) {
    const result = test.result;
    rows.push([
      project.id,
      project.updatedAt,
      exportedAt,
      APP_VERSION,
      project.version,
      test.protein,
      project.statisticalTest ?? "none",
      test.status,
      test.reason,
      test.quality.toUpperCase(),
      test.warnings.join("; "),
      result?.method ??
        (project.statisticalTest === "paired-t" ? "paired-t" : "none"),
      result?.alternative ?? "",
      result?.inputBasis ?? "",
      result?.n ?? null,
      result?.df ?? null,
      result?.t ?? null,
      result?.pValue ?? null,
      result?.meanDifference ?? null,
      result?.ci95?.[0] ?? null,
      result?.ci95?.[1] ?? null,
      result ? JSON.stringify(result.ids) : "",
      JSON.stringify(test.inputPairs),
      String(project.designConfirmed),
      policy.kind,
      policy.kind === "reference-unit" ? policy.unitId : "",
      "Two-sided paired t-test on original target/reference ratios; p is unadjusted; plot normalization does not change test inputs; quality warnings remain applicable",
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (
    typeof value === "string" &&
    (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
  )
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportRealCsv(project: RealProject): string {
  const rows: (string | number | null)[][] = [
    [
      "record_status",
      "warnings",
      "project_id",
      "project_format_version",
      "image_id",
      "image_name",
      "image_sha256",
      "protein",
      "source_group_or_experiment_id",
      "individual_id",
      "normalization_method",
      "baseline_unit_id",
      "baseline_image_id",
      "membrane_id",
      "exposure",
      "analysis_revision",
      "reference_image_id",
      "reference_revision",
      "lane",
      "condition",
      "design_confirmed",
      "band_sum",
      "area_px",
      "background_mean",
      "background_method",
      "rolling_ball_radius",
      "target_net",
      "reference_net",
      "target_clipped_fraction",
      "reference_clipped_fraction",
      "target_reference_ratio",
      "normalization_baseline_ratio",
      "fold_vs_control",
      "calculation",
      "statistical_test",
      "source_format",
      "source_bit_depth",
      "source_width",
      "source_height",
      "source_channels",
      "signal_polarity",
      "band_roi_json",
      "background_roi_json",
      "roi_source",
      "reference_name",
      "reference_sha256",
      "reference_format",
      "reference_bit_depth",
      "reference_width",
      "reference_height",
      "reference_channels",
      "reference_signal_polarity",
      "reference_band_roi_json",
      "reference_background_roi_json",
      "reference_roi_source",
      "reference_band_sum",
      "reference_area_px",
      "reference_background_mean",
      "control_lane",
      "control_target_net",
      "control_reference_net",
      "control_target_band_roi_json",
      "control_target_background_roi_json",
      "control_reference_band_roi_json",
      "control_reference_background_roi_json",
    ],
  ];
  const rectJson = (rect: LaneRegion["band"] | undefined) =>
    rect ? JSON.stringify(rect) : "";
  for (const row of results(project)) {
    const controlLane = row.controlLane ?? 0;
    const image = project.images.find((image) => image.id === row.imageId)!;
    const raster = imageRaster(image);
    const region = image.regions.find((region) => region.lane === row.lane);
    const reference = project.images.find(
      (image) => image.id === row.referenceImageId,
    );
    const referenceRaster = reference ? imageRaster(reference) : null;
    const referenceRegion = reference?.regions.find(
      (region) => region.lane === row.lane,
    );
    const referenceMeasurement = reference
      ? measurement(project, reference, row.lane)
      : null;
    const controlRegion = image.regions.find(
      (region) => region.lane === controlLane,
    );
    const controlReferenceRegion = reference?.regions.find(
      (region) => region.lane === controlLane,
    );
    rows.push([
      row.status.toUpperCase(),
      row.warnings.join("; "),
      project.id,
      project.version,
      row.imageId,
      row.name,
      project.images.find((image) => image.id === row.imageId)!.hash,
      row.protein,
      row.replicate,
      row.unitId,
      row.normalizationKind,
      row.baselineUnitId,
      row.baselineImageId,
      row.membrane,
      row.exposure,
      row.analysisRevision,
      row.referenceImageId,
      row.referenceRevision,
      row.lane,
      row.sample,
      String(project.designConfirmed),
      row.bandSum,
      row.area,
      row.backgroundMean,
      row.backgroundMethod,
      row.rollingBallRadius,
      row.targetNet,
      row.referenceNet,
      row.clippedFraction,
      row.referenceClippedFraction,
      row.ratio,
      row.controlRatio,
      row.fold,
      row.backgroundMethod === "rolling-ball"
        ? `local original pixels; ImageJ-compatible rolling ball r=${row.rollingBallRadius} (${ROLLING_BALL_ALGORITHM}); (target/reference)/declared baseline target/reference ratio`
        : "local original pixels; local mean background; (target/reference)/declared baseline target/reference ratio",
      project.statisticalTest === "paired-t"
        ? "paired-t requested; raw target/reference ratios; two-sided; unadjusted; actual results in separate statistics CSV"
        : "none; descriptive only",
      raster.format,
      raster.bitDepth,
      raster.width,
      raster.height,
      raster.channels,
      image.signal,
      rectJson(region?.band),
      rectJson(region?.background),
      region?.source ?? "",
      reference?.name ?? "",
      reference?.hash ?? "",
      referenceRaster?.format ?? "",
      referenceRaster?.bitDepth ?? null,
      referenceRaster?.width ?? null,
      referenceRaster?.height ?? null,
      referenceRaster?.channels ?? null,
      reference?.signal ?? "",
      rectJson(referenceRegion?.band),
      rectJson(referenceRegion?.background),
      referenceRegion?.source ?? "",
      referenceMeasurement?.bandSum ?? null,
      referenceMeasurement?.area ?? null,
      referenceMeasurement?.backgroundMean ?? null,
      controlLane || null,
      controlLane ? (measurement(project, image, controlLane)?.net ?? null) : null,
      reference && controlLane
        ? (measurement(project, reference, controlLane)?.net ?? null)
        : null,
      rectJson(controlRegion?.band),
      rectJson(controlRegion?.background),
      rectJson(controlReferenceRegion?.band),
      rectJson(controlReferenceRegion?.background),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const shortText = z.string().max(200);
const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
  );
const coordinate = z.number().int().min(0).max(100000);
const rectSchema = z
  .object({
    x: coordinate,
    y: coordinate,
    width: coordinate.min(1),
    height: coordinate.min(1),
  })
  .strict();
const regionSchema = z
  .object({
    lane: z.number().int().min(1).max(MAX_LANES),
    band: rectSchema,
    background: rectSchema,
    source: z.enum(["automatic", "manual"]),
    warnings: z.array(z.string().max(200)).max(32).optional(),
  })
  .strict();
const analysisSchema = z
  .object({
    protein: shortText.min(1),
    role: z.enum(["target", "reference"]),
    replicate: shortText,
    membrane: shortText,
    exposure: shortText,
    regions: z.array(regionSchema).max(MAX_LANES),
    signal: z.enum(["dark", "light"]),
    reviewed: z.boolean(),
    excluded: z.boolean(),
    note: z.string().max(10000),
    analysisError: z.string().max(1000).default(""),
    revision: z.number().int().min(1).max(1000000),
  })
  .strict();
const historySchema = analysisSchema
  .extend({
    at: z.string().datetime({ offset: true }),
    reason: z.string().max(200),
  })
  .strict();
const imageMetadataSchema = analysisSchema
  .extend({
    id: identifier,
    name: z.string().min(1).max(500),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    history: z.array(historySchema).max(MAX_HISTORY),
  })
  .strict();
const normalizationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("matched-control") }).strict(),
  z
    .object({ kind: z.literal("reference-unit"), unitId: shortText.min(1) })
    .strict(),
]);
const backgroundCorrectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }).strict(),
  z
    .object({
      kind: z.literal("rolling-ball"),
      radius: z.number().int().min(ROLLING_BALL_RADIUS_RANGE.min).max(ROLLING_BALL_RADIUS_RANGE.max),
    })
    .strict(),
]);
const pairedDesignSchema = z
  .object({
    pairs: z
      .array(
        z
          .object({
            groupId: shortText.min(1),
            unitId: shortText.min(1),
            normalLane: z.number().int().min(1).max(MAX_LANES),
            tumorLane: z.number().int().min(1).max(MAX_LANES),
          })
          .strict(),
      )
      .min(1)
      .max((MAX_IMAGES * MAX_LANES) / 2),
  })
  .strict();
const baseSchema = z
  .object({
    format: z.literal("blot-workbench-real"),
    version: z.literal(1),
    id: identifier,
    name: shortText.min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    language: z.enum(["zh", "en"]),
    laneLabels: z.array(z.string().min(1).max(100)).min(2).max(MAX_LANES),
    laneDescription: z.string().max(4000),
    targetLabel: shortText.min(1),
    referenceLabel: shortText.min(1),
    designConfirmed: z.boolean(),
    pairedDesign: pairedDesignSchema.optional(),
    normalization: normalizationSchema.optional(),
    backgroundCorrection: backgroundCorrectionSchema.optional(),
    normalizationPreference: z.literal("reference-unit").optional(),
    statisticalTest: z.enum(["none", "paired-t"]).optional(),
    exampleKind: z.literal("synthetic").optional(),
    publication: publicationSchema.optional(),
  })
  .strict();
const projectSchema = baseSchema
  .extend({
    images: z
      .array(
        imageMetadataSchema
          .extend({ bytes: z.instanceof(Uint8Array) })
          .strict(),
      )
      .max(MAX_IMAGES),
  })
  .strict();
const manifestSchema = baseSchema
  .extend({
    images: z
      .array(
        imageMetadataSchema
          .extend({
            path: z.string().regex(/^originals\/[A-Za-z0-9_-]+\.(?:png|tif)$/),
          })
          .strict(),
      )
      .max(MAX_IMAGES),
  })
  .strict();

function candidateAnalysis(image: ImageAnalysis): ImageAnalysis {
  const {
    protein,
    role,
    replicate,
    membrane,
    exposure,
    regions,
    signal,
    reviewed,
    excluded,
    note,
    analysisError,
    revision,
  } = image;
  return {
    protein,
    role,
    replicate,
    membrane,
    exposure,
    regions,
    signal,
    reviewed,
    excluded,
    note,
    analysisError,
    revision,
  };
}
function validateRegions(regions: LaneRegion[], raster: Raster): void {
  ensure(
    new Set(regions.map((region) => region.lane)).size === regions.length,
    "Duplicate lane regions / 泳道区域重复",
  );
  for (const region of regions)
    for (const rect of [region.band, region.background])
      ensure(
        rect.x >= 0 &&
          rect.y >= 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x + rect.width <= raster.width &&
          rect.y + rect.height <= raster.height,
        "Region exceeds original image bounds / 区域超出原始图像边界",
      );
}
async function validateProject(value: unknown): Promise<RealProject> {
  const project = projectSchema.parse(value) as RealProject;
  if (project.normalization?.kind === "reference-unit") {
    project.normalization.unitId = project.normalization.unitId.trim();
    ensure(
      project.normalization.unitId.length > 0,
      "Select a reference unit / 请选择归一化基准个体或实验",
    );
  }
  if (project.pairedDesign) {
    project.pairedDesign = {
      pairs: validatePairedPairs(project.pairedDesign.pairs),
    };
    ensure(
      project.pairedDesign.pairs.every(
        (pair) =>
          Math.max(pair.normalLane, pair.tumorLane) <=
          project.laneLabels.length,
      ),
      "Paired design references unknown lane / 配对设计引用了不存在的泳道",
    );
  } else {
    ensure(
      project.laneLabels.filter(isControlLane).length === 1,
      "Exactly one NC/control lane is required / 须有唯一 NC 或对照泳道",
    );
    const conditionLabels = project.laneLabels
      .filter((label) => !isExcludedLane(label))
      .map(normalized);
    ensure(
      new Set(conditionLabels).size === conditionLabels.length,
      "Duplicate condition labels / 条件标签重复",
    );
  }
  ensure(
    new Set(project.images.map((image) => image.id)).size ===
      project.images.length,
    "Duplicate image ID / 图像标识重复",
  );
  ensure(
    new Set(project.images.map((image) => image.hash)).size ===
      project.images.length,
    "Duplicate original image / 原始图像重复",
  );
  ensure(
    project.images.reduce((sum, image) => sum + image.bytes.length, 0) <=
      MAX_TOTAL_BYTES,
    "Original image size limit exceeded / 原始图像总量超限",
  );
  let pixelCount = 0;
  for (const image of project.images) {
    ensure(
      image.bytes.length > 0 && image.bytes.length <= MAX_IMAGE_BYTES,
      "Image size limit exceeded / 原始图像大小超限",
    );
    const dimensions = inspectRasterDimensions(image.bytes, image.name);
    ensure(
      pixelCount + dimensions.width * dimensions.height <= MAX_TOTAL_PIXELS,
      "Decoded project exceeds 32 megapixels / 项目解码后的图像总量超出 32 兆像素",
    );
    ensure(
      (await sha256(image.bytes)) === image.hash,
      "Original image checksum mismatch / 原始图像校验和不匹配",
    );
    const raster = imageRaster(image);
    pixelCount += raster.width * raster.height;
    ensure(
      pixelCount <= MAX_TOTAL_PIXELS,
      "Decoded project exceeds 32 megapixels / 项目解码后的图像总量超出 32 兆像素",
    );
    validateRegions(image.regions, raster);
    ensure(
      image.regions.every((region) => region.lane <= project.laneLabels.length),
      "Region references an unknown lane / 区域引用的泳道不存在",
    );
    let previous = 0;
    for (const old of image.history) {
      ensure(
        old.revision > previous && old.revision < image.revision,
        "Invalid history revisions / 历史版本顺序无效",
      );
      validateRegions(old.regions, raster);
      previous = old.revision;
    }
  }
  if (project.publication)
    project.publication = validatePublicationSettings(
      project.publication,
      project.images.map((image) => {
        const raster = imageRaster(image);
        return { id: image.id, width: raster.width, height: raster.height };
      }),
    );
  return project;
}
export async function exportRealProject(project: RealProject): Promise<Blob> {
  const checked = await validateProject(project);
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  const images = checked.images.map(({ bytes, ...metadata }) => {
    const path = `originals/${metadata.id}.${imageRaster({ ...metadata, bytes }).format === "PNG" ? "png" : "tif"}`;
    entries[path] = bytes;
    return { ...metadata, path };
  });
  entries["manifest.json"] = strToU8(JSON.stringify({ ...checked, images }));
  ensure(
    entries["manifest.json"].length <= MAX_MANIFEST_BYTES,
    "Project manifest exceeds 16 MiB / 项目记录超出 16 MiB",
  );
  const archive = zipSync(entries, { level: 0 });
  ensure(
    archive.length <= MAX_ARCHIVE_BYTES,
    "Project archive is too large / 项目包过大",
  );
  return new Blob([new Uint8Array(archive).buffer], {
    type: "application/zip",
  });
}
export async function importRealProject(file: Blob): Promise<RealProject> {
  ensure(
    file.size > 0 && file.size <= MAX_ARCHIVE_BYTES,
    "Project archive size is invalid / 项目包大小无效",
  );
  const seen = new Set<string>();
  let expanded = 0;
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      ensure(
        entry.name === "manifest.json" ||
          /^originals\/[A-Za-z0-9_-]+\.(?:png|tif)$/.test(entry.name),
        "Unsafe or unexpected archive path / 项目包包含不安全或未知路径",
      );
      ensure(!seen.has(entry.name), "Duplicate archive path / 项目包路径重复");
      seen.add(entry.name);
      ensure(
        seen.size <= MAX_IMAGES + 1,
        "Too many archive files / 项目包文件数量超限",
      );
      ensure(
        Number.isSafeInteger(entry.originalSize) &&
          entry.originalSize > 0 &&
          entry.originalSize <=
            (entry.name === "manifest.json"
              ? MAX_MANIFEST_BYTES
              : MAX_IMAGE_BYTES),
        "Expanded file size is invalid / 解压后文件大小无效",
      );
      expanded += entry.originalSize;
      ensure(
        expanded <= MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES,
        "Expanded archive is too large / 解压后项目包过大",
      );
      return true;
    },
  });
  ensure(entries["manifest.json"], "Missing project manifest / 缺少项目清单");
  const raw: unknown = JSON.parse(
    strFromU8(entries["manifest.json"]),
    (key, value: unknown) => {
      ensure(
        !["__proto__", "constructor", "prototype"].includes(key),
        "Unsafe project field / 项目包含不安全字段",
      );
      return value;
    },
  );
  const manifest = manifestSchema.parse(raw);
  ensure(
    Object.keys(entries).length === manifest.images.length + 1,
    "Unexpected or missing originals / 原始图像缺失或包含额外文件",
  );
  ensure(
    new Set(manifest.images.map((image) => image.path)).size ===
      manifest.images.length,
    "Duplicate original path / 原始图像路径重复",
  );
  const images = manifest.images.map(({ path, ...metadata }) => {
    ensure(
      path === `originals/${metadata.id}.png` ||
        path === `originals/${metadata.id}.tif`,
      "Original path does not match image ID / 原始图像路径与标识不一致",
    );
    ensure(entries[path], "Missing original image / 缺少原始图像");
    const image = { ...metadata, bytes: entries[path] };
    ensure(
      path.endsWith(".png")
        ? /\.png$/i.test(image.name)
        : /\.tiff?$/i.test(image.name),
      "Original file format mismatch / 原始文件格式不一致",
    );
    return image;
  });
  return validateProject({ ...manifest, images, exampleKind: undefined });
}

const STORAGE_KEY = "blot-workbench-real-project-v1";
let pendingSave: Promise<void> = Promise.resolve();
/** Snapshot immediately and serialize writes so a slower older save cannot win. */
export function saveRealProject(project: RealProject): Promise<void> {
  const snapshot = structuredClone(project);
  const operation = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await set(STORAGE_KEY, await validateProject(snapshot));
    });
  pendingSave = operation;
  return operation;
}
export async function loadRealProject(): Promise<RealProject | null> {
  await pendingSave.catch(() => undefined);
  const value: unknown = await get(STORAGE_KEY);
  return value === undefined ? null : validateProject(value);
}
