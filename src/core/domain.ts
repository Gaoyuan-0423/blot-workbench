import type {
  Analysis,
  Measurement,
  Project,
  Rect,
  Sample,
  Template,
} from "./types";
import {
  analysisMatchesFixture,
  canonicalReference,
  clone,
  DEFAULT_TEMPLATE,
  demoRois,
  fixtureSignature,
  getFixtures,
  presetMeasurements,
} from "./fixtures";

const touch = (project: Project) => {
  project.updatedAt = new Date().toISOString();
  return project;
};
function findAnalysis(project: Project, imageId: string): Analysis {
  const analysis = project.analyses.find((item) => item.imageId === imageId);
  if (!analysis) throw new Error("Analysis not found / 找不到图像分析");
  return analysis;
}
function checkpoint(project: Project, analysis: Analysis): void {
  project.history.push(clone(analysis));
  analysis.revision += 1;
}
function invalidateDependents(
  project: Project,
  referenceImageId: string,
): void {
  for (const analysis of project.analyses)
    if (
      analysis.referenceImageId === referenceImageId &&
      analysis.status !== "stale"
    ) {
      checkpoint(project, analysis);
      analysis.status = "stale";
    }
}
export function getMeasurements(
  project: Project,
  imageId: string,
): Measurement[] {
  const analysis = project.analyses.find((item) => item.imageId === imageId);
  const image = project.images.find((item) => item.id === imageId);
  if (
    !analysis ||
    !image ||
    image.qc === "saturated" ||
    analysis.status === "stale" ||
    analysis.excluded ||
    !analysisMatchesFixture(project, analysis)
  )
    return [];
  if (analysis.referenceImageId) {
    const reference = project.analyses.find(
      (item) => item.imageId === analysis.referenceImageId,
    );
    const referenceImage = project.images.find(
      (item) => item.id === analysis.referenceImageId,
    );
    if (
      !reference ||
      referenceImage?.qc === "saturated" ||
      reference.status === "stale" ||
      reference.excluded ||
      !analysisMatchesFixture(project, reference)
    )
      return [];
  }
  return presetMeasurements(project, image);
}
export function clampRect(rect: Rect, width: number, height: number): Rect {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
    throw new Error("ROI coordinates must be finite / 区域坐标必须为有限值");
  const w = Math.max(1, Math.min(width, Math.round(rect.width)));
  const h = Math.max(1, Math.min(height, Math.round(rect.height)));
  return {
    x: Math.max(0, Math.min(width - w, Math.round(rect.x))),
    y: Math.max(0, Math.min(height - h, Math.round(rect.y))),
    width: w,
    height: h,
  };
}
export function updateRoi(
  project: Project,
  imageId: string,
  roiId: string,
  rect: Rect,
): Project {
  const next = clone(project),
    analysis = findAnalysis(next, imageId);
  const image = next.images.find((item) => item.id === imageId)!;
  const roi = analysis.rois.find((item) => item.id === roiId);
  if (!roi) throw new Error("ROI not found / 找不到区域");
  const bounded = clampRect(rect, image.width, image.height);
  if (JSON.stringify(roi.rect) === JSON.stringify(bounded)) return project;
  checkpoint(next, analysis);
  roi.rect = bounded;
  analysis.status = "stale";
  invalidateDependents(next, imageId);
  return touch(next);
}
type AnalysisPatch = Partial<
  Pick<Analysis, "referenceImageId" | "note" | "excluded" | "status">
