import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "../schema-validator";
import { get, set } from "idb-keyval";
import type { Project } from "./types";
import { clone, fixtureHash, getFixtures, sha256, toBase64 } from "./fixtures";
import { getMeasurements } from "./domain";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
  );
const text = z.string().max(200);
const positive = z.number().int().min(1).max(1000000);
const rectSchema = z
  .object({
    x: z.number().int().min(0).max(720),
    y: z.number().int().min(0).max(280),
    width: positive.max(720),
    height: positive.max(280),
  })
  .strict();
const roiSchema = z
  .object({
    id,
    laneId: id,
    kind: z.enum(["band", "background"]),
    rect: rectSchema,
  })
  .strict();
const sampleSchema = z
  .object({
    id,
    label: text.min(1),
    group: text.min(1),
    experimentalUnitId: text.min(1),
    technicalReplicateSetId: text.min(1),
  })
  .strict();
const templateSchema = z
  .object({
    id,
    name: text,
    version: positive,
    bandWidth: positive.max(104),
    bandHeight: positive.max(72),
    backgroundGap: z.number().int().min(0).max(28),
  })
  .strict();
const analysisSchema = z
  .object({
    imageId: id,
    revision: positive,
    status: z.enum(["unreviewed", "confirmed", "stale"]),
    rois: z.array(roiSchema).max(12),
    templateSnapshot: templateSchema,
    referenceImageId: id.nullable(),
    excluded: z.boolean(),
    note: z.string().max(10000),
    fixtureSignature: z.string().max(10000),
  })
  .strict();
const imageMetadataSchema = z
  .object({
    id,
    name: text,
    batchId: id,
    membraneId: id,
    protein: text,
    role: z.enum(["target", "reference"]),
    exposureMs: positive,
    width: z.literal(720),
    height: z.literal(280),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.literal("synthetic"),
    qc: z.enum(["normal", "weak", "background", "saturated"]),
  })
  .strict();
const projectBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    appVersion: z.string().min(1).max(100),
    id,
    name: text.min(1),
    description: z.string().max(10000),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    demo: z.literal(true),
    batches: z
      .array(
        z
          .object({
            id,
            label: text,
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .strict(),
      )
      .max(8),
    samples: z.array(sampleSchema).max(6),
    lanes: z
      .array(z.object({ id, number: positive.max(6), sampleId: id }).strict())
      .max(6),
    template: templateSchema,
    analyses: z.array(analysisSchema).max(8),
    history: z.array(analysisSchema).max(1000),
    ui: z
      .object({
        view: z.enum(["overview", "analysis", "samples", "results"]),
        selectedImageId: z.string().max(100),
        batchFilter: z.string().max(100),
        language: z.enum(["zh", "en"]),
      })
      .strict(),
  })
  .strict();
