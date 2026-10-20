import { strToU8, zipSync } from "fflate";
import { APP_VERSION } from "../core/types";
import {
  effectiveNormalization,
  exportRealCsv,
  exportRealProject,
  exportRealStatisticsCsv,
  imageRaster,
  type RealImage,
  type RealProject,
} from "./model";
import { rasterPreview, type Rect } from "./pixels";
import {
  validatePublicationSettings,
  type PublicationRow,
  type PublicationSettings,
  type PublicationSourceKind,
} from "./publication-settings";
import { ROLLING_BALL_ALGORITHM } from "./rolling-ball";

export const PUBLICATION_CANVAS_WIDTH_PX = 1000;
export const PUBLICATION_IMAGE_WIDTH_PX = 660;
const IMAGE_X = 210;
const MARGIN = 24;
type Language = "zh" | "en";

export interface PublicationIssue {
  code: string;
  severity: "warning" | "error";
  messageZh: string;
  messageEn: string;
  rowId?: string;
}

const sourceLabels: Record<PublicationSourceKind, [string, string]> = {
  unspecified: ["未分类", "Unclassified"],
  ecl: ["化学发光（ECL）", "Chemiluminescence (ECL)"],
  overlay: ["叠加图", "Overlay"],
  "white-light": ["白光图", "White-light image"],
  ponceau: ["整膜染色 / 丽春红", "Whole-membrane stain / Ponceau"],
  "long-exposure": ["长曝光", "Long exposure"],
};
const choose = (language: Language, zh: string, en: string) =>
  language === "zh" ? zh : en;
const escape = (value: unknown): string =>
  String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const sourceKind = (settings: PublicationSettings, imageId: string) =>
  settings.sources.find((source) => source.imageId === imageId)?.kind ??
  "unspecified";
const sourceLabel = (kind: PublicationSourceKind, language: Language) =>
  sourceLabels[kind][language === "zh" ? 0 : 1];

function checked(project: RealProject, settings: PublicationSettings) {
  return validatePublicationSettings(
    settings,
    project.images.map((image) => {
      const raster = imageRaster(image);
      return { id: image.id, width: raster.width, height: raster.height };
    }),
  );
}

export function defaultPublication(project: RealProject): PublicationSettings {
  return {
    title: project.name.slice(0, 200),
    widthMm: 180,
    rows: [],
    sources: project.images.map((image) => ({
      imageId: image.id,
      kind: "unspecified",
    })),
  };
}

export function createPublicationRow(
  project: RealProject,
  imageId: string,
): PublicationRow {
  const image = project.images.find((candidate) => candidate.id === imageId);
  if (!image) throw new Error("Original image not found / 找不到原图");
  const raster = imageRaster(image);
  let crop: Rect = {
    x: 0,
    y: 0,
    width: raster.width,
    height: raster.height,
  };
  if (image.regions.length) {
    const bands = image.regions.map((region) => region.band);
    const pad = Math.max(
      3,
      Math.ceil(Math.max(...bands.map((b) => b.height)) * 0.3),
    );
    const x = Math.max(0, Math.floor(Math.min(...bands.map((b) => b.x))) - pad);
    const y = Math.max(0, Math.floor(Math.min(...bands.map((b) => b.y))) - pad);
    const right = Math.min(
      raster.width,
      Math.ceil(Math.max(...bands.map((b) => b.x + b.width))) + pad,
    );
    const bottom = Math.min(
      raster.height,
      Math.ceil(Math.max(...bands.map((b) => b.y + b.height))) + pad,
    );
    crop = { x, y, width: right - x, height: bottom - y };
  }
  const count =
    (project as RealProject & { publication?: PublicationSettings }).publication
      ?.rows.length ?? 0;
  return {
    id: crypto.randomUUID(),
    imageId,
    panel: String.fromCharCode(65 + Math.min(count, 25)),
    label: image.protein.slice(0, 100),
    molecularWeight: "",
    crop,
  };
}