>;
export function updateAnalysis(
  project: Project,
  imageId: string,
  patch: AnalysisPatch,
): Project {
  const next = clone(project),
    analysis = findAnalysis(next, imageId);
  const image = next.images.find((item) => item.id === imageId)!;
  if (
    patch.note !== undefined &&
    (typeof patch.note !== "string" || patch.note.length > 10000)
  )
    throw new Error("Invalid note / 备注无效");
  if (
    patch.status !== undefined &&
    !["unreviewed", "confirmed", "stale"].includes(patch.status)
  )
    throw new Error("Invalid status / 状态无效");
  if (patch.excluded !== undefined && typeof patch.excluded !== "boolean")
    throw new Error("Invalid exclusion / 排除标记无效");
  if (patch.referenceImageId !== undefined) {
    const reference = next.images.find(
      (item) => item.id === patch.referenceImageId,
    );
    if (image.role === "reference" && patch.referenceImageId !== null)
      throw new Error(
        "Reference images cannot reference another image / 内参图不能配对另一内参",
      );
    if (
      patch.referenceImageId !== null &&
      (!reference ||
        reference.role !== "reference" ||
        reference.membraneId !== image.membraneId ||
        reference.batchId !== image.batchId)
    )
      throw new Error(
        "Reference must be from the same membrane and batch / 内参须来自同一膜和批次",
      );
  }
  const pairingChanged =
    patch.referenceImageId !== undefined &&
    patch.referenceImageId !== analysis.referenceImageId;
  const exclusionChanged =
    patch.excluded !== undefined && patch.excluded !== analysis.excluded;
  if (
    patch.status === "confirmed" &&
    (analysis.status === "stale" ||
      pairingChanged ||
      !getMeasurements(project, imageId).length ||
      patch.excluded === true)
  )
    throw new Error(
      "Stale or invalid analysis cannot be confirmed / 失效或无效分析不能确认",
    );
  const changed = Object.entries(patch).some(
    ([key, value]) =>
      value !== undefined &&
      !(key === "status" && analysis.status === "stale") &&
      analysis[key as keyof Analysis] !== value,
  );
  if (!changed) return project;
  checkpoint(next, analysis);
  if (patch.referenceImageId !== undefined)
    analysis.referenceImageId = patch.referenceImageId;
  if (patch.note !== undefined) analysis.note = patch.note;
  if (patch.excluded !== undefined) analysis.excluded = patch.excluded;
  if (patch.status !== undefined && analysis.status !== "stale")
    analysis.status = patch.status;
  if (pairingChanged) analysis.status = "stale";
  else if (exclusionChanged && analysis.status !== "stale")
    analysis.status = "unreviewed";
  if (pairingChanged || exclusionChanged || patch.status === "stale")
    invalidateDependents(next, imageId);
  return touch(next);
}
export function editTemplate(
  project: Project,
  patch: Pick<Template, "bandWidth" | "bandHeight" | "backgroundGap">,
): Project {
  if (
    ![patch.bandWidth, patch.bandHeight, patch.backgroundGap].every(
      Number.isFinite,
    ) ||
    patch.bandWidth < 1 ||
    patch.bandWidth > 104 ||
    patch.bandHeight < 1 ||
    patch.bandHeight > 72 ||
    patch.backgroundGap < 0 ||
    patch.backgroundGap > 28
  )
    throw new Error(
      "Template dimensions outside demo limits / 模板尺寸超出示例范围",
    );
  const next = clone(project);
  const rounded = {
    bandWidth: Math.round(patch.bandWidth),
    bandHeight: Math.round(patch.bandHeight),
    backgroundGap: Math.round(patch.backgroundGap),
  };
  if (
    rounded.bandWidth === next.template.bandWidth &&
    rounded.bandHeight === next.template.bandHeight &&
    rounded.backgroundGap === next.template.backgroundGap
  )
    return project;
  next.template = {
    ...next.template,
    ...rounded,
    version: next.template.version + 1,
  };
  return touch(next);
}
export function applyTemplate(project: Project, imageIds: string[]): Project {
  const next = clone(project);
  let changed = false;
  for (const id of new Set(imageIds)) {
    const analysis = findAnalysis(next, id),
      image = next.images.find((item) => item.id === id)!;
    const rois = demoRois(next.template).map((roi) => ({
      ...roi,
      rect: clampRect(roi.rect, image.width, image.height),
    }));
    if (
      JSON.stringify(analysis.templateSnapshot) ===
        JSON.stringify(next.template) &&
      JSON.stringify(analysis.rois) === JSON.stringify(rois)
    )
      continue;
    checkpoint(next, analysis);
    analysis.templateSnapshot = clone(next.template);
    analysis.rois = rois;
    changed = true;
    analysis.status = "stale";
    invalidateDependents(next, id);
  }
  return changed ? touch(next) : project;
}
export function restoreExampleAnalysis(
  project: Project,
  imageId: string,
): Project {
  const next = clone(project),
    analysis = findAnalysis(next, imageId);
  const image = next.images.find((item) => item.id === imageId)!;
  if (
    !getFixtures().some(
      (fixture) =>
        fixture.image.id === imageId && fixture.image.dataUrl === image.dataUrl,
    )
  )
    throw new Error("No matching demo fixture / 无匹配示例");
  const geometryChanged =
    JSON.stringify(analysis.rois) !== JSON.stringify(demoRois()) ||
    JSON.stringify(analysis.templateSnapshot) !==
      JSON.stringify(DEFAULT_TEMPLATE) ||
    analysis.referenceImageId !== canonicalReference(image) ||
    analysis.fixtureSignature !== fixtureSignature(imageId) ||
    analysis.excluded !== (image.qc === "saturated");
  if (!geometryChanged && analysis.status === "unreviewed") return project;
  checkpoint(next, analysis);
  analysis.rois = demoRois();
  analysis.templateSnapshot = clone(DEFAULT_TEMPLATE);
  analysis.referenceImageId = canonicalReference(image);
  analysis.fixtureSignature = fixtureSignature(imageId);
  analysis.status = "unreviewed";
  analysis.excluded = image.qc === "saturated";
  if (geometryChanged) invalidateDependents(next, imageId);
  return touch(next);
}
export function updateSample(
  project: Project,
  sampleId: string,
  patch: Partial<
    Pick<
      Sample,
      "label" | "group" | "experimentalUnitId" | "technicalReplicateSetId"
    >
  >,
): Project {
  const next = clone(project),
    sample = next.samples.find((item) => item.id === sampleId);
  if (!sample) throw new Error("Sample not found / 找不到样本");
  for (const value of Object.values(patch))
    if (typeof value !== "string" || !value.trim() || value.length > 200)
      throw new Error("Invalid sample field / 样本字段无效");
  const designChanged = (
    ["group", "experimentalUnitId", "technicalReplicateSetId"] as const
  ).some((key) => patch[key] !== undefined && patch[key] !== sample[key]);
  if (
    !designChanged &&
    (patch.label === undefined || patch.label === sample.label)
  )
    return project;
  for (const key of [
    "label",
    "group",
    "experimentalUnitId",
    "technicalReplicateSetId",
  ] as const)
    if (patch[key] !== undefined) sample[key] = patch[key]!;
  if (designChanged)
    for (const analysis of next.analyses)
      if (
        analysis.status !== "stale" &&
        analysis.rois.some((roi) =>
          next.lanes.some(
            (lane) => lane.id === roi.laneId && lane.sampleId === sampleId,
          ),
        )
      ) {
        checkpoint(next, analysis);
        analysis.status = "stale";
      }
  return touch(next);
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe =
    /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportCsv(project: Project): string {
  const header = [
    "DEMO_ONLY_NOT_RESEARCH",
    "project_id",
    "app_version",
    "schema_version",
    "image_id",
    "batch_id",
    "date",
    "membrane_id",
    "exposure_ms",
    "analysis_revision",
    "template_version",
    "reference_image_id",
    "reference_revision",
    "sample_id",
    "sample_label",
    "group",
    "experimental_unit_id",
    "technical_replicate_set_id",
    "band_sum",
    "area_px",
    "background_mean",
    "net",
    "reference_net",
    "ratio",
    "relative_to_demo_controls",
  ];
  const rows: (string | number)[][] = [header];
  for (const image of project.images.filter((item) => item.role === "target")) {
    const analysis = findAnalysis(project, image.id),
      reference = project.analyses.find(
        (item) => item.imageId === analysis.referenceImageId,
      );
    if (analysis.status !== "confirmed" || reference?.status !== "confirmed")
      continue;
    for (const measurement of getMeasurements(project, image.id)) {
      const sample = project.samples.find(
        (item) => item.id === measurement.sampleId,
      )!;
      rows.push([
        "TRUE_SYNTHETIC_PRESET",
        project.id,
        project.appVersion,
        project.schemaVersion,
        image.id,
        image.batchId,
        project.batches.find((batch) => batch.id === image.batchId)!.date,
        image.membraneId,
        image.exposureMs,
        analysis.revision,
        analysis.templateSnapshot.version,
        reference.imageId,
        reference.revision,
        sample.id,
        sample.label,
        sample.group,
        sample.experimentalUnitId,
        sample.technicalReplicateSetId,
        measurement.bandSum,
        measurement.area,
        measurement.backgroundMean,
        measurement.net,
        measurement.referenceNet,
        measurement.ratio,
        measurement.relative,
      ]);
    }
  }
  if (rows.length === 1)
    throw new Error(
      "No confirmed valid target/reference pairs to export / 没有目标与内参均确认且有效的结果可导出",
    );
  return (
    "\ufeff" +
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