const projectSchema = projectBaseSchema
  .extend({
    images: z
      .array(
        imageMetadataSchema
          .extend({
            dataUrl: z
              .string()
              .max(2000000)
              .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
const manifestSchema = z
  .object({
    format: z.literal("blot-workbench-demo"),
    archiveVersion: z.literal(1),
    project: projectBaseSchema
      .extend({
        images: z
          .array(
            imageMetadataSchema
              .extend({
                path: z
                  .string()
                  .regex(/^images\/[a-zA-Z0-9_-]+\.png$/)
                  .max(120),
              })
              .strict(),
          )
          .max(8),
      })
      .strict(),
  })
  .strict();

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function unique(values: string[], label: string): void {
  ensure(
    new Set(values).size === values.length,
    `Duplicate ${label} / 重复标识`,
  );
}
function validateReferences(project: Project): void {
  for (const [list, label] of [
    [project.images, "image"],
    [project.samples, "sample"],
    [project.lanes, "lane"],
    [project.batches, "batch"],
  ] as const)
    unique(
      list.map((entry) => entry.id),
      label,
    );
  unique(
    project.analyses.map((analysis) => analysis.imageId),
    "analysis",
  );
  unique(
    project.lanes.map((lane) => String(lane.number)),
    "lane number",
  );
  ensure(
    project.analyses.length === project.images.length,
    "Every image requires one current analysis / 每张图必须有一个当前分析",
  );
  for (const lane of project.lanes)
    ensure(
      project.samples.some((sample) => sample.id === lane.sampleId),
      "Unknown sample reference / 样本引用无效",
    );
  for (const image of project.images)
    ensure(
      project.batches.some((batch) => batch.id === image.batchId),
      "Unknown batch reference / 批次引用无效",
    );
  for (const batch of project.batches)
    ensure(
      new Date(`${batch.date}T00:00:00Z`).toISOString().slice(0, 10) ===
        batch.date,
      "Invalid date / 日期无效",
    );
  ensure(
    project.ui.selectedImageId === "" ||
      project.images.some((image) => image.id === project.ui.selectedImageId),
    "Unknown selected image / 所选图像无效",
  );
  ensure(
    project.ui.batchFilter === "all" ||
      project.ui.batchFilter === "" ||
      project.batches.some((batch) => batch.id === project.ui.batchFilter),
    "Unknown batch filter / 批次筛选无效",
  );
  const revisions = new Set<string>();
  for (const analysis of [...project.analyses, ...project.history]) {
    const image = project.images.find((item) => item.id === analysis.imageId);
    ensure(image, "Unknown analysis image / 分析引用的图像不存在");
    const revisionKey = `${analysis.imageId}:${analysis.revision}`;
    ensure(
      !revisions.has(revisionKey),
      "Duplicate analysis revision / 分析版本重复",
    );
    revisions.add(revisionKey);
    unique(
      analysis.rois.map((roi) => roi.id),
      "ROI",
    );
    ensure(
      analysis.rois.length === project.lanes.length * 2,
      "Each lane needs band and background regions / 每个泳道须有条带和背景区域",
    );
    for (const lane of project.lanes)
      for (const kind of ["band", "background"])
        ensure(
          analysis.rois.filter(
            (roi) => roi.laneId === lane.id && roi.kind === kind,
          ).length === 1,
          "Invalid lane region mapping / 泳道区域配对无效",
        );
    for (const roi of analysis.rois) {
      ensure(
        project.lanes.some((lane) => lane.id === roi.laneId),
        "Unknown lane reference / 泳道引用无效",
      );
      ensure(
        roi.rect.x + roi.rect.width <= image.width &&
          roi.rect.y + roi.rect.height <= image.height,
        "ROI exceeds image bounds / 区域超出图像",
      );
    }
    if (analysis.referenceImageId) {
      const reference = project.images.find(
        (item) => item.id === analysis.referenceImageId,
      );
      ensure(
        image.role === "target" &&
          reference?.role === "reference" &&
          reference.membraneId === image.membraneId &&
          reference.batchId === image.batchId,
        "Invalid target/reference pairing / 目标与内参配对无效",
      );
    }
  }
  for (const old of project.history)
    ensure(
      old.revision <
        project.analyses.find((analysis) => analysis.imageId === old.imageId)!
          .revision,
      "History revision is not older / 历史版本须早于当前版本",
    );
}

/** Alpha archives deliberately accept only our original synthetic PNG assets. */
export async function validateProject(value: unknown): Promise<Project> {
  const project = projectSchema.parse(value) as Project;
  validateReferences(project);
  await Promise.all(
    project.images.map(async (image) => {
      const fixture = getFixtures().find(
        (entry) => entry.image.id === image.id,
      );
      ensure(
        fixture && image.dataUrl === fixture.image.dataUrl,
        "Unsupported image: alpha accepts its synthetic fixtures only / Alpha 仅接受本示例的合成图像",
      );
      for (const key of [
        "batchId",
        "membraneId",
        "protein",
        "role",
        "exposureMs",
        "width",
        "height",
        "source",
        "qc",
      ] as const)
        ensure(
          image[key] === fixture.image[key],
          "Original image metadata mismatch / 原始图像元数据不匹配",
        );
      ensure(
        (await fixtureHash(fixture)) === image.hash,
        "Image checksum mismatch / 图像校验和不匹配",
      );
    }),
  );
  for (const analysis of project.analyses.filter(
    (item) => item.status === "confirmed",
  )) {
    ensure(
      getMeasurements(project, analysis.imageId).length > 0,
      "Confirmed analysis has invalid image, parameters or reference / 已确认分析的图像、参数或内参无效",
    );
  }
  return project;
}

const MAX_ARCHIVE_SIZE = 12 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 16 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 8 * 1024 * 1024;
export async function exportProject(project: Project): Promise<Blob> {
  const validated = await validateProject(project);
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  const images = validated.images.map(({ dataUrl: _dataUrl, ...metadata }) => {
    const path = `images/${metadata.id}.png`;
    entries[path] = getFixtures().find(
      (fixture) => fixture.image.id === metadata.id,
    )!.png;
    return { ...metadata, path };
  });
  entries["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: "blot-workbench-demo",
        archiveVersion: 1,
        project: { ...validated, images },
      },
      null,
      2,
    ),
  );
  ensure(
    entries["manifest.json"].length <= MAX_MANIFEST_SIZE,
    "Project history exceeds alpha archive limit / 项目历史超出 Alpha 导出大小限制",
  );
  const bytes = zipSync(entries, { level: 6 });
  ensure(bytes.length <= MAX_ARCHIVE_SIZE, "Archive too large / 项目包过大");
  return new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" });
}
export async function importProject(file: Blob): Promise<Project> {
  ensure(
    file.size > 0 && file.size <= MAX_ARCHIVE_SIZE,
    "Archive size outside allowed range / 项目包大小超出允许范围",
  );
  const compressed = new Uint8Array(await file.arrayBuffer());
  const seen = new Set<string>();
  let expandedSize = 0;
  const entries = unzipSync(compressed, {
    filter: (entry) => {
      ensure(
        entry.name === "manifest.json" ||
          /^images\/[a-zA-Z0-9_-]+\.png$/.test(entry.name),
        "Unsafe or unexpected archive path / 项目包含不安全或未知路径",
      );
      ensure(
        !seen.has(entry.name),
        "Duplicate archive path / 项目包文件路径重复",
      );
      seen.add(entry.name);
      ensure(seen.size <= 9, "Too many archive entries / 项目包文件过多");
      ensure(
        Number.isSafeInteger(entry.originalSize) &&
          entry.originalSize >= 0 &&
          entry.originalSize <=
            (entry.name === "manifest.json" ? MAX_MANIFEST_SIZE : 2000000),
        "Expanded file too large / 解压后文件过大",
      );
      expandedSize += entry.originalSize;
      ensure(
        expandedSize <= MAX_EXPANDED_SIZE,
        "Expanded archive too large / 项目包解压后过大",
      );
      return true;
    },
  });
  ensure(entries["manifest.json"], "Missing manifest / 缺少项目清单");
  const raw: unknown = JSON.parse(
    strFromU8(entries["manifest.json"]),
    (key, value: unknown) => {
      ensure(
        !["__proto__", "constructor", "prototype"].includes(key),
        "Unsafe JSON key / 项目包含不安全字段",
      );
      return value;
    },
  );
  const manifest = manifestSchema.parse(raw);
  ensure(
    Object.keys(entries).length === manifest.project.images.length + 1,
    "Unexpected or missing archive assets / 图像文件缺失或多余",
  );
  unique(
    manifest.project.images.map((image) => image.path),
    "asset path",
  );
  const images = await Promise.all(
    manifest.project.images.map(async ({ path, ...metadata }) => {
      ensure(
        path === `images/${metadata.id}.png`,
        "Asset path mismatch / 图像路径与标识不匹配",
      );
      const bytes = entries[path];
      ensure(bytes, "Missing image / 图像文件缺失");
      ensure(
        (await sha256(bytes)) === metadata.hash,
        "Image checksum mismatch / 图像校验和不匹配",
      );
      ensure(
        bytes.length >= 33 &&
          bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71,
        "Invalid PNG / PNG 无效",
      );
      const header = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      ensure(
        header.getUint32(16) === metadata.width &&
          header.getUint32(20) === metadata.height,
        "PNG dimensions do not match / PNG 尺寸不匹配",
      );
      return {
        ...metadata,
        dataUrl: `data:image/png;base64,${toBase64(bytes)}`,
      };
    }),
  );
  return validateProject({ ...manifest.project, images });
}

const STORAGE_KEY = "blot-workbench-current-project-v1";
let pendingSave: Promise<void> = Promise.resolve();
export function saveProject(project: Project): Promise<void> {
  const snapshot = clone(project);
  const operation = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await set(STORAGE_KEY, await validateProject(snapshot));
    });
  pendingSave = operation;
  return operation;
}
export async function loadProject(): Promise<Project | null> {
  await pendingSave.catch(() => undefined);
  const value: unknown = await get(STORAGE_KEY);
  return value === undefined ? null : validateProject(value);
}