function validCrop(crop: Rect, width: number, height: number): boolean {
  return (
    [crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= width &&
    crop.y + crop.height <= height
  );
}

/** DPI follows source pixels and the printed image width, never a TIFF tag. */
function effectiveDpi(settings: PublicationSettings, row: PublicationRow) {
  return (
    row.crop.width /
    ((settings.widthMm * PUBLICATION_IMAGE_WIDTH_PX) /
      PUBLICATION_CANVAS_WIDTH_PX /
      25.4)
  );
}

export function publicationPreflight(
  project: RealProject,
  settings: PublicationSettings,
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const add = (
    code: string,
    severity: PublicationIssue["severity"],
    messageZh: string,
    messageEn: string,
    rowId?: string,
  ) =>
    issues.push({
      code,
      severity,
      messageZh,
      messageEn,
      ...(rowId ? { rowId } : {}),
    });
  try {
    checked(project, settings);
  } catch {
    add(
      "INVALID_PUBLICATION",
      "error",
      "图版设置无效；请检查宽度、重复记录、原图引用和裁剪边界。",
      "Invalid publication settings. Check width, duplicate entries, original references, and crop bounds.",
    );
  }
  if (!settings.title.trim())
    add(
      "TITLE_EMPTY",
      "warning",
      "尚未填写图版标题。",
      "The figure title is empty.",
    );
  if (!settings.rows.length)
    add(
      "NO_FIGURE_ROWS",
      "warning",
      "尚未添加图版行；仍可导出包含全部原图的来源文档。",
      "No figure rows yet. The source-data document can still include all originals.",
    );
  for (const row of settings.rows) {
    const image = project.images.find(
      (candidate) => candidate.id === row.imageId,
    );
    if (!image) {
      add(
        "ORIGINAL_MISSING",
        "error",
        "图版行引用的原图不存在。",
        "The original referenced by this row is missing.",
        row.id,
      );
      continue;
    }
    const raster = imageRaster(image);
    if (!validCrop(row.crop, raster.width, raster.height)) {
      add(
        "CROP_OUT_OF_BOUNDS",
        "error",
        "裁剪范围必须位于原图内，宽高必须为正整数。",
        "The crop must lie inside the original with positive integer dimensions.",
        row.id,
      );
    } else {
      const dpi = effectiveDpi(settings, row);
      if (Number.isFinite(dpi) && dpi < 300)
        add(
          "LOW_EFFECTIVE_DPI",
          "warning",
          `当前排版的原图有效分辨率为 ${Math.round(dpi)} DPI，低于 300；放大导出不能增加原始细节。`,
          `The source contributes ${Math.round(dpi)} effective DPI at this layout size, below 300. Upscaling cannot add source detail.`,
          row.id,
        );
      if (
        image.regions.some(
          ({ band }) =>
            band.x < row.crop.x ||
            band.y < row.crop.y ||
            band.x + band.width > row.crop.x + row.crop.width ||
            band.y + band.height > row.crop.y + row.crop.height,
        )
      )
        add(
          "CROP_EXCLUDES_BAND",
          "warning",
          "此裁剪未完整保留所有测量条带，请确认图版选择并查看原图映射。",
          "This crop omits or clips measured bands. Review the selection and the original-image mapping.",
          row.id,
        );
    }
    if (!row.label.trim() || !row.panel.trim())
      add(
        "LABEL_EMPTY",
        "warning",
        "蛋白标签或面板编号为空。",
        "A protein label or panel identifier is empty.",
        row.id,
      );
    if (
      row.label.length > 35 ||
      row.molecularWeight.length > 16 ||
      row.panel.length > 3
    )
      add(
        "LABEL_LONG",
        "warning",
        "标注较长，导出时会换行；请检查可读性。",
        "Long annotations wrap in the export. Check readability.",
        row.id,
      );
    if (!image.reviewed)
      add(
        "IMAGE_UNREVIEWED",
        "warning",
        "该原图的分析尚未人工复核。",
        "The analysis of this original has not been reviewed.",
        row.id,
      );
    if (image.excluded)
      add(
        "IMAGE_EXCLUDED",
        "warning",
        "该原图已排除出定量，但仍被选入图版。",
        "This original is excluded from quantification but included in the figure.",
        row.id,
      );
  }
  for (const image of project.images) {
    if (!image.membrane.trim())
      add(
        "MEMBRANE_MISSING",
        "warning",
        `${image.name}：缺少膜编号。`,
        `${image.name}: membrane identifier is missing.`,
      );
    if (sourceKind(settings, image.id) === "unspecified")
      add(
        "SOURCE_UNCLASSIFIED",
        "warning",
        `${image.name}：尚未确认图像类型。`,
        `${image.name}: image type has not been classified.`,
      );
  }
  if (!project.designConfirmed)
    add(
      "DESIGN_UNCONFIRMED",
      "warning",
      "实验设计与泳道分配尚未确认。",
      "Experimental design and lane assignments are unconfirmed.",
    );
  add(
    "DRAFT_EXPORT",
    "warning",
    "导出常驻“草稿”表示投稿准备稿，不代表分析未复核；每张原图单独列出复核状态。请复核图像对应、标注、曝光及投稿要求。人工复核不证明成像线性。",
    "DRAFT denotes a submission preparation copy, not an unreviewed analysis; each original has its own review status. Review image correspondence, annotations, exposure, and submission requirements. Review does not establish imaging linearity.",
  );
  return issues;
}

const previewCache = new WeakMap<Uint8Array, string>();
function previewUrl(image: RealImage): string {
  const cached = previewCache.get(image.bytes);
  if (cached) return cached;
  const bytes = rasterPreview(imageRaster(image));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  const url = `data:image/png;base64,${btoa(binary)}`;
  previewCache.set(image.bytes, url);
  return url;
}

function method(project: RealProject, language: Language): string {
  const correction = project.backgroundCorrection;
  const normalization = effectiveNormalization(project);
  return [
    `blot-workbench ${APP_VERSION}`,
    correction?.kind === "rolling-ball"
      ? `rolling ball r=${correction.radius} (${ROLLING_BALL_ALGORITHM})`
      : choose(
          language,
          "局部均值背景（原始位深）",
          "local mean background (original bit depth)",
        ),
    choose(language, "归一化", "Normalization") +
      ": " +
      (normalization.kind === "reference-unit"
        ? `reference-unit ${normalization.unitId}`
        : "matched-control"),
  ].join(" · ");
}

/** Conservative glyph widths prevent user text from being cropped by the SVG. */
function wrap(value: string, width: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = "",
    used = 0;
  for (const character of value) {
    const next = /[^\u0000-\u00ff]/.test(character)
      ? fontSize
      : fontSize * 0.66;
    if (character === "\n") {
      lines.push(line);
      line = "";
      used = 0;
      continue;
    }
    if (used + next > width && line) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line += character;
    used += next;
  }
  lines.push(line);
  return lines;
}

function svgText(
  lines: string[],
  x: number,
  y: number,
  fontSize = 16,
  anchor = "start",
): string {
  return `<text x="${x}" y="${y}" font-size="${fontSize}" text-anchor="${anchor}" fill="#17212b">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index ? fontSize * 1.4 : 0}">${escape(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function imageDetails(
  project: RealProject,
  image: RealImage,
  settings: PublicationSettings,
) {
  const raster = imageRaster(image);
  const hasPairingIds = Boolean(
    image.replicate.trim() && image.membrane.trim(),
  );
  const pairedImages = hasPairingIds
    ? project.images.filter(
        (other) =>
          other.id !== image.id &&
          !other.excluded &&
          other.role !== image.role &&
          other.replicate.trim() === image.replicate.trim() &&
          other.membrane.trim() === image.membrane.trim(),
      )
    : [];
  return {
    id: image.id,
    name: image.name,
    sha256: image.hash,
    originalPath: `project.realwb.zip/originals/${image.id}.${raster.format === "PNG" ? "png" : "tif"}`,
    format: raster.format,
    bitDepth: raster.bitDepth,
    channels: raster.channels,
    width: raster.width,
    height: raster.height,
    protein: image.protein,
    role: image.role,
    replicate: image.replicate,
    membrane: image.membrane,
    exposure: image.exposure,
    sourceKind: sourceKind(settings, image.id),
    reviewed: image.reviewed,
    excluded: image.excluded,
    analysisRevision: image.revision,
    signalPolarity: image.signal,
    regions: image.regions,
    pairingStatus: !hasPairingIds
      ? "identifiers-missing"
      : pairedImages.length > 1
        ? "ambiguous-candidates"
        : pairedImages.length === 1
          ? "candidate-not-confirmation"
          : "no-candidate",
    pairingCandidates: pairedImages.map((paired) => ({
      id: paired.id,
      name: paired.name,
      sha256: paired.hash,
    })),
    publicationRows: settings.rows.filter((row) => row.imageId === image.id),
  };
}

function provenance(project: RealProject, settings: PublicationSettings) {
  return {
    format: "blot-workbench-publication-provenance",
    version: 1,
    appVersion: APP_VERSION,
    projectId: project.id,
    projectUpdatedAt: project.updatedAt,
    status: "DRAFT",
    publication: settings,
    imageAreaWidthFraction:
      PUBLICATION_IMAGE_WIDTH_PX / PUBLICATION_CANVAS_WIDTH_PX,
    backgroundCorrection: project.backgroundCorrection ?? { kind: "local" },
    backgroundAlgorithm:
      project.backgroundCorrection?.kind === "rolling-ball"
        ? ROLLING_BALL_ALGORITHM
        : "local-mean",
    normalization: effectiveNormalization(project),
    intensityModel:
      "Original-depth grayscale pixels; RGB arithmetic channel mean. " +
      (project.backgroundCorrection?.kind === "rolling-ball"
        ? "Rolling-ball net=sum(max-correctedPixel) for dark bands, or sum(correctedPixel) for light bands. correctedPixel is the ImageJ-compatible subtraction against the rolling-ball background surface, quantized and clamped to the original bit-depth range; dark correction uses an offset of max. Local background rectangles are not used."
        : "Local-background dark net=area*backgroundMean-bandSum; light polarity reverses the sign. backgroundMean is sampled from the local background rectangle.") +
      " Display previews are not used for measurement.",
    displayTransform:
      "8-bit grayscale preview; arithmetic channel mean; full-range linear mapping; no per-image contrast normalization",
    originals:
      "Original bytes are preserved in project.realwb.zip, under originals/; display previews are not original data.",
    images: project.images.map((image) =>
      imageDetails(project, image, settings),
    ),
    checks: publicationPreflight(project, settings),
  };
}

export function buildPublicationSvg(
  project: RealProject,
  settings: PublicationSettings,
  language: Language,
): string {
  checked(project, settings);
  if (!settings.rows.length)
    throw new Error("Add a figure row first / 请先添加图版行");
  const previews = new Map<string, string>();
  const title = wrap(
    `${choose(language, "草稿", "DRAFT")} — ${settings.title}`,
    952,
    24,
  );
  const fragments = [svgText(title, MARGIN, 36, 24)];
  let y = 54 + title.length * 34;
  for (const row of settings.rows) {
    const image = project.images.find(
      (candidate) => candidate.id === row.imageId,
    )!;
    const raster = imageRaster(image);
    if (!previews.has(image.id)) previews.set(image.id, previewUrl(image));
    const lanes = image.regions
      .filter(({ band }) => {
        const center = band.x + band.width / 2;
        return (
          center >= row.crop.x &&
          center <= row.crop.x + row.crop.width &&
          band.y + band.height > row.crop.y &&
          band.y < row.crop.y + row.crop.height
        );
      })
      .map((region) => ({
        lane: region.lane,
        x:
          IMAGE_X +
          ((region.band.x + region.band.width / 2 - row.crop.x) /
            row.crop.width) *
            PUBLICATION_IMAGE_WIDTH_PX,
        label: project.laneLabels[region.lane - 1] ?? `Lane ${region.lane}`,
      }))
      .sort((a, b) => a.x - b.x);
    const laneLabels = lanes.map((lane, index) => {
      const half = Math.min(
        index ? (lane.x - lanes[index - 1].x) / 2 : lane.x - IMAGE_X + 8,
        index < lanes.length - 1
          ? (lanes[index + 1].x - lane.x) / 2
          : IMAGE_X + PUBLICATION_IMAGE_WIDTH_PX - lane.x + 8,
      );
      return {
        ...lane,
        lines: wrap(lane.label, Math.max(13, half * 2 - 6), 13),
      };
    });
    const laneHeight =
      Math.max(1, ...laneLabels.map((lane) => lane.lines.length)) * 19 + 12;
    const labelLines = wrap(row.label, 130, 18);
    const panelLines = wrap(row.panel, 32, 20);
    const weightLines = wrap(
      row.molecularWeight ? `${row.molecularWeight} kDa` : "",
      88,
      15,
    );
    const imageY = y + laneHeight;
    const imageHeight =
      (PUBLICATION_IMAGE_WIDTH_PX * row.crop.height) / row.crop.width;
    const rowHeight = Math.max(
      imageHeight,
      labelLines.length * 26,
      panelLines.length * 28,
      weightLines.length * 22,
    );
    fragments.push(
      `<g data-row-id="${escape(row.id)}" data-image-id="${escape(image.id)}" data-crop="${escape(JSON.stringify(row.crop))}">`,
    );
    for (const lane of laneLabels)
      fragments.push(
        `<g data-lane="${lane.lane}">${svgText(lane.lines, lane.x, y + 15, 13, "middle")}</g>`,
      );
    fragments.push(svgText(panelLines, 24, imageY + 21, 20));
    fragments.push(svgText(labelLines, 64, imageY + 20, 18));
    fragments.push(svgText(weightLines, 886, imageY + 18, 15));
    fragments.push(
      `<svg x="${IMAGE_X}" y="${imageY}" width="${PUBLICATION_IMAGE_WIDTH_PX}" height="${imageHeight}" viewBox="${row.crop.x} ${row.crop.y} ${row.crop.width} ${row.crop.height}" overflow="hidden"><image href="${previews.get(image.id)}" x="0" y="0" width="${raster.width}" height="${raster.height}"/></svg>`,
    );
    const sourceLines = wrap(
      `${choose(language, "来源", "Source")}: ${image.name} · SHA-256 ${image.hash.slice(0, 12)} · crop(${row.crop.x},${row.crop.y},${row.crop.width},${row.crop.height}) · ${Math.round(effectiveDpi(settings, row))} DPI · ${choose(language, image.reviewed ? "分析已复核" : "分析未复核", image.reviewed ? "analysis reviewed" : "analysis unreviewed")}`,
      952,
      13,
    );
    fragments.push(svgText(sourceLines, MARGIN, imageY + rowHeight + 22, 13));
    fragments.push("</g>");
    y = imageY + rowHeight + 22 + sourceLines.length * 19 + 28;
  }
  const footnote = [
    ...wrap(method(project, language), 952, 13),
    ...wrap(
      choose(
        language,
        "每行均为单张原图的连续裁剪；泳道顺序不变。8 位显示预览不替代原始位深数据。原图及裁剪映射见 source-data.html 与项目包。",
        "Each row is one continuous original-image crop; lane order is unchanged. The 8-bit display preview does not replace original-depth data. See source-data.html and the project archive for originals and crop mappings.",
      ),
      952,
      13,
    ),
  ];
  fragments.push(svgText(footnote, MARGIN, y, 13));
  const height = y + footnote.length * 19 + MARGIN;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.widthMm}mm" height="${(height / PUBLICATION_CANVAS_WIDTH_PX) * settings.widthMm}mm" viewBox="0 0 ${PUBLICATION_CANVAS_WIDTH_PX} ${height}" role="img" font-family="Arial, sans-serif"><title>${escape(`${choose(language, "草稿", "DRAFT")} — ${settings.title}`)}</title><metadata>${escape(JSON.stringify(provenance(project, settings)))}</metadata><rect width="100%" height="100%" fill="white"/>${fragments.join("")}</svg>`;
}

export function buildSourceDataHtml(
  project: RealProject,
  settings: PublicationSettings,
  language: Language,
): string {
  checked(project, settings);
  const tr = (zh: string, en: string) => choose(language, zh, en);
  const usesLocalBackground =
    project.backgroundCorrection?.kind !== "rolling-ball";
  const annotationLegend = usesLocalBackground
    ? tr(
        "完整原图显示范围；绿框：测量条带，蓝虚线：局部背景，紫虚线：图版裁剪。标示为独立覆盖层，没有改写原图。",
        "Complete original-image extent. Green: measured bands; blue dashed: local backgrounds; magenta dashed: figure crops. Annotations are a separate overlay and do not alter original bytes.",
      )
    : tr(
        "完整原图显示范围；绿框：测量条带，紫虚线：图版裁剪。定量背景使用 rolling ball 背景面，不使用局部背景框；历史局部背景坐标仅在 ROI 记录中保留。标示为独立覆盖层，没有改写原图。",
        "Complete original-image extent. Green: measured bands; magenta dashed: figure crops. Quantification uses a rolling-ball background surface, not local background rectangles; stored local background coordinates remain only in the ROI records. Annotations are a separate overlay and do not alter original bytes.",
      );
  const groups = new Map<string, { heading: string; items: string[] }>();
  for (const [index, image] of project.images.entries()) {
    const key = JSON.stringify([image.replicate, image.membrane]);
    if (!groups.has(key))
      groups.set(key, {
        heading: `${tr("实验", "Experiment")}: ${image.replicate || "—"} / ${tr("膜", "Membrane")}: ${image.membrane || "—"}`,
        items: [],
      });
    const panels =
      settings.rows
        .filter((row) => row.imageId === image.id)
        .map((row) => row.panel || "—")
        .join(", ") || tr("未选入图版", "Not in figure");
    groups
      .get(key)!
      .items.push(
        `<li><a href="#source-${index + 1}">${escape(image.protein)} — ${escape(image.name)}</a> · ${escape(sourceLabel(sourceKind(settings, image.id), language))} · ${escape(tr("面板", "Panel"))}: ${escape(panels)}${image.excluded ? ` · ${escape(tr("已排除出定量", "Excluded from quantification"))}` : ""}</li>`,
      );
  }
  const directory = `<nav><h2>${escape(tr("按实验与膜查看全部原图", "All originals by experiment and membrane"))}</h2>${[...groups.values()].map((group) => `<h3>${escape(group.heading)}</h3><ul>${group.items.join("")}</ul>`).join("")}</nav>`;
  const sections = project.images.map((image, index) => {
    const raster = imageRaster(image);
    const detail = imageDetails(project, image, settings);
    const crops = settings.rows.filter((row) => row.imageId === image.id);
    const marks = [
      ...image.regions.flatMap((region) => [
        { rect: region.band, color: "#00866f", dash: "" },
        ...(usesLocalBackground
          ? [
              {
                rect: region.background,
                color: "#2774b9",
                dash: ' stroke-dasharray="5 3"',
              },
            ]
          : []),
      ]),
      ...crops.map((row) => ({
        rect: row.crop,
        color: "#bc417b",
        dash: ' stroke-dasharray="9 4"',
      })),
    ]
      .map(
        ({ rect, color, dash }) =>
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"${dash}/>`,
      )
      .join("");
    const pairs =
      detail.pairingCandidates
        .map((pair) => `${pair.name} (${pair.id})`)
        .join("; ") || tr("无", "None");
    const rows = [
      [tr("文件名", "Filename"), image.name],
      ["SHA-256", image.hash],
      [tr("原始文件位置", "Original file location"), detail.originalPath],
      [
        tr("原始像素", "Original pixels"),
        `${raster.width} × ${raster.height}; ${raster.bitDepth}-bit; ${raster.channels} channel(s); ${raster.format}`,
      ],
      [
        tr("图像类型 / 定量角色", "Image type / analysis role"),
        `${sourceLabel(detail.sourceKind, language)} / ${image.role}`,
      ],
      [
        tr(
          "蛋白 / 实验 / 膜 / 曝光",
          "Protein / experiment / membrane / exposure",
        ),
        [image.protein, image.replicate, image.membrane, image.exposure]
          .map((text) => text || "—")
          .join(" / "),
      ],
      [
        tr(
          "同实验同膜的异角色配对候选",
          "Opposite-role pairing candidates in the same experiment/membrane",
        ),
        `${detail.pairingStatus}: ${pairs}`,
      ],
      [
        tr("分析状态", "Analysis status"),
        `${tr(image.reviewed ? "已复核" : "未复核", image.reviewed ? "Reviewed" : "Unreviewed")}; ${tr(image.excluded ? "已排除出定量" : "未排除", image.excluded ? "Excluded from quantification" : "Not excluded")}; revision ${image.revision}`,
      ],
      [
        tr(
          "图版对应 / 原像素裁剪坐标",
          "Figure rows / crop coordinates in original pixels",
        ),
        crops.length
          ? crops
              .map(
                (row) =>
                  `${row.panel}: ${row.label}; row=${row.id}; ${JSON.stringify(row.crop)}`,
              )
              .join("\n")
          : tr(
              "未选入图版；保留完整原图",
              "Not selected for the figure; the complete original is retained",
            ),
      ],
      [
        tr("ROI（原像素）", "ROIs (original pixels)"),
        JSON.stringify(image.regions),
      ],
      [tr("备注", "Notes"), image.note],
    ];
    return `<section id="source-${index + 1}" class="source" data-image-id="${escape(image.id)}"><h2>${index + 1}. ${escape(image.name)}</h2><div class="full-image"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${raster.width} ${raster.height}" role="img"><title>${escape(image.name)}</title><image href="${previewUrl(image)}" x="0" y="0" width="${raster.width}" height="${raster.height}"/><g class="annotations">${marks}</g></svg></div><p class="legend">${escape(annotationLegend)}</p><table>${rows.map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join("")}</table></section>`;
  });
  const issues = publicationPreflight(project, settings);
  return `<!doctype html><html lang="${language === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(tr("草稿 · 原始数据文档", "DRAFT · Source data"))} — ${escape(settings.title)}</title><style>
body{max-width:1080px;margin:32px auto;padding:0 24px;font:15px/1.5 Arial,sans-serif;color:#17212b;background:white}h1{font-size:26px}h1,h2,p,li,td,th{overflow-wrap:anywhere}h2{font-size:20px}.notice{border-left:4px solid #bc417b;padding:12px;background:#fff5fa}.source{margin-top:36px;padding-top:16px;border-top:1px solid #aab5c0}.full-image{max-width:100%;text-align:center}.full-image svg{display:block;width:100%;height:auto;max-height:540px}.legend{font-size:12px;color:#485766}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #ccd4dc;padding:7px;text-align:left;vertical-align:top;white-space:pre-wrap;font-size:12px}th{width:27%}.issues{font-size:13px}@media print{@page{size:A4;margin:14mm}body{margin:0;padding:0;max-width:none;font-size:10pt}.source{break-before:page;margin:0;border:0;padding:0}h2{break-after:avoid}.full-image{break-inside:avoid}.full-image svg{max-height:115mm}tr{break-inside:avoid}th,td{font-size:8pt}.notice{background:white}} </style></head><body><h1>${escape(tr("草稿 · 原始数据文档", "DRAFT · Source data"))} — ${escape(settings.title)}</h1><p class="notice">${escape(tr("本文件包含全部导入图像（含排除项与未选入图版项）的完整 8 位灰度显示预览。预览按原位深全量程线性映射，彩色通道取算术均值，不替代原始文件或原位深定量数据。原始文件字节保存在同一导出包 project.realwb.zip 的 originals/ 目录。请人工复核图像对应、标注和期刊要求；复核不证明成像线性。", "This document contains complete 8-bit grayscale display previews of every imported image, including excluded images and those absent from the figure. Previews use full-range linear mapping from original bit depth and the arithmetic mean of color channels; they do not replace original files or original-depth quantitative data. Original bytes are in the companion project.realwb.zip under originals/. Review image correspondence, annotations, and journal requirements; review does not establish imaging linearity."))}</p><p>${escape(method(project, language))}</p><p>${escape(tr("配对依据为非空的实验与膜编号，候选列表不表示已确认正确配对；多候选明确标记为歧义。图像类型由用户确认；不自动推断分子量或仪器配准关系。", "Pairing candidates require nonempty experiment and membrane identifiers and do not establish a confirmed correct pairing; multiple candidates are marked ambiguous. Image types are user-confirmed; molecular weight and instrument registration are not inferred."))}</p><ul class="issues">${issues.map((issue) => `<li data-code="${escape(issue.code)}">${escape(language === "zh" ? issue.messageZh : issue.messageEn)}</li>`).join("")}</ul>${directory}${sections.join("")}</body></html>`;
}

export async function exportPublicationBundle(
  project: RealProject,
  settings: PublicationSettings,
  language: Language,
): Promise<Blob> {
  checked(project, settings);
  const projectWithPublication = { ...project, publication: settings };
  const originalArchive = await exportRealProject(projectWithPublication);
  const entries: Record<string, Uint8Array> = {
    "source-data.html": strToU8(
      buildSourceDataHtml(project, settings, language),
    ),
    "provenance.json": strToU8(
      JSON.stringify(provenance(project, settings), null, 2),
    ),
    "results.csv": strToU8("\ufeff" + exportRealCsv(project)),
    "statistics.csv": strToU8("\ufeff" + exportRealStatisticsCsv(project)),
    "project.realwb.zip": new Uint8Array(await originalArchive.arrayBuffer()),
  };
  if (settings.rows.length)
    entries["figure.svg"] = strToU8(
      buildPublicationSvg(project, settings, language),
    );
  return new Blob([new Uint8Array(zipSync(entries, { level: 0 })).buffer], {
    type: "application/zip",
  });
}
