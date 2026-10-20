import { useLanguage, languageUrl, translateMessage } from "../i18n";
import SuiteNav from "../SuiteNav";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FileArchive,
  FlaskConical,
  FolderOpen,
  Layers,
  LoaderCircle,
  Plus,
  Save,
  ScanLine,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import {
  analyzeAll,
  applyLaneDescription,
  applyPairedDesign,
  applyNormalization,
  createRealProject,
  descriptiveStatistics,
  effectiveNormalization,
  exportRealCsv,
  exportRealProject,
  exportRealStatisticsCsv,
  imageRaster,
  importRealImages,
  importRealProject,
  isControlLane,
  isExcludedLane,
  loadRealProject,
  normalizationUnitIds,
  results,
  realPairedTests,
  saveRealProject,
  updateRealImage,
  updateRealProject,
  updateRealPublication,
  type PairedLanePair,
  type RealImage,
  type RealImagePatch,
  type RealProject,
  type RealResult,
  type RealStatistics,
} from "./model";
import {
  measureRegion,
  proposeRegions,
  rasterPreview,
  type LaneRegion,
  type Rect,
} from "./pixels";
import { renderFigure } from "./figure-export";
import { buildComposedFigureSvg } from "./figure-compose";
import PublicationPanel from "./PublicationPanel";
import { ROLLING_BALL_ALGORITHM } from "./rolling-ball";
import { buildAnalysisReport, type AnalysisReport } from "./analysis-report";
import { APP_VERSION } from "../core/types";
import { analyzeBandsByok, KNOWN_PROVIDERS } from "../vision/byok";
import {
  clearByokConfig,
  loadByokConfig,
  saveByokConfig,
} from "../vision/byok-store";
import {
  applyVisionCandidates,
  VisionCandidateCache,
  visionCacheKey,
} from "./vision-candidates";
import "./real-workbench.css";

type Language = "zh" | "en";
type RegionKind = "band" | "background";
type Translate = (zh: string, en: string) => string;
type Dialog =
  | { kind: "new" }
  | { kind: "import"; project: RealProject }
  | { kind: "regions"; imageId: string }
  | null;
type Drag = {
  pointerId: number;
  imageId: string;
  lane: number;
  kind: RegionKind;
  resize: boolean;
  start: { x: number; y: number };
  original: Rect;
  current: Rect;
};

const warningLabels: Record<string, [string, string]> = {
  VISION_CANDIDATES_REQUIRE_REVIEW: [
    "视觉候选必须逐条检查取样位置，再确认复核。",
    "Review every vision-proposed band region before confirming it.",
  ],
  ROLLING_BALL_SATURATED: [
    "像素接近饱和，滚动球扣背景不能恢复原始信号；请检查曝光。",
    "Near-saturated pixels cannot be recovered by rolling-ball correction; check the exposure.",
  ],
  METADATA_SUBDIRECTORIES_IGNORED: [
    "未读取 EXIF / GPS 子目录；原始文件保留不变。",
    "EXIF / GPS subdirectories were not read; the original file is unchanged.",
  ],
  RGB_MEAN_INTENSITY: [
    "彩色图像按通道均值计算，需核对采集与导出方式。",
    "Color channels are averaged; review the acquisition and export method.",
  ],
  OPAQUE_ALPHA_IGNORED: [
    "忽略全不透明的 Alpha 通道。",
    "The fully opaque alpha channel is ignored.",
  ],
  WHITE_IS_ZERO_INVERTED: [
    "已按 TIFF 的白为零定义转换像素方向。",
    "Pixel orientation follows the TIFF WhiteIsZero definition.",
  ],
  ENCODED_INTENSITY_NO_COLOR_CORRECTION: [
    "使用文件编码的像素强度；未验证成像响应的线性。",
    "Uses file-encoded intensities; acquisition linearity is unverified.",
  ],
  CANDIDATES_REQUIRE_REVIEW: [
    "自动候选必须检查条带与背景位置。",
    "Check the band and background locations of automatic candidates.",
  ],
  EXTRA_LANES_IGNORED: [
    "检测到额外泳道，当前候选可能未覆盖全部图像。",
    "Extra lanes were detected; candidates may not cover the whole image.",
  ],
  CLIPPED_PIXELS: [
    "条带像素触及强度端点，线性范围未验证。",
    "Band pixels reach an intensity endpoint; the linear range is unverified.",
  ],
  BACKGROUND_CLIPPED: [
    "背景区域的像素触及强度端点。",
    "Background pixels reach an intensity endpoint.",
  ],
  NON_POSITIVE_NET: [
    "扣背景后的净信号非正，不能用于比值归一化。",
    "Background-corrected signal is nonpositive and cannot be normalized.",
  ],
  BAND_TOUCHES_EDGE: [
    "条带区域接触图像边界，请检查是否被裁切。",
    "The band region touches the image boundary; check for cropping.",
  ],
  LOW_LANE_SEPARATION: [
    "泳道分隔不清晰，需人工核对候选区域。",
    "Lane separation is weak; review candidate regions manually.",
  ],
};

const pixelErrorZh: Record<string, string> = {
  "Image dimensions exceed the supported limit (16384 per side, 8388608 pixels).":
    "图像尺寸超出限制：单边最多 16384 像素，总计最多 8388608 像素。",
  "Truncated or invalid image container.": "图像文件被截断或格式结构无效。",
  "Compressed image data length does not match its dimensions.":
    "压缩图像数据长度与尺寸不符。",
  "Invalid compressed image data.": "压缩图像数据无效。",
  "Compressed image checksum mismatch.": "压缩图像校验和不匹配。",
  "Invalid TIFF LZW stream (missing clear code).": "TIFF LZW 数据缺少清除码。",
  "TIFF LZW length does not match its dimensions.":
    "TIFF LZW 数据长度与尺寸不符。",
  "Invalid TIFF LZW code.": "TIFF LZW 编码无效。",
  "TIFF LZW output exceeds its declared dimensions.":
    "TIFF LZW 解码数据超出声明的尺寸。",
  "TIFF LZW table requires a clear code.": "TIFF LZW 编码表缺少清除码。",
  "Truncated TIFF LZW stream.": "TIFF LZW 数据被截断。",
  "Invalid TIFF byte order.": "TIFF 字节序无效。",
  "Only classic TIFF is supported; BigTIFF is not supported.":
    "仅支持标准 TIFF，暂不支持 BigTIFF。",
  "Invalid TIFF directory.": "TIFF 图像目录无效。",
  "TIFF metadata exceeds the supported limit.": "TIFF 元数据超出支持的大小。",
  "Multi-page TIFF is not supported.": "暂不支持多页 TIFF，请提供单页原图。",
  "Duplicate TIFF tag.": "TIFF 包含重复标签。",
  "Unsupported TIFF metadata type.": "不支持此 TIFF 元数据类型。",
  "TIFF subdirectories/EXIF are not supported.":
    "暂不支持带子目录或 EXIF 的 TIFF。",
  "Tiled TIFF is not supported.": "暂不支持分块 TIFF。",
  "TIFF metadata array exceeds the supported limit.":
    "TIFF 元数据数组超出限制。",
  "Missing required TIFF tag.": "缺少必要的 TIFF 标签。",
  "Invalid TIFF scalar tag.": "TIFF 标量标签无效。",
  "Only uniform 8/16-bit unsigned TIFF samples are supported.":
    "仅支持各通道一致的 8 位或 16 位无符号 TIFF。",
  "Only unsigned integer TIFF samples are supported.":
    "仅支持无符号整数 TIFF 像素。",
  "Only grayscale and RGB TIFF images are supported.":
    "仅支持灰度或 RGB TIFF。",
  "Unsupported TIFF channel layout.": "不支持此 TIFF 通道排列。",
  "TIFF orientation must be top-left; rotation is not supported.":
    "TIFF 必须以左上角为起点；暂不支持旋转方向。",
  "Only chunky TIFF samples with standard fill order are supported.":
    "仅支持标准位序、通道交错排列的 TIFF。",
  "Unsupported TIFF predictor.": "不支持此 TIFF 预测编码。",
  "WhiteIsZero TIFF with alpha is not supported.":
    "暂不支持带 Alpha 通道的白为零 TIFF。",
  "Custom TIFF sample ranges are not supported.":
    "暂不支持自定义 TIFF 像素范围。",
  "TIFF alpha channel must be explicitly identified.":
    "TIFF 的 Alpha 通道必须有明确标记。",
  "Unexpected TIFF extra samples.": "TIFF 包含未识别的额外通道。",
  "Unsupported TIFF compression; use uncompressed, LZW, or Deflate.":
    "不支持此 TIFF 压缩；支持未压缩、LZW 或 Deflate。",
  "Invalid TIFF strip layout.": "TIFF 条带存储结构无效。",
  "TIFF strip size does not match its dimensions.":
    "TIFF 条带数据大小与图像尺寸不符。",
  "PNG checksum mismatch.": "PNG 校验和不匹配。",
  "PNG header must be first.": "PNG 文件头顺序无效。",
  "Invalid PNG header.": "PNG 文件头无效。",
  "Only 8/16-bit PNG images are supported.": "仅支持 8 位或 16 位 PNG。",
  "Indexed/palette PNG images are not supported.":
    "暂不支持索引色或调色板 PNG。",
  "Unsupported PNG compression, filtering, or interlacing.":
    "不支持此 PNG 压缩、过滤或交错格式。",
  "PNG data chunks must be contiguous.": "PNG 图像数据块必须连续。",
  "Animated PNG is not supported.": "暂不支持动态 PNG。",
  "PNG transparency keys are not supported.": "暂不支持 PNG 透明色键。",
  "PNG EXIF/orientation metadata is not supported.":
    "暂不支持含 EXIF 或方向元数据的 PNG。",
  "Invalid PNG end chunk.": "PNG 结束块无效。",
  "Unsupported critical PNG chunk.": "PNG 包含不支持的关键数据块。",
  "PNG metadata exceeds the supported limit.": "PNG 元数据超出支持的大小。",
  "Incomplete PNG or trailing data.": "PNG 不完整或包含额外尾随数据。",
  "Image file must be 8 bytes to 64 MiB.":
    "图像文件大小须在 8 字节至 64 MiB 之间。",
  "Only TIFF and PNG image contents are supported.":
    "仅支持 TIFF 或 PNG 文件内容。",
  "Image extension does not match TIFF/PNG contents.":
    "文件扩展名与 TIFF/PNG 内容不匹配。",
  "Decoded samples do not match the image dimensions.":
    "解码像素数量与图像尺寸不符。",
  "Transparent or partially transparent pixels are not supported.":
    "暂不支持透明或半透明像素。",
  "Invalid raster data.": "像素数据无效。",
  "ROI must contain whole pixels within the image.":
    "区域必须使用图像范围内的整数像素。",
  "Unknown signal polarity.": "信号方向无效。",
  "Lane numbers must be positive integers.": "泳道编号必须为正整数。",
  "Band and background ROIs must not overlap.":
    "条带与背景区域不能重叠，请移动或缩小区域。",
  "Raster contains invalid intensity values.": "图像中含无效强度值。",
  "Lane count must be an integer from 1 to 96.":
    "泳道数量须为 1 至 96 的整数。",
  "Image is too small to propose band and background ROIs.":
    "图像太小，无法自动建议条带与背景区域。",
  "No band row has sufficient contrast; select ROIs manually.":
    "没有找到对比度足够的条带行，请手动创建并调整区域。",
  "Multiple comparable band rows are ambiguous; select ROIs manually.":
    "检测到多个相近条带行，无法可靠选择，请手动调整区域。",
  "Fewer resolved lanes than requested; overlapping or weak bands need manual ROIs.":
    "可分辨的泳道少于设定数量；重叠或弱条带需手动设置区域。",
  "A requested lane has no resolvable band; overlapping or empty lanes need manual ROIs.":
    "部分泳道未找到可分辨条带；请核对泳道数量，或手动设置空泳道、重叠条带的区域。",
  "Insufficient adjacent background space; select band/background ROIs manually.":
    "相邻背景空间不足，请手动选择条带与背景区域。",
};

function localizeMessage(message: string, language: Language): string {
  const statisticalReasons: Record<string, [string, string]> = {
    "test-disabled": ["尚未选择统计检验。", "No statistical test is selected."],
    "design-unconfirmed": [
      "请先确认样本独立性及配对设计。",
      "Confirm sample independence and the paired design first.",
    ],
    "requires-two-conditions": [
      "双侧配对 t 检验需要且仅支持两个条件。",
      "A two-sided paired t-test requires exactly two conditions.",
    ],
    "insufficient-pairs": [
      "至少需要 2 组完整配对。",
      "At least two complete pairs are required.",
    ],
    "duplicate-id": [
      "存在重复个体或实验编号。",
      "Individual or experiment IDs are duplicated.",
    ],
    "invalid-values": [
      "检验数据包含无效值。",
      "Test inputs contain invalid values.",
    ],
    "zero-variance": [
      "配对差值的方差为零，无法计算 t 检验。",
      "Paired differences have zero variance; a t-test is undefined.",
    ],
    "numeric-error": [
      "数值计算无法可靠完成。",
      "The numerical calculation could not be completed reliably.",
    ],
  };
  if (statisticalReasons[message])
    return statisticalReasons[message][language === "zh" ? 0 : 1];
  if (message.startsWith("[") && message.includes('"code"'))
    return language === "zh"
      ? "项目或参数校验失败。请确认导入的是此真实工作区导出的项目包，并检查区域与图像信息。"
      : "Project or settings validation failed. Use an archive exported by the real workspace and check the regions and image metadata.";
  if (message === "invalid zip data")
    return language === "zh"
      ? "项目包不是有效的 ZIP 文件。"
      : "The project archive is not a valid ZIP file.";
  const prefixes: [string, string, string][] = [
    [
      "LOCAL_SAVE_FAILED: ",
      "本机保存失败，请导出项目包备份。 ",
      "Local saving failed. Export a project archive for backup. ",
    ],
    ["Control target: ", "对照目标：", "Control target: "],
    ["Control reference: ", "对照内参：", "Control reference: "],
    ["Reference: ", "内参：", "Reference: "],
  ];
  for (const [prefix, zh, en] of prefixes)
    if (message.startsWith(prefix))
      return (
        (language === "zh" ? zh : en) +
        localizeMessage(message.slice(prefix.length), language)
      );
  if (warningLabels[message])
    return warningLabels[message][language === "zh" ? 0 : 1];
  if (language === "zh" && pixelErrorZh[message]) return pixelErrorZh[message];
  return translateMessage(message, language);
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileStem = (name: string) =>
  name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "WB-project";
const numberText = (value: number | null, digits = 3) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const unique = <T,>(values: T[]) => [...new Set(values)];
const requiredLaneCount = (project: RealProject, image?: RealImage) => {
  const pairs =
    image &&
    project.pairedDesign?.pairs.filter(
      (pair) => pair.groupId === image.replicate.trim(),
    );
  return Math.max(
    1,
    ...(pairs?.length
      ? pairs.flatMap((pair) => [pair.normalLane, pair.tumorLane])
      : project.laneLabels.map((label, index) =>
          isExcludedLane(label) ? 0 : index + 1,
        )),
  );
};

function constrainRect(rect: Rect, width: number, height: number): Rect {
  const w = Math.max(1, Math.min(width, Math.round(rect.width)));
  const h = Math.max(1, Math.min(height, Math.round(rect.height)));
  return {
    x: Math.max(0, Math.min(width - w, Math.round(rect.x))),
    y: Math.max(0, Math.min(height - h, Math.round(rect.y))),
    width: w,
    height: h,
  };
}

function wrapText(text: string, length: number): string[] {
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of text) {
    const step = /[^\x00-\x7f]/.test(char) ? 1.7 : 1;
    if (size + step > length) {
      lines.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += step;
  }
  if (current) lines.push(current);
  return lines;
}

function inferenceNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e6))
    return value.toExponential(4);
  return numberText(value, 6);
}

function pairDescription(pairs: PairedLanePair[]): string {
  return pairs
    .map((pair) =>
      [pair.groupId, pair.unitId, pair.normalLane, pair.tumorLane].join(", "),
    )
    .join("\n");
}

function parsePairDescription(text: string, t: Translate): PairedLanePair[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length)
    throw new Error(t("请至少填写一对 N/T。", "Enter at least one N/T pair."));
  return lines.map((line, index) => {
    const fields = line.split(/[,，\t]/).map((field) => field.trim());
    if (
      fields.length !== 4 ||
      !fields[0] ||
      !fields[1] ||
      !/^\d+$/.test(fields[2]) ||
      !/^\d+$/.test(fields[3])
    )
      throw new Error(
        t(
          `第 ${index + 1} 行须为：样本组编号, 个体编号, N 泳道, T 泳道。`,
          `Row ${index + 1} must be: source group ID, individual ID, N lane, T lane.`,
        ),
      );
    return {
      groupId: fields[0],
      unitId: fields[1],
      normalLane: Number(fields[2]),
      tumorLane: Number(fields[3]),
    };
  });
}

function ResultFigure({
  project,
  protein,
  rows,
  summaries,
  language,
  figureRef,
  plotStyle,
}: {
  project: RealProject;
  protein: string;
  rows: RealResult[];
  summaries: RealStatistics[];
  language: Language;
  figureRef: React.RefObject<SVGSVGElement | null>;
  plotStyle: "bars" | "paired";
}) {
  const t: Translate = (zh, en) => (language === "zh" ? zh : en);
  const normalizationPolicy = effectiveNormalization(project);
  const groups = summaries.filter((summary) => summary.protein === protein);
  const included = rows.filter(
    (row) =>
      row.protein === protein &&
      row.fold !== null &&
      row.status !== "blocked" &&
      groups
        .find((group) => group.sample === row.sample)
        ?.replicates.includes(row.unitId ?? row.replicate),
  );
  const testSelected = project.statisticalTest === "paired-t";
  const inferenceRecord = testSelected
    ? realPairedTests(project).find((entry) => entry.protein === protein)
    : null;
  const inference = inferenceRecord?.result ?? null;
  const pLabel =
    typeof inference?.pValue === "number"
      ? inference.pValue === 0
        ? "P < machine precision"
        : `P = ${inference.pValue < 0.0001 ? inference.pValue.toExponential(3) : inference.pValue.toPrecision(4)}`
      : null;
  const inferenceLines = !testSelected
    ? []
    : !inference
      ? [
          t(
            "配对检验未执行：须确认独立性，并提供两个条件的完整配对。",
            "Paired test not performed: confirm independence and supply complete pairs for two conditions.",
          ),
        ]
      : pLabel
        ? [
            t(
              `双侧配对 t 检验：${pLabel}；n = ${inference.n}；df = ${inference.df}；未校正。`,
              `Two-sided paired t-test: ${pLabel}; n = ${inference.n}; df = ${inference.df}; unadjusted.`,
            ),
            t(
              "检验基于目标/内参比值的配对差值；不受图形归一化方式影响。小样本正态假设未验证。",
              "Test uses paired differences of target/reference ratios, unaffected by plot normalization. Small-n normality is unverified.",
            ),
          ]
        : [
            t("配对检验无法计算：", "Paired test unavailable: ") +
              localizeMessage(inference.reason ?? "", language),
          ];
  const draft =
    inferenceRecord?.quality === "draft" ||
    !project.designConfirmed ||
    rows.some((row) => row.protein === protein && row.status !== "ready") ||
    groups.some((group) => group.status !== "ready");
  const rawWarnings = unique(
    rows
      .filter((row) => row.protein === protein)
      .flatMap((row) => row.warnings),
  );
  const summaryWarnings = [
    ...groups.flatMap((group) => group.warnings),
    ...(inferenceRecord?.warnings ?? []),
  ];
  const warningLines = unique([...rawWarnings, ...summaryWarnings]).flatMap(
    (warning) => wrapText(localizeMessage(warning, language), 110),
  );
  const width = 900,
    plotTop = pLabel ? 137 : 106,
    plotBottom = 370,
    left = 78,
    right = 840;
  const maxValue =
    Math.max(
      1,
      ...included.map((row) => row.fold!),
      ...groups.map((group) => (group.mean ?? 0) + (group.sd ?? 0)),
    ) * 1.18;
  const minValue =
    Math.min(0, ...groups.map((group) => (group.mean ?? 0) - (group.sd ?? 0))) *
    1.1;
  const y = (value: number) =>
    plotBottom -
    ((value - minValue) / (maxValue - minValue)) * (plotBottom - plotTop);
  const x = (index: number) =>
    left + ((right - left) * (index + 0.5)) / Math.max(1, groups.length);
  const experiments = unique(
    included.map((row) => row.unitId ?? row.replicate),
  );
  const colors = [
    "#287654",
    "#577eaf",
    "#b87940",
    "#8b6ca6",
    "#7b9243",
    "#a26373",
  ];
  const height = 520 + (warningLines.length + inferenceLines.length) * 17;
  return (
    <>
      <svg
        ref={figureRef}
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t(
          "配对实验相对表达图",
          "Relative expression across paired experiments",
        )}
        className="real-result-figure"
        style={{
          fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
        }}
      >
        <rect width={width} height={height} fill="#fff" />
        <text x="28" y="31" fontSize="19" fontWeight="700" fill="#284f3d">
          {protein} · {t("相对表达", "Relative expression")}
        </text>
        <text
          x="872"
          y="31"
          fontSize="16"
          fontWeight="700"
          textAnchor="end"
          fill={draft ? "#9b6228" : "#35654b"}
        >
          {draft ? "DRAFT" : t("已复核 · 实验功能", "REVIEWED · EXPERIMENTAL")}
        </text>
        <text x="28" y="56" fontSize="12" fill="#53695b">
          {normalizationPolicy.kind === "reference-unit"
            ? t(
                `共同基准：${normalizationPolicy.unitId} 的对照（目标 / 内参）= 1；其他对照保留实际差异。`,
                `Common baseline: control target/reference in ${normalizationPolicy.unitId} = 1; other controls retain variation.`,
              )
            : project.pairedDesign
              ? t(
                  "每位个体：目标 / 内参，再除以其正常 N 比值；N = 1 是归一化定义。",
                  "Within each individual: (target / reference) divided by their normal N ratio; N = 1 by definition.",
                )
              : t(
                  "每次实验：目标 / 内参，再除以同次对照比值；对照 = 1。",
                  "Within each experiment: (target / reference) divided by its matched control ratio; control = 1.",
                )}
        </text>
        <text x="28" y="77" fontSize="12" fill="#53695b">
          {plotStyle === "bars"
            ? t(
                "柱：均值；点：观测；误差线：SD（n ≥ 2）。仅纳入完整配对。",
                "Bars: means; points: observations; error bars: SD (n ≥ 2). Complete pairs only.",
              )
            : t(
                "点与线：完整配对；横线与误差线：均值 ± SD（n ≥ 2）。",
                "Points and lines: complete pairs. Summary and error bars: mean ± SD (n ≥ 2).",
              )}
        </text>
        {pLabel && (
          <g className="real-p-value" fill="#435b4b" stroke="#637c6a">
            <path
              d={`M ${x(0)} ${plotTop - 17} v -8 H ${x(1)} v 8`}
              fill="none"
              strokeWidth="1.3"
            />
            <text
              x={(x(0) + x(1)) / 2}
              y={plotTop - 33}
              textAnchor="middle"
              stroke="none"
              fontSize="13"
            >
              {pLabel}
            </text>
          </g>
        )}
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = minValue + ((maxValue - minValue) * tick) / 4;
          return (
            <g key={tick}>
              <line
                x1={left}
                y1={y(value)}
                x2={right}
                y2={y(value)}
                stroke="#e5ece7"
              />
              <text
                x={left - 12}
                y={y(value) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#6e7e71"
              >
                {numberText(value, 2)}
              </text>
            </g>
          );
        })}
        <line
          x1={left}
          y1={y(1)}
          x2={right}
          y2={y(1)}
          stroke="#a5b7a8"
          strokeDasharray="4 4"
        />
        <line
          x1={left}
          y1={plotBottom}
          x2={right}
          y2={plotBottom}
          stroke="#738b7a"
        />
        <text
          transform={`translate(20 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="12"
          fill="#53695b"
        >
          {normalizationPolicy.kind === "reference-unit"
            ? t("相对共同基准的倍数", "Fold relative to common baseline")
            : t("相对配对对照的倍数", "Fold relative to matched control")}
        </text>
        {plotStyle === "bars" &&
          groups.map(
            (group, index) =>
              group.mean !== null && (
                <rect
                  key={group.sample}
                  className="real-mean-bar"
                  x={x(index) - 46}
                  y={y(Math.max(0, group.mean))}
                  width="92"
                  height={Math.abs(y(group.mean) - y(0))}
                  fill={index === 0 ? "#82a695" : "#87a9ce"}
                  fillOpacity="0.42"
                  stroke={index === 0 ? "#52836b" : "#577eaf"}
                />
              ),
          )}
        {experiments.map((experiment, index) => {
          const values = groups
            .map((group, groupIndex) => ({
              row: included.find(
                (row) =>
                  (row.unitId ?? row.replicate) === experiment &&
                  row.sample === group.sample,
              ),
              groupIndex,
            }))
            .filter((point) => point.row);
          const jitter =
            experiments.length <= 1
              ? 0
              : (index - (experiments.length - 1) / 2) *
                Math.min(7, 45 / experiments.length);
          const color = colors[index % colors.length];
          return (
            <g key={experiment}>
              {plotStyle === "paired" && values.length > 1 && (
                <polyline
                  points={values
                    .map(
                      ({ row, groupIndex }) =>
                        `${x(groupIndex) + jitter},${y(row!.fold!)}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke={color}
                  strokeOpacity="0.4"
                  strokeWidth="1.5"
                />
              )}
              {values.map(({ row, groupIndex }) => (
                <circle
                  key={row!.imageId + row!.lane}
                  cx={x(groupIndex) + jitter}
                  cy={y(row!.fold!)}
                  r="4.5"
                  fill={color}
                >
                  <title>
                    {project.pairedDesign
                      ? t("个体", "Individual")
                      : t("实验", "Experiment")}{" "}
                    {experiment} · {row!.sample}: {numberText(row!.fold)}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        {groups.map((group, index) => (
          <g key={group.sample}>
            {group.mean !== null && group.n >= 2 && group.sd !== null && (
              <g stroke="#274d39" strokeWidth="2">
                <line
                  x1={x(index) + 32}
                  y1={y(group.mean - group.sd)}
                  x2={x(index) + 32}
                  y2={y(group.mean + group.sd)}
                />
                <line
                  x1={x(index) + 24}
                  y1={y(group.mean - group.sd)}
                  x2={x(index) + 40}
                  y2={y(group.mean - group.sd)}
                />
                <line
                  x1={x(index) + 24}
                  y1={y(group.mean + group.sd)}
                  x2={x(index) + 40}
                  y2={y(group.mean + group.sd)}
                />
                <line
                  x1={x(index) + 19}
                  y1={y(group.mean)}
                  x2={x(index) + 45}
                  y2={y(group.mean)}
                  strokeWidth="3"
                />
              </g>
            )}
            <text
              x={x(index)}
              y={plotBottom + 23}
              textAnchor="middle"
              fontSize="13"
              fill="#385742"
            >
              {group.sample}
            </text>
            <text
              x={x(index)}
              y={plotBottom + 44}
              textAnchor="middle"
              fontSize="11"
              fill="#718171"
            >
              n = {group.n} ·{" "}
              {group.unitLabel === "individuals"
                ? t("独立个体", "individuals")
                : group.unitLabel === "independent experiments"
                  ? t("独立实验", "independent experiments")
                  : t("配对组", "paired sets")}
            </text>
          </g>
        ))}
        <text x="28" y="447" fontSize="11" fill="#617366">
          {t(
            "独立性由实验设计确认；多曝光和同一实验的重复测量不增加 n。",
            "Independence requires design confirmation; extra exposures and repeated measurements do not increase n.",
          )}
        </text>
        <text x="28" y="468" fontSize="11" fill="#617366">
          {project.exampleKind === "synthetic"
            ? t(
                "SYNTHETIC · 合成像素示例，非真实实验；图形保留质量状态。",
                "SYNTHETIC · Simulated pixels, not real experiments; quality status is retained.",
              )
            : t(
                "实验性本机分析；图形包含当前质量状态。",
                "Experimental local analysis; this figure retains the current quality status.",
              )}
        </text>
        {inferenceLines.map((line, index) => (
          <text
            key={`test-${index}`}
            x="28"
            y={497 + index * 17}
            fontSize="10"
            fill="#53695b"
          >
            {line}
          </text>
        ))}
        {warningLines.map((line, index) => (
          <text
            key={index}
            x="28"
            y={497 + (inferenceLines.length + index) * 17}
            fontSize="10"
            fill="#94632d"
          >
            {index === 0 ? "⚠ " : "  "}
            {line}
          </text>
        ))}
      </svg>
      {testSelected && (
        <div className="real-statistics-panel">
          <strong>{t("配对检验详情", "Paired inference details")}</strong>
          {inference?.pValue !== null && inference?.pValue !== undefined ? (
            <>
              <p>
                {pLabel} · n = {inference.n} · t ={" "}
                {inferenceNumber(inference.t)} · df = {inference.df}
              </p>
              <p>
                {t(
                  "配对差值均值（比较条件 − 对照）",
                  "Mean paired difference (comparison − control)",
                )}
                : {inferenceNumber(inference.meanDifference)} ·{" "}
                {t("95% 置信区间", "95% confidence interval")}:{" "}
                {inference.ci95
                  ? `[${inferenceNumber(inference.ci95[0])}, ${inferenceNumber(inference.ci95[1])}]`
                  : "—"}
              </p>
              <p className="real-muted">
                {t(
                  "差值单位为目标/内参比值。P 值未经多重比较校正；图形上的归一化倍数不参与此检验。",
                  "Differences are in target/reference ratio units. P-values are unadjusted; plotted normalized folds are not test inputs.",
                )}
              </p>
            </>
          ) : (
            <p>
              {localizeMessage(
                inference?.reason ?? inferenceRecord?.reason ?? "",
                language,
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}

const VISION_ANALYZE_PROMPT_VERSION = "wb-lane-band-candidates-v1";
const VISION_UPLOAD_PREVIEW_WIDTH = 1024;
/** Built-in 1×1 PNG for connectivity tests only — never project data. */
const SYNTHETIC_TEST_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const visionCandidatesCache = new VisionCandidateCache();

/** Downscaled 8-bit grayscale PNG for optional vision providers. */
async function uploadPreviewDataUrl(bytes: Uint8Array): Promise<string> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
  );
  try {
    const scale = Math.min(1, VISION_UPLOAD_PREVIEW_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Canvas is unavailable for the upload preview.");
    context.imageSmoothingEnabled = true;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export default function RealWorkbench({ onDemo }: { onDemo: () => void }) {
  const [project, setProject] = useState<RealProject | null>(null);
  const currentProject = useRef<RealProject | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const visionAbort = useRef<AbortController | null>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReport | null>(
    null,
  );
  const [byokPanelOpen, setByokPanelOpen] = useState(false);
  const [byokReady, setByokReady] = useState(() => loadByokConfig() !== null);
  const [byokDraft, setByokDraft] = useState(() => {
    const saved = loadByokConfig();
    return {
      baseUrl: saved?.baseUrl ?? "",
      model: saved?.model ?? "",
      apiKey: saved?.apiKey ?? "",
      remember: false,
    };
  });
  const [byokNotice, setByokNotice] = useState("");
  const working = useRef(false);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">(
    "saved",
  );
  const saveVersion = useRef(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [laneDraft, setLaneDraft] = useState("");
  const [lanePreview, setLanePreview] = useState<string[] | null>(null);
  const [designMode, setDesignMode] = useState<"shared" | "paired">("shared");
  const [pairDraft, setPairDraft] = useState("");
  const [pairPreview, setPairPreview] = useState<PairedLanePair[] | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<{
    lane: number;
    kind: RegionKind;
  }>({ lane: 1, kind: "band" });
  const [dragging, setDragging] = useState(false);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const drag = useRef<Drag | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newName, setNewName] = useState("");
  const [selectedProtein, setSelectedProtein] = useState("");
  const [calculationVersion, setCalculationVersion] = useState(0);
  const [plotStyle, setPlotStyle] = useState<"bars" | "paired">("bars");
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const figureRef = useRef<SVGSVGElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { language, setLanguage, t } = useLanguage();

  const accept = (next: RealProject) => {
    currentProject.current = next;
    setProject(next);
  };
  const replace = (next: RealProject) => {
    accept(next);
    setSelectedId(next.images[0]?.id ?? "");
    setLaneDraft(next.laneDescription);
    setLanePreview(null);
    setDesignMode(next.pairedDesign ? "paired" : "shared");
    setPairDraft(pairDescription(next.pairedDesign?.pairs ?? []));
    setPairPreview(null);
    setSelectedRegion({ lane: 1, kind: "band" });
    setSelectedProtein("");
    setPlotStyle("bars");
    setLoadFailed(false);
    setDialog(null);
    setError("");
  };
  const platformState = useRef({ laneDraft, pairDraft, dragging, dialog, t });
  platformState.current = { laneDraft, pairDraft, dragging, dialog, t };
  useEffect(() => {
    let active = true;
    let importing = false;
    let unregister: (() => void) | undefined;
    const aborted = () =>
      new DOMException("Workspace changed or import cancelled", "AbortError");
    const unchanged = (before: RealProject) => {
      const state = platformState.current;
      return (
        active &&
        currentProject.current === before &&
        !working.current &&
        !state.dragging &&
        !state.dialog &&
        state.laneDraft === before.laneDescription &&
        state.pairDraft === pairDescription(before.pairedDesign?.pairs ?? [])
      );
    };
    const snapshot = () => {
      const before = currentProject.current;
      if (importing || !before || !unchanged(before)) throw aborted();
      return before;
    };
    const register = () => {
      const host = window as typeof window & {
        WispLab?: {
          registerProjectAdapter(adapter: {
            tool: string;
            exportProject(): Promise<{
              blob: Blob;
              name: string;
              summary: string;
              summaryTranslations?: { zh: string; en: string };
            }>;
            importProject(
              blob: Blob,
              options?: { isCurrent: () => boolean },
            ): Promise<void>;
          }): () => void;
        };
      };
      if (!host.WispLab) return;
      unregister?.();
      unregister = host.WispLab.registerProjectAdapter({
        tool: "wb-real",
        async exportProject() {
          const before = snapshot();
          const blob = await exportRealProject(before);
          if (snapshot() !== before) throw aborted();
          return {
            blob,
            name: `${fileStem(before.name)}.realwb.zip`,
            summaryTranslations: {
              zh: "WB 原图项目 · " + before.name,
              en: "WB original-image project · " + before.name,
            },
            summary:
              platformState.current.t(
                "WB 原图项目 · ",
                "WB original-image project · ",
              ) + before.name,
          };
        },
        async importProject(blob, options) {
          const before = snapshot();
          importing = true;
          try {
            const next = await importRealProject(blob);
            if (!unchanged(before) || !(options?.isCurrent() ?? true))
              throw aborted();
            if (
              !window.confirm(
                platformState.current.t(
                  "项目包已通过校验。导入将替换当前 WB 原图工作区；需要保留的内容请先导出。确认导入？",
                  "The archive passed validation. Importing replaces the current WB original-image workspace. Export anything you need to keep first. Import this project?",
                ),
              )
            )
              throw aborted();
            if (!unchanged(before) || !(options?.isCurrent() ?? true))
              throw aborted();
            replace(next);
            setAnalysisReport(null);
            setSaveState("saving");
            setNotice(
              platformState.current.t("项目已导入", "Project imported"),
            );
          } finally {
            importing = false;
          }
        },
      });
    };
    register();
    window.addEventListener("wisplab:ready", register);
    return () => {
      active = false;
      unregister?.();
      window.removeEventListener("wisplab:ready", register);
    };
  }, []);
  const commit = (change: (previous: RealProject) => RealProject) => {
    if (!currentProject.current) return;
    try {
      accept(change(currentProject.current));
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const patchImage = (id: string, patch: RealImagePatch) =>
    commit((previous) => updateRealImage(previous, id, patch));
  const run = async (label: string, task: () => Promise<void> | void) => {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      working.current = false;
      setBusy(null);
    }
  };

  const proposeVisionRegions = async (target: "all" | RealImage) => {
    const config = loadByokConfig();
    if (!config)
      throw new Error(
        "请先在「视觉服务（自带 API）」中填写服务地址、模型与 API Key；候选仍需人工复核，像素测量始终在本机完成。/ Configure your own provider (base URL, model, API key) in the vision panel first. Candidates still require manual review and pixel measurement stays local.",
      );
    const controller = new AbortController();
    visionAbort.current = controller;
    try {
      const targets =
        target === "all"
          ? (currentProject.current as RealProject).images.filter(
              (image) => !image.excluded,
            )
          : [target];
      if (!targets.length) return;
      if (target === "all") commit((previous) => analyzeAll(previous));
      let done = 0;
      for (const image of targets) {
        if (controller.signal.aborted)
          throw new Error(
            "已取消视觉候选请求 / Vision candidate requests cancelled.",
          );
        done += 1;
        setBusy(
          t(
            `正在获取视觉候选 ${done}/${targets.length}…`,
            `Requesting vision candidates ${done}/${targets.length}…`,
          ),
        );
        const current = (currentProject.current as RealProject).images.find(
          (entry) => entry.id === image.id,
        )!;
        const raster = imageRaster(current);
        const laneCount = requiredLaneCount(
          currentProject.current as RealProject,
          current,
        );
        const laneLabels = (currentProject.current as RealProject).laneLabels;
        const cacheKey = visionCacheKey({
          imageHash: current.hash,
          uploadPreviewWidth: VISION_UPLOAD_PREVIEW_WIDTH,
          baseUrl: config.baseUrl,
          model: config.model,
          promptVersion: VISION_ANALYZE_PROMPT_VERSION,
          laneCount,
          laneLabels,
          signal: current.signal,
          revision: 0,
        });
        let bands = visionCandidatesCache.get(cacheKey);
        if (!bands) {
          const preview = await uploadPreviewDataUrl(rasterPreview(raster));
          let result;
          try {
            result = await analyzeBandsByok(
              config,
              {
                laneCount,
                laneLabels: laneLabels.map((label) => label.slice(0, 60)),
                signal: current.signal,
                imageDataUrl: preview,
              },
              controller.signal,
            );
          } catch (problem) {
            if (
              problem instanceof DOMException &&
              problem.name === "AbortError"
            )
              throw new Error(
                "已取消视觉候选请求 / Vision candidate requests cancelled.",
              );
            throw problem;
          }
          bands = result.bands;
          visionCandidatesCache.set(cacheKey, bands);
        }
        const baseRegions = current.regions.length
          ? current.regions
          : proposeRegions(raster, laneCount, current.signal);
        commit((previous) =>
          updateRealImage(previous, image.id, {
            regions: applyVisionCandidates(baseRegions, bands, {
              width: raster.width,
              height: raster.height,
              maxLane: laneCount,
            }),
          }),
        );
      }
      setNotice(
        target === "all"
          ? t(
              "视觉候选已合并，全部候选（含视觉来源）必须逐图人工复核；测量始终使用本机原始像素。",
              "Vision candidates are merged in. All candidates (including vision-sourced) require per-image review; measurement always uses local original pixels.",
            )
          : t(
              "视觉候选已合并，请人工复核此图。",
              "Vision candidates are merged in; review this image manually.",
            ),
      );
    } finally {
      visionAbort.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadRealProject()
      .then((saved) => {
        if (!cancelled) replace(saved ?? createRealProject());
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setLoadFailed(true);
          setError(
            problem instanceof Error ? problem.message : String(problem),
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // The real workspace has its own storage key and is loaded once per mount.
  }, []);

  useEffect(() => {
    return () => {
      // Hash navigation does not fire beforeunload. Capture the latest edit
      // synchronously before leaving; the model serializes this write and a
      // subsequent load waits for it. The initial StrictMode cleanup has no
      // project, so it must not overwrite a workspace that is still loading.
      const latest = currentProject.current;
      if (latest) void saveRealProject(latest).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    const version = ++saveVersion.current;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveRealProject(project)
        .then(() => {
          if (saveVersion.current === version) setSaveState("saved");
        })
        .catch((problem: unknown) => {
          if (saveVersion.current === version) {
            setSaveState("error");
            setError(
              `LOCAL_SAVE_FAILED: ${problem instanceof Error ? problem.message : String(problem)}`,
            );
          }
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (saveState === "saved" && !busy) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saveState, busy]);

  useEffect(() => {
    if (!dialog || !dialogRef.current) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current.querySelector<HTMLElement>("input,button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working.current) setDialog(null);
      if (event.key !== "Tab") return;
      const elements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled)",
        ) ?? [],
      );
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [dialog]);

  const image =
    project?.images.find((entry) => entry.id === selectedId) ??
    project?.images[0];
  const raster = useMemo(
    () => (image ? imageRaster(image) : null),
    [image?.bytes],
  );
  useEffect(() => {
    setDragRect(null);
    drag.current = null;
    if (!raster) {
      setPreviewUrl("");
      return;
    }
    try {
      const bytes = rasterPreview(raster);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }),
      );
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [raster]);

  const calculated = useMemo(() => {
    if (!project)
      return {
        rows: [] as RealResult[],
        summaries: [] as RealStatistics[],
        problem: "",
      };
    try {
      return {
        rows: results(project),
        summaries: descriptiveStatistics(project),
        problem: "",
      };
    } catch (problem) {
      return {
        rows: [] as RealResult[],
        summaries: [] as RealStatistics[],
        problem: problem instanceof Error ? problem.message : String(problem),
      };
    }
  }, [project, calculationVersion]);
  const imageMeasurements = useMemo(() => {
    if (!image || !raster) return [];
    return image.regions.map((region) => {
      try {
        return {
          region,
          value: measureRegion(raster, region, image.signal),
          error: "",
        };
      } catch (problem) {
        return {
          region,
          value: null,
          error: problem instanceof Error ? problem.message : String(problem),
        };
      }
    });
  }, [image, raster, calculationVersion]);
  const proteins = unique(
    project?.images
      .filter((entry) => entry.role === "target")
      .map((entry) => entry.protein) ?? [],
  );
  const protein = proteins.includes(selectedProtein)
    ? selectedProtein
    : (proteins[0] ?? "");
  const normalizationUnits = project ? normalizationUnitIds(project) : [];
  const normalizationPolicy = project ? effectiveNormalization(project) : null;
  const region =
    image?.regions.find((entry) => entry.lane === selectedRegion.lane) ??
    image?.regions[0];
  const activeRect = dragRect ?? region?.[selectedRegion.kind];
  const figureAvailable = calculated.summaries.some(
    (summary) => summary.protein === protein && summary.n > 0,
  );
  const imageWarnings = unique([
    ...(raster?.warnings ?? []),
    ...(image?.analysisError ? [image.analysisError] : []),
    ...imageMeasurements.flatMap(
      (entry) => entry.value?.warnings ?? (entry.error ? [entry.error] : []),
    ),
  ]);
  const includedImages =
    project?.images.filter((entry) => !entry.excluded) ?? [];
  const proposedImages = includedImages.filter(
    (entry) => entry.regions.length > 0 && !entry.analysisError,
  );
  const failedImages = includedImages.filter((entry) => entry.analysisError);
  const pendingImages = includedImages.filter(
    (entry) => !entry.regions.length && !entry.analysisError,
  );
  const mappingUnapplied =
    !!project &&
    (designMode !== (project.pairedDesign ? "paired" : "shared") ||
      (designMode === "paired"
        ? pairPreview !== null ||
          pairDraft !== pairDescription(project.pairedDesign?.pairs ?? [])
        : lanePreview !== null || laneDraft !== project.laneDescription));
  const showRegions = (imageId?: string) => {
    if (imageId) setSelectedId(imageId);
    sections.current[2]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const recognizeImages = (withReport = false) =>
    void run(
      t("正在识别条带并计算…", "Recognizing bands and calculating…"),
      () => {
        if (!currentProject.current) return;
        const next = analyzeAll(currentProject.current, withReport);
        accept(next);
        if (withReport) setAnalysisReport(buildAnalysisReport(next));
        const included = next.images.filter((entry) => !entry.excluded);
        const failed = included.filter((entry) => entry.analysisError);
        const proposed = included.filter(
          (entry) => entry.regions.length && !entry.analysisError,
        );
        setNotice(
          `已有候选区域 ${proposed.length} 张，识别未完成 ${failed.length} 张。请核对图中取样框；归一化还需要确认图像配对。 / ${proposed.length} image(s) have candidate regions; recognition is incomplete for ${failed.length}. Check the boxes; normalization also requires image pairing.`,
        );
        showRegions(failed[0]?.id ?? proposed[0]?.id);
      },
    );

  const importFiles = (files: File[]) =>
    void run(t("正在读取原始图像…", "Reading original images…"), async () => {
      if (!currentProject.current || !files.length) return;
      if (files.some((file) => !/\.(?:tiff?|png)$/i.test(file.name)))
        throw new Error(
          t(
            "请选择 TIFF 或 PNG 原始图像；项目包请用“打开项目”。",
            "Choose TIFF or PNG originals. Use Open project for an archive.",
          ),
        );
      if (files.some((file) => file.size > 64 * 1024 * 1024))
        throw new Error(
          t(
            "单个原始图像不能超过 64 MiB。",
            "An original image cannot exceed 64 MiB.",
          ),
        );
      const total =
        files.reduce((sum, file) => sum + file.size, 0) +
        currentProject.current.images.reduce(
          (sum, entry) => sum + entry.bytes.length,
          0,
        );
      if (total > 256 * 1024 * 1024)
        throw new Error(
          t(
            "项目原始图像总量不能超过 256 MiB。",
            "Original images in a project cannot exceed 256 MiB.",
          ),
        );
      const data = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const previousCount = currentProject.current.images.length;
      const next = await importRealImages(currentProject.current, data);
      accept(next);
      setSelectedId(next.images[previousCount]?.id ?? next.images[0]?.id ?? "");
      setNotice(
        `已导入 ${files.length} 张原图，尚未开始识别。核对下方泳道设置，再点“识别并查看条带”。 / Imported ${files.length} originals; recognition has not started. Check the lane settings below, then choose “Recognize & view bands”.`,
      );
    });
  const archive = () =>
    run(
      t("正在打包原图与分析…", "Packing originals and analyses…"),
      async () => {
        if (!currentProject.current) return;
        saveBlob(
          await exportRealProject(currentProject.current),
          `${fileStem(currentProject.current.name)}.realwb.zip`,
        );
        setNotice(
          t(
            "已导出含原图、区域、参数和历史的项目包。",
            "Exported originals, regions, settings, and history in a project archive.",
          ),
        );
      },
    );
  const loadPixelExample = () =>
    void run(
      t(
        "正在读取合成像素验证示例…",
        "Loading the synthetic pixel-validation example…",
      ),
      async () => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}examples/real/example.realwb.zip`,
          { credentials: "same-origin" },
        );
        if (!response.ok)
          throw new Error(
            t(
              "无法读取此版本的像素验证示例，请稍后重试或导入原图。",
              "The pixel-validation example is unavailable in this build. Retry later or import originals.",
            ),
          );
        setDialog({
          kind: "import",
          project: updateRealProject(
            await importRealProject(await response.blob()),
            { exampleKind: "synthetic" },
          ),
        });
      },
    );
  const changeRect = (
    nextRect: Rect,
    imageId = image?.id,
    lane = region?.lane,
    kind = selectedRegion.kind,
  ) => {
    if (!imageId || !lane || !currentProject.current) return;
    const currentImage = currentProject.current.images.find(
      (entry) => entry.id === imageId,
    );
    if (!currentImage) return;
    const size = imageRaster(currentImage);
    patchImage(imageId, {
      regions: currentImage.regions.map((entry) =>
        entry.lane === lane
          ? {
              ...entry,
              [kind]: constrainRect(nextRect, size.width, size.height),
              source: "manual",
            }
          : entry,
      ),
    });
  };
  const imagePoint = (clientX: number, clientY: number) => {
    const svg = canvasRef.current,
      matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const beginDrag = (
    event: ReactPointerEvent<SVGElement>,
    selected: LaneRegion,
    kind: RegionKind,
    resize = false,
  ) => {
    if (!image || !raster || busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = imagePoint(event.clientX, event.clientY);
    setSelectedRegion({ lane: selected.lane, kind });
    drag.current = {
      pointerId: event.pointerId,
      imageId: image.id,
      lane: selected.lane,
      kind,
      resize,
      start,
      original: { ...selected[kind] },
      current: { ...selected[kind] },
    };
    setDragRect(selected[kind]);
    canvasRef.current?.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (!state || !raster || event.pointerId !== state.pointerId) return;
    const point = imagePoint(event.clientX, event.clientY);
    const dx = point.x - state.start.x,
      dy = point.y - state.start.y;
    const next = state.resize
      ? {
          ...state.original,
          width: Math.max(
            1,
            Math.min(
              raster.width - state.original.x,
              state.original.width + dx,
            ),
          ),
          height: Math.max(
            1,
            Math.min(
              raster.height - state.original.y,
              state.original.height + dy,
            ),
          ),
        }
      : {
          ...state.original,
          x: state.original.x + dx,
          y: state.original.y + dy,
        };
    state.current = constrainRect(next, raster.width, raster.height);
    setDragRect(state.current);
  };
  const finishDrag = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancel = false,
  ) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!cancel)
      changeRect(state.current, state.imageId, state.lane, state.kind);
    drag.current = null;
    setDragRect(null);
    if (canvasRef.current?.hasPointerCapture(event.pointerId))
      canvasRef.current.releasePointerCapture(event.pointerId);
  };
  const manualGrid = () => {
    if (!image || !raster || !project) return;
    const laneCount = requiredLaneCount(project, image);
    const laneWidth = raster.width / laneCount;
    const height = Math.max(1, Math.floor(raster.height / 8));
    const regions: LaneRegion[] = Array.from(
      { length: laneCount },
      (_, index) => ({
        lane: index + 1,
        source: "manual",
        band: constrainRect(
          {
            x: laneWidth * (index + 0.22),
            y: raster.height * 0.3,
            width: laneWidth * 0.56,
            height,
          },
          raster.width,
          raster.height,
        ),
        background: constrainRect(
          {
            x: laneWidth * (index + 0.22),
            y: raster.height * 0.65,
            width: laneWidth * 0.56,
            height,
          },
          raster.width,
          raster.height,
        ),
      }),
    );
    patchImage(image.id, { regions });
    setNotice(
      t(
        "已创建可手调的网格，请将每个条带与背景框移到正确位置。",
        "Created a manual grid. Position every band and background region before reviewing.",
      ),
    );
  };
  const exportFigure = (format: "svg" | "png" | "tiff") =>
    void run(t("正在导出图形…", "Exporting figure…"), async () => {
      if (!figureRef.current || !currentProject.current) return;
      const svg = new XMLSerializer().serializeToString(figureRef.current);
      const blob =
        format === "svg"
          ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
          : await renderFigure(svg, format);
      const isDraft =
        calculated.rows.some(
          (row) => row.protein === protein && row.status !== "ready",
        ) ||
        calculated.summaries.some(
          (summary) =>
            summary.protein === protein && summary.status !== "ready",
        ) ||
        !currentProject.current.designConfirmed;
      saveBlob(
        blob,
        `${isDraft ? "DRAFT-" : "EXPERIMENTAL-"}${fileStem(protein)}-paired.${format === "tiff" ? "tif" : format}`,
      );
    });
  const composedFigureSvg = async (): Promise<string> => {
    const chart = figureRef.current;
    if (!chart)
      throw new Error("Quantification chart is not rendered / 定量图尚未渲染");
    if (!image) throw new Error("Select an image first / 请先选择图像");
    const current = currentProject.current;
    const raster = imageRaster(image);
    const bytes = rasterPreview(raster);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const correction = current?.backgroundCorrection;
    const policy = current ? effectiveNormalization(current) : null;
    return buildComposedFigureSvg({
      layout: "side-by-side",
      imageHref: `data:image/png;base64,${btoa(binary)}`,
      imageWidth: raster.width,
      imageHeight: raster.height,
      regions: image.regions,
      laneLabels: current?.laneLabels ?? [],
      chartSvg: new XMLSerializer().serializeToString(chart),
      captionLines: [
        t("定量：", "Quantitation: ") +
          (correction?.kind === "rolling-ball"
            ? `rolling ball r=${correction.radius} (${ROLLING_BALL_ALGORITHM})`
            : t("局部背景取样框", "local background ROIs")),
        t("归一化：", "Normalization: ") +
          (policy?.kind === "reference-unit"
            ? `reference-unit ${policy.unitId}`
            : "matched-control"),
        `blot-workbench ${APP_VERSION}`,
      ],
    });
  };
  const exportComposedFigure = async (format: "svg" | "png" | "tiff") => {
    const svg = await composedFigureSvg();
    format === "svg"
      ? saveBlob(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
          `${fileStem(project?.name ?? "blot-workbench")}-figure.svg`,
        )
      : saveBlob(
          await renderFigure(svg, format),
          `${fileStem(project?.name ?? "blot-workbench")}-figure.${format}`,
        );
  };

  if (!project)
    return (
      <div className="real-workbench">
        <h1>{t("真实 WB 分析", "Real WB analysis")}</h1>
        {loadFailed ? (
          <>
            <div className="real-error" role="alert">
              {localizeMessage(error, language)}
            </div>
            <p>
              {t(
                "已有本机数据尚未被覆盖。可重新加载，或明确新建一个真实图像项目。",
                "Existing local data has not been replaced. Reload, or explicitly start a new real-image project.",
              )}
            </p>
            <div className="real-actions">
              <button
                className="real-button"
                onClick={() => window.location.reload()}
              >
                {t("重新加载", "Reload")}
              </button>
              <button
                className="real-button"
                onClick={() => replace(createRealProject())}
              >
                {t(
                  "新建并替换本机工作区",
                  "Create and replace local workspace",
                )}
              </button>
              <button className="real-button" onClick={onDemo}>
                {t("返回合成示例", "Return to synthetic demo")}
              </button>
            </div>
          </>
        ) : (
          <p role="status">
            {t("正在恢复真实图像项目…", "Restoring the real-image project…")}
          </p>
        )}
      </div>
    );

  return (
    <div className="real-workbench" lang={language === "zh" ? "zh-CN" : "en"}>
      <div className="real-topbar">
        <div className="real-brand">
          <Layers size={25} />
          Blot Workbench
        </div>
        <div className="real-actions">
          <span className={`real-save-status ${saveState}`} role="status">
            {saveState === "saved" ? <Check size={14} /> : <Save size={14} />}
            {saveState === "saved"
              ? t("已保存到本机", "Saved locally")
              : saveState === "saving"
                ? t("正在保存…", "Saving…")
                : t("保存失败", "Save failed")}
          </span>
          <button
            type="button"
            className="real-button subtle"
            disabled={!!busy}
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            aria-label={t("切换到英文", "Switch to Chinese")}
          >
            {language === "zh" ? "EN" : "中文"}
          </button>
          <a
            type="button"
            className="real-button subtle"
            href={languageUrl("#guide")}
            target="_blank"
            rel="noreferrer"
          >
            {t("使用教程", "User guide")}
          </a>
          <button
            type="button"
            className="real-button"
            disabled={!!busy || saveState === "saving"}
            onClick={onDemo}
          >
            <ArrowLeft size={14} />
            {t("合成示例", "Synthetic demo")}
          </button>
        </div>
      </div>
      <div className="real-workspace-links">
        <a href={languageUrl("./")}>{t("← 工作台首页", "← Workbench home")}</a>
        <a href={languageUrl("?mode=single")}>
          {t("单条带识别 →", "Single-strip analysis →")}
        </a>
        <SuiteNav />
      </div>
      <header className="real-header">
        <div>
          <span className="real-stage">
            <FlaskConical size={14} />
            {t(
              "实验功能 · 真实原图 · 本机计算",
              "EXPERIMENTAL · REAL ORIGINALS · LOCAL COMPUTATION",
            )}
          </span>
          <h1>
            {t("真实 Western blot 工作区", "Real Western blot workspace")}
          </h1>
          <p>
            {t(
              "批量整理原图，确认泳道与配对，检查自动候选后量化。原始文件保留；显示预览与定量像素分离，全部操作在本机完成。",
              "Organize originals, confirm lanes and pairing, and inspect proposed regions before quantifying. Original files are retained; display previews and measurement pixels stay separate. Processing stays on this device.",
            )}
          </p>
        </div>
      </header>
      <div className="real-workspace-banner" role="note">
        <strong>
          {project.exampleKind === "synthetic"
            ? t("合成示例工作区", "Synthetic example workspace")
            : t("本机个人工作区", "Personal workspace on this device")}
        </strong>
        <span>
          {project.exampleKind === "synthetic"
            ? t(
                "当前示例使用虚拟条带。网站示例与公开截图只使用合成数据。",
                "This example uses virtual bands. Website examples and public screenshots use synthetic data only.",
              )
            : t(
                "自己导入的图像和结果保存在本机，不会成为网站示例或公开展示。",
                "Imported images and results stay on this device and never become a public website example.",
              )}
        </span>
      </div>
      <div className="real-project-bar">
        <label className="real-project-name">
          {t("项目名称", "Project name")}
          <input
            aria-label={t("真实项目名称", "Real project name")}
            value={project.name}
            maxLength={200}
            disabled={!!busy}
            onChange={(event) => {
              if (event.target.value.trim())
                commit((previous) =>
                  updateRealProject(previous, { name: event.target.value }),
                );
            }}
          />
        </label>
        <div className="real-actions">
          <button
            type="button"
            className="real-button"
            disabled={!!busy}
            onClick={() => {
              setNewName("");
              setDialog({ kind: "new" });
            }}
          >
            <Plus size={15} />
            {t("新建项目", "New project")}
          </button>
          <button
            type="button"
            className="real-button"
            disabled={!!busy}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={15} />
            {t("打开项目", "Open project")}
          </button>
          <button
            type="button"
            className="real-button primary"
            disabled={!!busy}
            onClick={() => void archive()}
          >
            <FileArchive size={15} />
            {t("导出项目", "Export project")}
          </button>
        </div>
      </div>
      <input
        className="real-sr-only"
        type="file"
        accept=".realwb.zip,.zip"
        ref={projectInput}
        aria-label={t("导入真实项目包", "Import real project archive")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            void run(
              t("正在校验项目包…", "Validating project archive…"),
              async () =>
                setDialog({
                  kind: "import",
                  project: await importRealProject(file),
                }),
            );
        }}
      />
      {error && (
        <div className="real-error" role="alert">
          <ShieldCheck size={17} />
          <span>{localizeMessage(error, language)}</span>
          <button
            aria-label={t("关闭错误提示", "Dismiss error")}
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="real-notice" role="status">
          <Check size={17} />
          <span>{localizeMessage(notice, language)}</span>
          <button
            aria-label={t("关闭通知", "Dismiss notice")}
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="real-notice" role="status">
          <LoaderCircle size={17} />
          <span>{localizeMessage(busy, language)}</span>
          {visionAbort.current && (
            <button
              className="real-button"
              onClick={() => visionAbort.current?.abort()}
            >
              {t("取消视觉请求", "Cancel vision requests")}
            </button>
          )}
        </div>
      )}
      {analysisReport && (
        <div
          className="real-report"
          role="region"
          aria-label={t("一键分析报告", "One-click analysis report")}
        >
          <div className="real-report-head">
            <h3>{t("一键分析报告", "One-click analysis report")}</h3>
            <span className="real-method-badge">
              {t(
                `${analysisReport.summary.images} 图 · 就绪 ${analysisReport.summary.results.ready} · 草稿 ${analysisReport.summary.results.draft} · 阻断 ${analysisReport.summary.results.blocked} · 阻塞问题 ${analysisReport.summary.issues.blocker} · 警告 ${analysisReport.summary.issues.warning}`,
                `${analysisReport.summary.images} images · ready ${analysisReport.summary.results.ready} · draft ${analysisReport.summary.results.draft} · blocked ${analysisReport.summary.results.blocked} · blockers ${analysisReport.summary.issues.blocker} · warnings ${analysisReport.summary.issues.warning}`,
              )}
            </span>
            <div className="real-actions">
              <button
                className="real-button"
                onClick={() =>
                  saveBlob(
                    new Blob([JSON.stringify(analysisReport, null, 2)], {
                      type: "application/json;charset=utf-8",
                    }),
                    `${fileStem(project?.name ?? "blot-workbench")}-report.json`,
                  )
                }
              >
                <Download size={15} />
                {t("下载报告 JSON", "Download report JSON")}
              </button>
              <button
                className="real-button"
                onClick={() => setAnalysisReport(null)}
              >
                {t("关闭", "Close")}
              </button>
            </div>
          </div>
          {analysisReport.issues.length ? (
            <ul className="real-report-issues">
              {analysisReport.issues.map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className={`real-report-issue ${issue.severity}`}
                >
                  <span className="real-report-code">{issue.code}</span>
                  <span>{localizeMessage(issue.message, language)}</span>
                  {issue.imageName && (
                    <small>
                      {issue.imageName}
                      {issue.lane
                        ? ` · ${t("泳道", "lane")} ${issue.lane}`
                        : ""}
                    </small>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="real-muted">
              {t("未发现问题。", "No issues found.")}
            </p>
          )}
          {analysisReport.recommendations.length > 0 && (
            <div className="real-report-recs">
              <strong>
                {t(
                  "优化方向（按优先级）",
                  "Recommended next steps (by priority)",
                )}
              </strong>
              <ol>
                {[...analysisReport.recommendations]
                  .sort((a, b) => a.priority - b.priority)
                  .map((rec) => (
                    <li key={rec.code}>
                      <strong>
                        {language === "zh" ? rec.title.zh : rec.title.en}
                      </strong>
                      <p>{language === "zh" ? rec.detail.zh : rec.detail.en}</p>
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </div>
      )}
      <nav
        className="real-progress-nav"
        aria-label={t("分析步骤", "Analysis steps")}
      >
        {[
          t("原图与配对", "Originals & pairing"),
          t("泳道与实验设计", "Lanes & design"),
          t("区域与复核", "Regions & review"),
          t("结果与导出", "Results & export"),
          t("图版与原始数据", "Figure & source data"),
        ].map((label, index) => (
          <button
            key={index}
            type="button"
            onClick={() =>
              sections.current[index]?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          >
            <span>0{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      <section
        className="real-card"
        ref={(element) => {
          sections.current[0] = element;
        }}
        aria-labelledby="real-import-heading"
      >
        <div className="real-section-heading">
          <span className="real-step-number">01</span>
          <div>
            <h2 id="real-import-heading">
              {t(
                "导入原图，确认图像信息",
                "Import originals and confirm metadata",
              )}
            </h2>
            <p>
              {t(
                "文件名只提供候选标签。实验编号与膜编号决定配对；每组保留一个目标曝光和一个内参。",
                "Filenames supply suggestions only. Experiment and membrane IDs determine pairing; retain one target exposure and one reference per set.",
              )}
            </p>
          </div>
          <details className="real-step-help">
            <summary>{t("本步怎么做", "How to do this step")}</summary>
            <ol>
              <li>
                {t(
                  "把仪器导出的原始 TIFF/PNG 一次拖入或批量选择；原图字节原样保留，可下载项目文件保存。",
                  "Drag in or batch-select the original TIFF/PNG exports; original bytes are retained. Download a project file to keep your work.",
                )}
              </li>
              <li>
                {t(
                  "核对自动推断的蛋白名、目标/内参角色、实验与膜编号——文件名只是建议，错了直接改。",
                  "Check the inferred protein, target/reference role, experiment and membrane IDs — filenames are suggestions; edit anything that is wrong.",
                )}
              </li>
              <li>
                {t(
                  "项目自动保存在本浏览器；「导出项目」生成的项目包（含原图）才是可靠备份。",
                  "The project autosaves in this browser; the exported project package (with originals) is the only reliable backup.",
                )}
              </li>
            </ol>
          </details>
          <span className="real-count">
            {project.images.length} / 48 {t("张图", "images")}
          </span>
        </div>
        <div
          className={`real-dropzone ${dragging ? "dragging" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={t("批量导入 TIFF 或 PNG", "Batch import TIFF or PNG")}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !busy) {
              event.preventDefault();
              imageInput.current?.click();
            }
          }}
          onClick={() => {
            if (!busy) imageInput.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) importFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <Upload size={29} />
          <div>
            <strong>
              {t(
                "拖入全部 WB 原图，或点击多选",
                "Drop your WB originals, or select multiple files",
              )}
            </strong>
            <p>
              {t(
                "TIFF / PNG · 8 / 16 位 · 单文件 ≤ 64 MiB · 原图总量 ≤ 256 MiB · 全项目 ≤ 3200 万像素。格式不支持时会明确报错。",
                "TIFF / PNG · 8 / 16 bit · ≤ 64 MiB per file · ≤ 256 MiB total originals · ≤ 32 million pixels per project. Unsupported variants report an error.",
              )}
            </p>
          </div>
        </div>
        <div className="real-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="real-button small"
            disabled={!!busy}
            onClick={loadPixelExample}
          >
            <FlaskConical size={15} />
            {t(
              "载入合成像素验证示例",
              "Load synthetic pixel-validation example",
            )}
          </button>
          <span className="real-muted">
            {t(
              "使用原创合成图验证实际像素计算流程；不代表真实实验。",
              "Original synthetic images exercise actual pixel calculations; they are not real experiments.",
            )}
          </span>
        </div>
        <input
          className="real-sr-only"
          ref={imageInput}
          type="file"
          multiple
          accept=".tif,.tiff,.png"
          aria-label={t("选择 WB 原始图像", "Choose original WB images")}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) importFiles(files);
          }}
        />
        {project.images.length > 0 && (
          <div
            className="real-recognition-progress"
            data-testid="real-recognition-progress"
          >
            <div>
              <h3>
                {pendingImages.length === includedImages.length &&
                pendingImages.length > 0
                  ? t(
                      "原图已导入，尚未识别",
                      "Originals imported — recognition not started",
                    )
                  : t("条带识别进度", "Band recognition progress")}
              </h3>
              <p>
                {t(
                  `待识别 ${pendingImages.length} 张 · 已有候选 ${proposedImages.length} 张 · 未完成 ${failedImages.length} 张`,
                  `${pendingImages.length} awaiting recognition · ${proposedImages.length} with candidates · ${failedImages.length} incomplete`,
                )}
              </p>
              <p>
                {t(
                  `当前设置 ${project.laneLabels.length} 个泳道标签，其中 ${project.laneLabels.filter((label) => !isExcludedLane(label)).length} 个参与定量：`,
                  `${project.laneLabels.length} lane labels configured; ${project.laneLabels.filter((label) => !isExcludedLane(label)).length} included in quantification: `,
                )}
                <strong>{project.laneLabels.join(" · ")}</strong>
              </p>
              <p className="real-muted">
                {mappingUnapplied
                  ? t(
                      "泳道设置已修改但尚未应用。请先核对并确认，再识别。",
                      "Lane settings have unapplied changes. Review and confirm them before recognition.",
                    )
                  : t(
                      "先确认泳道数量与图片一致，再识别。识别后检查取样框；归一化还需要目标/内参配对。",
                      "Check that the lane count matches your images, then recognize bands. Review the boxes afterward; normalization also requires target/reference pairing.",
                    )}
              </p>
            </div>
            <div className="real-actions">
              <button
                className="real-button"
                onClick={() =>
                  sections.current[1]?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                {t("核对泳道设置", "Review lane settings")}
              </button>
              <button
                className="real-button primary"
                disabled={!!busy || !includedImages.length || mappingUnapplied}
                onClick={() => recognizeImages()}
              >
                <ScanLine size={15} />
                {t("识别并查看条带", "Recognize & view bands")}
              </button>
              <a className="real-button" href={languageUrl("?mode=single")}>
                {t(
                  "只分析一排？用单条带识别",
                  "Just one row? Use single-strip recognition",
                )}
              </a>
            </div>
            {failedImages.length > 0 && (
              <ul className="real-recognition-failures">
                {failedImages.map((entry) => (
                  <li key={entry.id}>
                    <button
                      className="real-file-name"
                      onClick={() => showRegions(entry.id)}
                    >
                      {entry.name}
                    </button>
                    <span>
                      {localizeMessage(entry.analysisError, language)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {project.images.length > 0 && (
          <div className="real-table-scroll">
            <table className="real-mapping-table">
              <thead>
                <tr>
                  {[
                    t("文件 / 像素", "File / pixels"),
                    t("蛋白", "Protein"),
                    t("角色", "Role"),
                    project.pairedDesign
                      ? t("样本组编号", "Source group ID")
                      : t("实验编号", "Experiment ID"),
                    t("膜编号", "Membrane ID"),
                    t("曝光 / 条件", "Exposure / condition"),
                    t("排除", "Exclude"),
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {project.images.map((entry) => {
                  const size = imageRaster(entry);
                  return (
                    <tr
                      key={entry.id}
                      className={entry.id === image?.id ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="real-file-name"
                          onClick={() => {
                            setSelectedId(entry.id);
                            sections.current[2]?.scrollIntoView({
                              behavior: "smooth",
                            });
                          }}
                        >
                          {entry.name}
                        </button>
                        <small>
                          {size.width} × {size.height} · {size.bitDepth}-bit{" "}
                          {size.format} · SHA {entry.hash.slice(0, 8)}
                        </small>
                      </td>
                      <td>
                        <input
                          aria-label={`${entry.name} ${t("蛋白", "protein")}`}
                          value={entry.protein}
                          maxLength={200}
                          disabled={!!busy}
                          onChange={(event) => {
                            if (event.target.value.trim())
                              patchImage(entry.id, {
                                protein: event.target.value,
                              });
                          }}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`${entry.name} ${t("角色", "role")}`}
                          value={entry.role}
                          disabled={!!busy}
                          onChange={(event) =>
                            patchImage(entry.id, {
                              role: event.target.value as
                                "target" | "reference",
                            })
                          }
                        >
                          <option value="target">{t("目标", "Target")}</option>
                          <option value="reference">
                            {t("内参", "Reference")}
                          </option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`${entry.name} ${project.pairedDesign ? t("样本组编号", "source group ID") : t("实验编号", "experiment ID")}`}
                          value={entry.replicate}
                          maxLength={200}
                          disabled={!!busy}
                          onChange={(event) =>
                            patchImage(entry.id, {
                              replicate: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${entry.name} ${t("膜编号", "membrane ID")}`}
                          value={entry.membrane}
                          maxLength={200}
                          disabled={!!busy}
                          onChange={(event) =>
                            patchImage(entry.id, {
                              membrane: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${entry.name} ${t("曝光", "exposure")}`}
                          value={entry.exposure}
                          maxLength={200}
                          placeholder={t(
                            "如 1s，未知则留空",
                            "e.g. 1s; blank if unknown",
                          )}
                          disabled={!!busy}
                          onChange={(event) =>
                            patchImage(entry.id, {
                              exposure: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${t("排除", "Exclude")} ${entry.name}`}
                          checked={entry.excluded}
                          disabled={!!busy}
                          onChange={(event) =>
                            patchImage(entry.id, {
                              excluded: event.target.checked,
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="real-card"
        ref={(element) => {
          sections.current[1] = element;
        }}
        aria-labelledby="real-lanes-heading"
      >
        <div className="real-section-heading">
          <span className="real-step-number">02</span>
          <div>
            <h2 id="real-lanes-heading">
              {t(
                "说明泳道，先预览再应用",
                "Describe lanes, preview, then apply",
              )}
            </h2>
            <p>
              {t(
                "同一映射应用到本项目所有图像。请先确认每张图的泳道顺序一致。",
                "One mapping applies to every image in this project. Confirm that all images use the same lane order.",
              )}
            </p>
          </div>
          <details className="real-step-help">
            <summary>{t("本步怎么做", "How to do this step")}</summary>
            <ol>
              <li>
                {t(
                  "用一句话从左到右描述泳道，如「1=NC; 2=Drug; 3=marker」；先「解析预览」核对，再「全部确认应用」。",
                  'Describe the lanes left to right in one line, e.g. "1=NC; 2=Drug; 3=marker". Parse & preview first, then apply to all.',
                )}
              </li>
              <li>
                {t(
                  "marker/ladder 泳道自动排除，不计入 n；排除不可逆删除数据，只是不参与统计。",
                  "Marker/ladder lanes are excluded from n; exclusion never deletes data, it only removes lanes from statistics.",
                )}
              </li>
              <li>
                {t(
                  "选比较设计：共享泳道的独立实验，或个体 N/T 配对表。确认独立性后才能启用配对 t 检验。",
                  "Pick the design: independent experiments sharing lanes, or an individual N/T pair table. Paired t-tests unlock only after independence is confirmed.",
                )}
              </li>
            </ol>
          </details>
        </div>
        <div className="real-design-select">
          <label className="real-field">
            {t("比较设计", "Comparison design")}
            <select
              aria-label={t("比较设计", "Comparison design")}
              value={designMode}
              disabled={!!busy}
              onChange={(event) => {
                const nextMode = event.target.value as "shared" | "paired";
                setDesignMode(nextMode);
                if (nextMode === "shared" && project.pairedDesign)
                  setLaneDraft("NC, Treatment, marker");
                setLanePreview(null);
                setPairPreview(null);
              }}
            >
              <option value="shared">
                {t("每次实验共用 NC 对照", "Shared NC control per experiment")}
              </option>
              <option value="paired">
                {t("每位个体 N/T 配对", "Paired N/T per individual")}
              </option>
            </select>
          </label>
          <p className="real-muted">
            {t(
              "先选择设计并确认应用。日期、文件尾号和泳道数量不决定独立样本数。",
              "Select a design, then confirm it. Dates, filename suffixes, and lane counts do not establish independence.",
            )}
          </p>
        </div>
        {designMode === "shared" ? (
          <div className="real-lane-form">
            <div>
              <label className="real-field">
                {t("泳道说明（从左到右）", "Lane description (left to right)")}
                <textarea
                  aria-label={t("泳道说明", "Lane description")}
                  value={laneDraft}
                  maxLength={4000}
                  disabled={!!busy}
                  onChange={(event) => {
                    setLaneDraft(event.target.value);
                    setLanePreview(null);
                  }}
                  placeholder={t(
                    "例如：1=NC; 2=Treatment; 3=marker",
                    "For example: 1=NC; 2=Treatment; 3=marker",
                  )}
                />
              </label>
              <p className="real-muted">
                {t(
                  "支持简单编号说明或逗号列表：NC, Treatment, marker。marker / ladder 和以 ! 开头的泳道不参与计算；复杂说明请先改写为明确编号。",
                  "Use simple numbered descriptions or a comma list: NC, Treatment, marker. Marker / ladder and labels starting with ! are excluded. Rewrite complex descriptions as explicit assignments.",
                )}
              </p>
              <div className="real-actions" style={{ marginTop: 12 }}>
                <button
                  className="real-button"
                  disabled={!!busy || !laneDraft.trim()}
                  onClick={() => {
                    try {
                      setLanePreview(
                        applyLaneDescription(
                          project.pairedDesign
                            ? applyPairedDesign(project, null)
                            : project,
                          laneDraft,
                        ).laneLabels,
                      );
                      setError("");
                    } catch (problem) {
                      setError(
                        problem instanceof Error
                          ? problem.message
                          : String(problem),
                      );
                    }
                  }}
                >
                  {t("解析并预览", "Parse & preview")}
                </button>
                <button
                  className="real-button primary"
                  disabled={!!busy || !lanePreview}
                  onClick={() => {
                    try {
                      const current = currentProject.current ?? project;
                      const next = applyLaneDescription(
                        current.pairedDesign
                          ? applyPairedDesign(current, null)
                          : current,
                        laneDraft,
                      );
                      accept(next);
                      setLaneDraft(next.laneDescription);
                      setLanePreview(null);
                      setError("");
                      setNotice(
                        t(
                          "泳道映射已应用。请重新检查所有图像区域与配对。",
                          "Lane mapping applied. Review regions and pairing for all images.",
                        ),
                      );
                    } catch (problem) {
                      setError(
                        problem instanceof Error
                          ? problem.message
                          : String(problem),
                      );
                    }
                  }}
                >
                  {t("确认应用到全部图像", "Confirm for all images")}
                </button>
              </div>
            </div>
            <div className="real-lane-preview">
              <h3>
                {lanePreview
                  ? t("待确认映射", "Mapping awaiting confirmation")
                  : t("当前已应用映射", "Current applied mapping")}
              </h3>
              <ol>
                {(lanePreview ?? project.laneLabels).map((label, index) => (
                  <li key={index}>
                    <small>
                      {t("泳道", "Lane")} {index + 1}
                    </small>
                    <strong>{label}</strong>
                    <small>
                      {isExcludedLane(label)
                        ? t("不参与定量", "Excluded")
                        : isControlLane(label)
                          ? normalizationPolicy?.kind === "reference-unit"
                            ? t(
                                "对照（共同基准归一化）",
                                "Control (common baseline)",
                              )
                            : t("配对对照 = 1", "Matched control = 1")
                          : t("待比较条件", "Compared condition")}
                    </small>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <div className="real-lane-form real-pair-form">
            <div>
              <label className="real-field">
                {t(
                  "N/T 配对表（每行一位个体）",
                  "N/T pairing table (one individual per row)",
                )}
                <textarea
                  aria-label={t("N/T 配对表", "N/T pairing table")}
                  value={pairDraft}
                  maxLength={32000}
                  disabled={!!busy}
                  onChange={(event) => {
                    setPairDraft(event.target.value);
                    setPairPreview(null);
                  }}
                  placeholder={
                    "group-1, individual-1, 1, 2\ngroup-1, individual-2, 3, 4\ngroup-2, individual-3, 1, 2"
                  }
                />
              </label>
              <p className="real-muted">
                {t(
                  "格式：样本组编号, 个体编号, N 泳道, T 泳道。样本组须与上表的编号一致。相同个体跨组重复测量时沿用同一编号；目前重复测量会提示歧义，不自动增加 n。",
                  "Format: source group ID, individual ID, N lane, T lane. Group IDs must match the image table. Reuse an individual's ID across repeated measurements; repeated measurements are flagged as ambiguous and do not increase n.",
                )}
              </p>
              <div className="real-actions" style={{ marginTop: 12 }}>
                <button
                  className="real-button"
                  disabled={!!busy || !pairDraft.trim()}
                  onClick={() => {
                    try {
                      const pairs = parsePairDescription(pairDraft, t);
                      applyPairedDesign(project, pairs);
                      setPairPreview(pairs);
                      setError("");
                    } catch (problem) {
                      setError(
                        problem instanceof Error
                          ? problem.message
                          : String(problem),
                      );
                    }
                  }}
                >
                  {t("预览 N/T 配对", "Preview N/T pairs")}
                </button>
                <button
                  className="real-button primary"
                  disabled={!!busy || !pairPreview}
                  onClick={() => {
                    try {
                      const next = applyPairedDesign(
                        currentProject.current ?? project,
                        parsePairDescription(pairDraft, t),
                      );
                      accept(next);
                      setPairDraft(
                        pairDescription(next.pairedDesign?.pairs ?? []),
                      );
                      setLaneDraft(next.laneDescription);
                      setLanePreview(null);
                      setPairPreview(null);
                      setError("");
                      setNotice(
                        t(
                          "N/T 配对已应用。请核对同膜内参和个体独立性，再逐图复核区域。",
                          "N/T pairs applied. Check same-membrane references, individual independence, and regions in each image.",
                        ),
                      );
                    } catch (problem) {
                      setError(
                        problem instanceof Error
                          ? problem.message
                          : String(problem),
                      );
                    }
                  }}
                >
                  {t("确认应用 N/T 配对", "Confirm N/T pairs")}
                </button>
              </div>
            </div>
            <div className="real-lane-preview">
              <h3>
                {pairPreview
                  ? t("待确认配对", "Pairs awaiting confirmation")
                  : t("当前已应用配对", "Current applied pairs")}
              </h3>
              {(pairPreview ?? project.pairedDesign?.pairs ?? []).length ? (
                <>
                  <p className="real-muted">
                    {t("个体编号去重计数", "Distinct individual IDs")}:{" "}
                    {
                      unique(
                        (pairPreview ?? project.pairedDesign?.pairs ?? []).map(
                          (pair) => pair.unitId,
                        ),
                      ).length
                    }
                    {pairPreview || !project.designConfirmed
                      ? t(
                          "（确认设计前不视为独立样本）",
                          " (not confirmed independent yet)",
                        )
                      : t(
                          "（独立性由用户确认）",
                          " (independence confirmed by the user)",
                        )}
                  </p>
                  <div className="real-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("样本组", "Group")}</th>
                          <th>{t("个体", "Individual")}</th>
                          <th>N</th>
                          <th>T</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(pairPreview ?? project.pairedDesign?.pairs ?? []).map(
                          (pair, index) => (
                            <tr key={index}>
                              <td>{pair.groupId}</td>
                              <td>{pair.unitId}</td>
                              <td>{pair.normalLane}</td>
                              <td>{pair.tumorLane}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="real-muted">
                  {t(
                    "填写并预览配对；未列出的泳道不参与配对统计。",
                    "Enter and preview pairs. Lanes not listed are excluded from paired statistics.",
                  )}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="real-design-box">
          <div className="real-actions">
            <label className="real-field">
              {t("内参蛋白名称", "Reference protein name")}
              <input
                aria-label={t("项目内参名称", "Project reference name")}
                value={project.referenceLabel}
                maxLength={200}
                disabled={!!busy}
                onChange={(event) => {
                  if (event.target.value.trim())
                    commit((previous) =>
                      updateRealProject(previous, {
                        referenceLabel: event.target.value,
                      }),
                    );
                }}
              />
            </label>
            <p className="real-muted">
              {t(
                "Reference 表示仅按明确的内参角色配对；填写具体蛋白名时，必须与上表一致。",
                "Reference pairs by the explicit reference role. A specific protein name must match the image table.",
              )}
            </p>
          </div>
          <label className="real-checkbox">
            <input
              type="checkbox"
              checked={project.designConfirmed}
              disabled={
                !!busy ||
                designMode !== (project.pairedDesign ? "paired" : "shared") ||
                (designMode === "paired" &&
                  (pairPreview !== null ||
                    pairDraft !==
                      pairDescription(project.pairedDesign?.pairs ?? [])))
              }
              onChange={(event) =>
                commit((previous) =>
                  updateRealProject(previous, {
                    designConfirmed: event.target.checked,
                  }),
                )
              }
            />
            <span>
              {project.pairedDesign
                ? t(
                    "我已核对每位个体的 N/T 泳道、样本组及同膜内参，并确认不同个体编号代表不同的独立个体。",
                    "I have checked each individual's N/T lanes, source groups, and same-membrane references, and confirm that different individual IDs represent distinct independent individuals.",
                  )
                : t(
                    "我已核对泳道映射、同编号同膜配对，并确认不同实验编号代表独立实验。",
                    "I have checked lane assignments and experiment/membrane pairing, and confirm that different experiment IDs represent independent experiments.",
                  )}
              <small>
                {t(
                  "未确认时 n 仅表示配对组数。确认不能消除像素截断、背景或成像线性问题。",
                  "Until confirmed, n counts paired sets only. Confirmation does not resolve clipping, background, or acquisition-linearity problems.",
                )}
              </small>
            </span>
          </label>
        </div>
      </section>

      <section
        className="real-card"
        ref={(element) => {
          sections.current[2] = element;
        }}
        aria-labelledby="real-regions-heading"
      >
        <div className="real-section-heading">
          <span className="real-step-number">03</span>
          <div>
            <h2 id="real-regions-heading">
              {t(
                "建议候选，检查区域并量化",
                "Propose, inspect, and quantify regions",
              )}
            </h2>
            <p>
              {t(
                "算法只给出候选；逐图核对条带与局部背景。手动修改保留版本，并取消原有复核。",
                "The algorithm proposes candidates. Check bands and local backgrounds in each image. Manual edits preserve revisions and reset the previous review.",
              )}
            </p>
          </div>
          <details className="real-step-help">
            <summary>{t("本步怎么做", "How to do this step")}</summary>
            <ol>
              <li>
                {t(
                  "「全部建议并计算」用本机算法提出条带与背景候选，不需要任何 API Key。",
                  '"Propose & calculate all" drafts band/background candidates with the local algorithm — no API key needed.',
                )}
              </li>
              <li>
                {t(
                  "「视觉 API 候选（可选）」把缩小预览发给你自己的视觉模型服务（先在「视觉服务（自带 API）」里填地址、模型与密钥）；返回的框全部标记待复核。",
                  '"Vision API candidates (optional)" sends a downscaled preview to your own vision provider (configure it in the vision panel first); returned boxes are always flagged for review.',
                )}
              </li>
              <li>
                {t(
                  "逐图检查：拖动/缩放条带与背景框，双击背景区可增删；复核后旧候选警告会消失。",
                  "Review per image: drag/scale the band and background boxes; mark reviewed once satisfied.",
                )}
              </li>
              <li>
                {t(
                  "背景方法二选一：局部背景取样框（默认），或 rolling ball（与 ImageJ 一致，半径可调，不需背景框）。切换会使复核失效。",
                  "Pick a background method: local background ROIs (default) or the ImageJ-compatible rolling ball (adjustable radius, no ROIs needed). Switching invalidates review states.",
                )}
              </li>
            </ol>
          </details>
          <button
            className="real-button primary"
            disabled={!!busy || !includedImages.length || mappingUnapplied}
            onClick={() => recognizeImages()}
          >
            <ScanLine size={16} />
            {t("全部建议并计算", "Propose & calculate all")}
          </button>
          <button
            className="real-button"
            disabled={
              !!busy ||
              !project.images.length ||
              designMode !== (project.pairedDesign ? "paired" : "shared") ||
              lanePreview !== null ||
              laneDraft !== project.laneDescription
            }
            onClick={() =>
              void run(
                t("正在获取视觉候选…", "Requesting vision candidates…"),
                () => proposeVisionRegions("all"),
              )
            }
          >
            <ScanLine size={16} />
            {t("视觉 API 候选（可选）", "Vision API candidates (optional)")}
          </button>
          <button
            className="real-button"
            disabled={!!busy || !includedImages.length || mappingUnapplied}
            onClick={() => recognizeImages(true)}
          >
            <ShieldCheck size={16} />
            {t("一键分析并体检", "Run all & report")}
          </button>
          <button
            className="real-button"
            disabled={!!busy}
            aria-expanded={byokPanelOpen}
            onClick={() => {
              setByokPanelOpen((open) => !open);
              setByokReady(loadByokConfig() !== null);
            }}
          >
            {t("视觉服务（自带 API）", "Vision service (your own API)")}
            {byokReady ? " ✓" : ""}
          </button>
        </div>
        {byokPanelOpen && (
          <div
            className="real-normalization-box"
            aria-label={t(
              "视觉服务设置（自带 API）",
              "Vision service settings (BYOK)",
            )}
          >
            <div className="real-actions">
              <label className="real-field">
                {t("服务商", "Provider")}
                <select
                  value={
                    KNOWN_PROVIDERS.some(
                      (provider) => provider.baseUrl === byokDraft.baseUrl,
                    )
                      ? byokDraft.baseUrl
                      : ""
                  }
                  onChange={(event) => {
                    if (event.target.value)
                      setByokDraft((draft) => ({
                        ...draft,
                        baseUrl: event.target.value,
                      }));
                  }}
                >
                  <option value="">{t("自定义…", "Custom…")}</option>
                  {KNOWN_PROVIDERS.map((provider) => (
                    <option key={provider.baseUrl} value={provider.baseUrl}>
                      {translateMessage(provider.label, language)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="real-field">
                {t("服务地址", "Base URL")}
                <input
                  type="text"
                  value={byokDraft.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) =>
                    setByokDraft((draft) => ({
                      ...draft,
                      baseUrl: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="real-field">
                {t("模型（须支持图像）", "Model (must accept images)")}
                <input
                  type="text"
                  value={byokDraft.model}
                  onChange={(event) =>
                    setByokDraft((draft) => ({
                      ...draft,
                      model: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="real-field">
                {t("API Key", "API key")}
                <input
                  type="password"
                  value={byokDraft.apiKey}
                  autoComplete="off"
                  onChange={(event) =>
                    setByokDraft((draft) => ({
                      ...draft,
                      apiKey: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="real-checkbox">
              <input
                type="checkbox"
                checked={byokDraft.remember}
                onChange={(event) =>
                  setByokDraft((draft) => ({
                    ...draft,
                    remember: event.target.checked,
                  }))
                }
              />
              <span>
                {t(
                  "在此设备记住（明文保存在浏览器 localStorage，可随时清除）",
                  "Remember on this device (plaintext in browser localStorage, clearable anytime)",
                )}
              </span>
            </label>
            <div className="real-actions">
              <button
                className="real-button primary"
                disabled={!!busy}
                onClick={() =>
                  void run(
                    t("正在保存视觉服务配置…", "Saving vision config…"),
                    () => {
                      const saved = saveByokConfig(
                        {
                          baseUrl: byokDraft.baseUrl,
                          model: byokDraft.model,
                          apiKey: byokDraft.apiKey,
                        },
                        byokDraft.remember,
                      );
                      setByokReady(true);
                      setByokDraft((draft) => ({
                        ...draft,
                        baseUrl: saved.baseUrl,
                      }));
                      setByokNotice(
                        t(
                          "已保存" +
                            (byokDraft.remember
                              ? "并记住此设备"
                              : "（仅本次页面）") +
                            "。",
                          "Saved" +
                            (byokDraft.remember
                              ? " and remembered on this device"
                              : " for this page only") +
                            ".",
                        ),
                      );
                    },
                  )
                }
              >
                {t("保存并使用", "Save & use")}
              </button>
              <button
                className="real-button"
                disabled={!!busy}
                onClick={() =>
                  void run(t("正在清除…", "Clearing…"), () => {
                    clearByokConfig();
                    setByokDraft({
                      baseUrl: "",
                      model: "",
                      apiKey: "",
                      remember: false,
                    });
                    setByokReady(false);
                    setByokNotice(
                      t(
                        "已清除本机保存的视觉服务配置。",
                        "Cleared the locally saved vision config.",
                      ),
                    );
                  })
                }
              >
                {t("清除已保存", "Clear saved")}
              </button>
              <button
                className="real-button"
                disabled={
                  !!busy ||
                  !byokDraft.baseUrl ||
                  !byokDraft.model ||
                  !byokDraft.apiKey
                }
                onClick={() =>
                  void run(
                    t(
                      "正在发送合成测试图…",
                      "Sending the synthetic test image…",
                    ),
                    async () => {
                      const result = await analyzeBandsByok(
                        {
                          baseUrl: byokDraft.baseUrl,
                          model: byokDraft.model,
                          apiKey: byokDraft.apiKey,
                        },
                        {
                          laneCount: 1,
                          laneLabels: [],
                          signal: "dark",
                          imageDataUrl: SYNTHETIC_TEST_PNG,
                        },
                        new AbortController().signal,
                      );
                      setByokNotice(
                        t(
                          `连接成功：返回 ${result.bands.length} 个候选框（合成图）。`,
                          `Connected: ${result.bands.length} candidate boxes returned (synthetic image).`,
                        ),
                      );
                    },
                  )
                }
              >
                {t("发送合成图测试", "Send synthetic test")}
              </button>
            </div>
            {byokNotice && (
              <p className="real-muted">
                {localizeMessage(byokNotice, language)}
              </p>
            )}
            <p className="real-muted">
              {t(
                "密钥默认仅保存在当前页面内存，刷新即清；勾选「记住」才写入本设备。测试按钮只发送一张内置合成小图，不发送项目图像；正式候选请求只发往你填写的服务地址，且候选仍需人工复核，像素测量始终在本机完成。",
                'The key stays in page memory by default and clears on refresh; it is written to this device only when "remember" is checked. The test sends one built-in synthetic image, never project data. Candidate requests go only to the address you entered, remain draft candidates for manual review, and pixel measurement always runs locally.',
              )}
            </p>
          </div>
        )}
        {!image || !raster ? (
          <div className="real-empty">
            <ScanLine size={30} />
            {t(
              "先导入原图，再确认泳道映射；或先载入内置合成示例，走一遍完整流程。",
              "Import originals and confirm the lane mapping first — or load the built-in synthetic example and walk through the whole flow.",
            )}
            <div>
              <button
                className="real-button"
                disabled={!!busy}
                onClick={loadPixelExample}
              >
                <FlaskConical size={15} />
                {t("载入内置示例", "Load the built-in example")}
              </button>
            </div>
            <small className="real-muted">
              {t(
                "示例为脚本合成的三组目标/内参图对（NC 与 Treatment），用于走通流程；载入后点「一键分析并体检」即可看到报告。",
                'The example is a script-generated set of three target/reference pairs (NC and Treatment) for walking through the flow. After loading, click "Run all & report" to see the report.',
              )}
            </small>
          </div>
        ) : (
          <>
            <div
              className="real-image-strip"
              aria-label={t("选择待检查图像", "Choose an image to review")}
            >
              {project.images.map((entry) => (
                <button
                  className={`real-image-tab ${entry.id === image.id ? "active" : ""}`}
                  key={entry.id}
                  onClick={() => {
                    setSelectedId(entry.id);
                    setSelectedRegion({ lane: 1, kind: "band" });
                  }}
                  aria-pressed={entry.id === image.id}
                >
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.excluded
                      ? t("已排除", "Excluded")
                      : entry.reviewed
                        ? t("已复核", "Reviewed")
                        : t("待复核", "Review needed")}{" "}
                    · r{entry.revision}
                  </span>
                </button>
              ))}
            </div>
            {image.analysisError && (
              <div className="real-recognition-error" role="alert">
                <strong>
                  {t(
                    "这张图尚未完成条带识别",
                    "Band recognition is incomplete for this image",
                  )}
                </strong>
                <p>{localizeMessage(image.analysisError, language)}</p>
                <p>
                  {t(
                    "核对泳道数量和深浅色模式后重试。多排图请先定位需要的条带行；也可创建并调整手动取样框。",
                    "Check the lane count and signal polarity, then retry. For multiple rows, first locate the row you need; you can also create and adjust manual regions.",
                  )}
                </p>
                <div className="real-actions">
                  <button
                    className="real-button"
                    onClick={() =>
                      sections.current[1]?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }
                  >
                    {t("核对泳道数量", "Check lane count")}
                  </button>
                  <button
                    className="real-button"
                    disabled={!!busy || image.excluded || mappingUnapplied}
                    onClick={() => recognizeImages()}
                  >
                    {t("重试识别", "Retry recognition")}
                  </button>
                  {!image.regions.length && (
                    <button
                      className="real-button"
                      disabled={!!busy || image.excluded}
                      onClick={manualGrid}
                    >
                      {t("手动放置取样框", "Place regions manually")}
                    </button>
                  )}
                  <a className="real-button" href={languageUrl("?mode=single")}>
                    {t("改用单条带识别", "Use single-strip recognition")}
                  </a>
                </div>
              </div>
            )}
            <div className="real-editor">
              <div>
                <div className="real-editor-toolbar">
                  <strong>{image.name}</strong>
                  <label className="real-field">
                    {t("信号方向", "Signal direction")}
                    <select
                      aria-label={t("信号方向", "Signal direction")}
                      value={image.signal}
                      disabled={!!busy}
                      onChange={(event) =>
                        patchImage(image.id, {
                          signal: event.target.value as "dark" | "light",
                        })
                      }
                    >
                      <option value="dark">
                        {t("暗条带 / 亮背景", "Dark bands / light background")}
                      </option>
                      <option value="light">
                        {t("亮条带 / 暗背景", "Light bands / dark background")}
                      </option>
                    </select>
                  </label>
                </div>
                <div className="real-canvas-wrap">
                  <svg
                    ref={canvasRef}
                    className="real-canvas"
                    viewBox={`0 0 ${raster.width} ${raster.height}`}
                    role="group"
                    aria-label={t(
                      "原图预览与条带背景区域",
                      "Original preview with band and background regions",
                    )}
                    onPointerMove={moveDrag}
                    onPointerUp={(event) => finishDrag(event)}
                    onPointerCancel={(event) => finishDrag(event, true)}
                  >
                    {previewUrl && (
                      <image
                        href={previewUrl}
                        x="0"
                        y="0"
                        width={raster.width}
                        height={raster.height}
                        pointerEvents="none"
                      />
                    )}
                    {image.regions.flatMap((entry) =>
                      (["band", "background"] as const).map((kind) => {
                        const selected =
                          entry.lane === region?.lane &&
                          kind === selectedRegion.kind;
                        const rect =
                          selected && dragRect ? dragRect : entry[kind];
                        const handle = Math.max(3, raster.width / 110);
                        return (
                          <g key={`${entry.lane}-${kind}`}>
                            <rect
                              {...rect}
                              className={`real-${kind} ${selected ? "selected" : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label={`${t("泳道", "Lane")} ${entry.lane} ${kind === "band" ? t("条带", "band") : t("背景", "background")}`}
                              onPointerDown={(event) =>
                                beginDrag(event, entry, kind)
                              }
                              onFocus={() =>
                                setSelectedRegion({ lane: entry.lane, kind })
                              }
                              onKeyDown={(event) => {
                                if (
                                  !busy &&
                                  [
                                    "ArrowLeft",
                                    "ArrowRight",
                                    "ArrowUp",
                                    "ArrowDown",
                                  ].includes(event.key)
                                ) {
                                  event.preventDefault();
                                  const step = event.shiftKey ? 10 : 1;
                                  setSelectedRegion({ lane: entry.lane, kind });
                                  changeRect(
                                    {
                                      ...entry[kind],
                                      x:
                                        entry[kind].x +
                                        (event.key === "ArrowLeft"
                                          ? -step
                                          : event.key === "ArrowRight"
                                            ? step
                                            : 0),
                                      y:
                                        entry[kind].y +
                                        (event.key === "ArrowUp"
                                          ? -step
                                          : event.key === "ArrowDown"
                                            ? step
                                            : 0),
                                    },
                                    image.id,
                                    entry.lane,
                                    kind,
                                  );
                                }
                              }}
                            />
                            {selected && (
                              <rect
                                x={rect.x + rect.width - handle / 2}
                                y={rect.y + rect.height - handle / 2}
                                width={handle}
                                height={handle}
                                className="real-resize"
                                aria-label={t(
                                  "拖动调整区域大小",
                                  "Drag to resize region",
                                )}
                                onPointerDown={(event) =>
                                  beginDrag(event, entry, kind, true)
                                }
                              />
                            )}
                          </g>
                        );
                      }),
                    )}
                  </svg>
                </div>
                <div className="real-canvas-note">
                  <span>
                    <i />
                    {t("条带", "Band")}
                  </span>
                  <span>
                    <i className="background" />
                    {t("局部背景", "Local background")}
                  </span>
                  <span>
                    {t(
                      "拖动移动；右下角缩放；方向键微调；坐标以原始像素计。",
                      "Drag to move; resize at the lower-right corner; nudge with arrow keys. Coordinates use original pixels.",
                    )}
                  </span>
                </div>
                <p className="real-muted">
                  {t(
                    "预览已映射为屏幕显示；定量读取解码后的原始位深像素，不读取此预览。",
                    "The preview is mapped for display. Measurements use decoded original-bit-depth pixels, not this preview.",
                  )}
                </p>
                {imageWarnings.length > 0 && (
                  <div className="real-warning">
                    <ShieldCheck size={17} />
                    <div>
                      <strong>
                        {t(
                          "质量提示将保留在结果中",
                          "Quality warnings remain in results",
                        )}
                      </strong>
                      <ul className="real-warning-list">
                        {imageWarnings.map((warning) => (
                          <li key={warning}>
                            {localizeMessage(warning, language)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {imageMeasurements.length > 0 && (
                  <div className="real-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {[
                            t("泳道", "Lane"),
                            t("面积", "Area"),
                            t("条带积分", "Band sum"),
                            t("背景均值", "Background mean"),
                            t("净信号", "Net signal"),
                            t("截断像素", "Clipped pixels"),
                          ].map((label) => (
                            <th key={label}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {imageMeasurements.map((entry) => (
                          <tr key={entry.region.lane}>
                            <td>
                              {entry.region.lane} ·{" "}
                              {project.laneLabels[entry.region.lane - 1]}
                              {isExcludedLane(
                                project.laneLabels[entry.region.lane - 1] ?? "",
                              ) && (
                                <small>
                                  {t(
                                    "不参与归一化",
                                    "Excluded from normalization",
                                  )}
                                </small>
                              )}
                            </td>
                            <td>{numberText(entry.value?.area ?? null, 0)}</td>
                            <td>{numberText(entry.value?.bandSum ?? null)}</td>
                            <td>
                              {numberText(entry.value?.backgroundMean ?? null)}
                            </td>
                            <td>{numberText(entry.value?.net ?? null)}</td>
                            <td>
                              {entry.value
                                ? `${numberText(entry.value.clippedFraction * 100, 2)}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <aside className="real-inspector">
                <h3>{t("手动调整区域", "Adjust regions manually")}</h3>
                {region && activeRect ? (
                  <>
                    <label className="real-field">
                      {t("泳道", "Lane")}
                      <select
                        aria-label={t("当前区域泳道", "Selected region lane")}
                        value={region.lane}
                        onChange={(event) =>
                          setSelectedRegion({
                            ...selectedRegion,
                            lane: Number(event.target.value),
                          })
                        }
                      >
                        {image.regions.map((entry) => (
                          <option key={entry.lane} value={entry.lane}>
                            {entry.lane} · {project.laneLabels[entry.lane - 1]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="real-field">
                      {t("区域类型", "Region type")}
                      <select
                        aria-label={t("区域类型", "Region type")}
                        value={selectedRegion.kind}
                        onChange={(event) =>
                          setSelectedRegion({
                            lane: region.lane,
                            kind: event.target.value as RegionKind,
                          })
                        }
                      >
                        <option value="band">
                          {t("条带区域", "Band region")}
                        </option>
                        <option value="background">
                          {t("背景区域", "Background region")}
                        </option>
                      </select>
                    </label>
                    <div className="real-roi-fields">
                      {(["x", "y", "width", "height"] as const).map((key) => (
                        <label className="real-field" key={key}>
                          {key === "width"
                            ? t("宽度", "Width")
                            : key === "height"
                              ? t("高度", "Height")
                              : key.toUpperCase()}
                          <input
                            type="number"
                            step="1"
                            aria-label={`ROI ${key}`}
                            value={activeRect[key]}
                            min={key === "width" || key === "height" ? 1 : 0}
                            max={
                              key === "x" || key === "width"
                                ? raster.width
                                : raster.height
                            }
                            disabled={!!busy}
                            onChange={(event) => {
                              const value = event.target.valueAsNumber;
                              if (Number.isFinite(value))
                                changeRect({ ...activeRect, [key]: value });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <p className="real-muted">
                      {region.source === "manual"
                        ? t(
                            "手动区域 · 批量建议时保留",
                            "Manual region · retained by batch suggestions",
                          )
                        : t(
                            "自动候选 · 需要人工检查",
                            "Automatic candidate · requires review",
                          )}
                    </p>
                  </>
                ) : (
                  <p className="real-muted">
                    {t(
                      "尚无区域。可先自动建议，或创建手动网格。",
                      "No regions yet. Propose candidates or create a manual grid.",
                    )}
                  </p>
                )}
                <button
                  className="real-button"
                  disabled={!!busy || image.excluded}
                  onClick={() => {
                    if (image.regions.length)
                      setDialog({ kind: "regions", imageId: image.id });
                    else
                      void run(
                        t(
                          "正在建议当前图像区域…",
                          "Proposing regions for this image…",
                        ),
                        () =>
                          patchImage(image.id, {
                            regions: proposeRegions(
                              raster,
                              requiredLaneCount(project, image),
                              image.signal,
                            ),
                          }),
                      );
                  }}
                >
                  <ScanLine size={15} />
                  {t("重新建议当前图像", "Propose for this image")}
                </button>
                {!image.regions.length && (
                  <button
                    className="real-button"
                    disabled={!!busy}
                    onClick={manualGrid}
                  >
                    {t("创建手动网格", "Create manual grid")}
                  </button>
                )}
                <button
                  className="real-button"
                  disabled={!!busy || !image.regions.length}
                  onClick={() => {
                    setCalculationVersion((value) => value + 1);
                    setNotice(
                      t(
                        "按当前区域重新计算原始像素。请复核质量提示。",
                        "Recalculated original pixels in the current regions. Review the quality warnings.",
                      ),
                    );
                  }}
                >
                  {t("按当前区域重算", "Recalculate current regions")}
                </button>
                <button
                  className="real-button"
                  disabled={!!busy || image.excluded}
                  onClick={() =>
                    void run(
                      t("正在获取视觉候选…", "Requesting vision candidates…"),
                      () => proposeVisionRegions(image),
                    )
                  }
                >
                  {t(
                    "视觉 API 候选（此图，可选）",
                    "Vision API candidates (this image, optional)",
                  )}
                </button>
                <hr />
                <label className="real-field">
                  {t("复核备注", "Review notes")}
                  <textarea
                    aria-label={t(
                      "真实图像复核备注",
                      "Real image review notes",
                    )}
                    value={image.note}
                    maxLength={10000}
                    disabled={!!busy}
                    onChange={(event) =>
                      patchImage(image.id, { note: event.target.value })
                    }
                  />
                </label>
                <label className="real-checkbox">
                  <input
                    type="checkbox"
                    checked={image.reviewed}
                    disabled={!!busy || !image.regions.length || image.excluded}
                    onChange={(event) =>
                      patchImage(image.id, { reviewed: event.target.checked })
                    }
                  />
                  <span>
                    {t(
                      "已人工检查此图的区域与信息",
                      "I reviewed this image's regions and metadata",
                    )}
                  </span>
                </label>
                <p className="real-muted">
                  {t(
                    "目标与配对内参都需要复核；质量提示不会被此勾选清除。",
                    "Review both the target and its reference. This checkbox does not clear quality warnings.",
                  )}
                </p>
              </aside>
            </div>
          </>
        )}
      </section>

      <section
        className="real-card"
        ref={(element) => {
          sections.current[3] = element;
        }}
        aria-labelledby="real-results-heading"
      >
        <div className="real-section-heading">
          <span className="real-step-number">04</span>
          <div>
            <h2 id="real-results-heading">
              {t(
                "配对结果与可追溯导出",
                "Paired results and traceable exports",
              )}
            </h2>
            <p>
              {t(
                "每个泳道先扣局部背景，再除以内参，最后使用下方明确选择的归一化基准。默认展示描述统计；需明确选择才执行配对检验。",
                "Subtract local background, divide by the reference, then use the normalization baseline explicitly selected below. Descriptive summaries are shown by default; paired inference requires an explicit selection.",
              )}
            </p>
          </div>
          <details className="real-step-help">
            <summary>{t("本步怎么做", "How to do this step")}</summary>
            <ol>
              <li>
                {t(
                  "选归一化基准：共同基准（指定一个对照 = 1，其他对照保留真实变异）或各自配对对照。绘图基准不改变检验输入。",
                  "Pick a normalization baseline: a common baseline (one control = 1, other controls keep their variation) or each matched control. Plot baselines never change test inputs.",
                )}
              </li>
              <li>
                {t(
                  "需要 P 值时勾选双侧配对 t 检验：确认独立性、恰好两个条件、至少两对有效配对。",
                  "For P values, enable the two-sided paired t-test: confirm independence, exactly two conditions, at least two valid pairs.",
                )}
              </li>
              <li>
                {t(
                  "「一键分析并体检」汇总所有阻断项、警告与按优先级的优化建议，可下载报告 JSON。",
                  '"Run all & report" aggregates blockers, warnings, and prioritized recommendations; download the report as JSON.',
                )}
              </li>
              <li>
                {t(
                  "导出：CSV（含全部审计列）、统计 CSV、SVG/PNG/TIFF 图形、组合图版与项目包。",
                  "Export: CSV (full audit columns), statistics CSV, SVG/PNG/TIFF figures, composed figures, and the project package.",
                )}
              </li>
            </ol>
          </details>
        </div>
        <div className="real-normalization-box">
          <div className="real-actions">
            <label className="real-field">
              {t("归一化基准", "Normalization baseline")}
              <select
                aria-label={t("归一化基准", "Normalization baseline")}
                disabled={!!busy}
                value={normalizationPolicy?.kind ?? "matched-control"}
                onChange={(event) =>
                  commit((previous) =>
                    applyNormalization(
                      previous,
                      event.target.value === "matched-control"
                        ? { kind: "matched-control" }
                        : {
                            kind: "reference-unit",
                            unitId: normalizationUnits[0] ?? "",
                          },
                    ),
                  )
                }
              >
                <option value="matched-control">
                  {t("各自配对对照 = 1", "Each matched control = 1")}
                </option>
                <option
                  value="reference-unit"
                  disabled={!normalizationUnits.length}
                >
                  {t(
                    "指定一个对照作为共同基准",
                    "Use one control as a common baseline",
                  )}
                </option>
              </select>
            </label>
            {normalizationPolicy?.kind === "reference-unit" && (
              <label className="real-field">
                {project.pairedDesign
                  ? t("基准个体的正常 N", "Baseline individual's normal N")
                  : t("基准实验的 NC", "Baseline experiment's NC")}
                <select
                  aria-label={t("共同基准编号", "Common baseline ID")}
                  value={normalizationPolicy.unitId}
                  disabled={!!busy}
                  onChange={(event) =>
                    commit((previous) =>
                      applyNormalization(previous, {
                        kind: "reference-unit",
                        unitId: event.target.value,
                      }),
                    )
                  }
                >
                  {!normalizationUnits.includes(normalizationPolicy.unitId) && (
                    <option value={normalizationPolicy.unitId}>
                      {normalizationPolicy.unitId} · {t("缺失", "missing")}
                    </option>
                  )}
                  {normalizationUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {project &&
            !project.normalization &&
            project.normalizationPreference === "reference-unit" && (
              <p className="real-muted">
                {t(
                  "新项目默认使用共同基准：完成设计后自动以第一个对照为基准，可随时在上方更改。",
                  "New projects default to a common baseline: after the design is set, the first control is chosen automatically; change it anytime above.",
                )}
              </p>
            )}
          <p className="real-muted">
            {normalizationPolicy?.kind === "reference-unit"
              ? t(
                  "全部目标/内参比值除以所选对照的比值。只有该对照定义为 1；其他 NC/N 的高低均按真实计算保留。跨膜或批次可比性须另行验证，结果保留草稿提示。",
                  "All target/reference ratios are divided by the selected control ratio. Only that control is defined as 1; other NC/N values retain their calculated variation. Cross-membrane or batch comparability requires separate validation, so results retain a draft warning.",
                )
              : t(
                  "每个实验/个体分别除以自己的 NC/N。所有对照 = 1 是该算法的定义，并不代表对照没有生物学差异。",
                  "Each experiment/individual is divided by its own NC/N. All controls equal 1 by definition; this does not imply absent biological variation.",
                )}
          </p>
        </div>
        <div className="real-normalization-box">
          <div className="real-actions">
            <label className="real-field">
              {t("背景扣除方法", "Background correction")}
              <select
                aria-label={t("背景扣除方法", "Background correction")}
                disabled={!!busy}
                value={
                  project.backgroundCorrection?.kind === "rolling-ball"
                    ? "rolling-ball"
                    : "local"
                }
                onChange={(event) =>
                  commit((previous) =>
                    updateRealProject(previous, {
                      backgroundCorrection:
                        event.target.value === "rolling-ball"
                          ? {
                              kind: "rolling-ball",
                              radius:
                                previous.backgroundCorrection?.kind ===
                                "rolling-ball"
                                  ? previous.backgroundCorrection.radius
                                  : 50,
                            }
                          : { kind: "local" },
                    }),
                  )
                }
              >
                <option value="local">
                  {t(
                    "局部背景取样框（默认）",
                    "Local background ROIs (default)",
                  )}
                </option>
                <option value="rolling-ball">
                  {t(
                    "Rolling ball（与 ImageJ 数值一致）",
                    "Rolling ball (ImageJ-compatible)",
                  )}
                </option>
              </select>
            </label>
            {project.backgroundCorrection?.kind === "rolling-ball" && (
              <label className="real-field">
                {t("Rolling ball 半径", "Rolling-ball radius")}
                <input
                  type="number"
                  min={10}
                  max={200}
                  step={5}
                  disabled={!!busy}
                  value={project.backgroundCorrection.radius}
                  onChange={(event) => {
                    const radius = Number(event.target.value);
                    if (
                      !Number.isInteger(radius) ||
                      radius < 10 ||
                      radius > 200
                    )
                      return;
                    commit((previous) =>
                      updateRealProject(previous, {
                        backgroundCorrection: {
                          kind: "rolling-ball",
                          radius,
                        },
                      }),
                    );
                  }}
                />
              </label>
            )}
          </div>
          <p className="real-muted">
            {project.backgroundCorrection?.kind === "rolling-ball"
              ? t(
                  "对全图计算 rolling ball 背景（与 ImageJ「Subtract Background」逐像素一致，见验证文档），条带 IntDen 为扣除后的信号和；此方法不使用背景取样框。半径越大，保留的低频背景越多；常用 25–50。切换方法会使全部复核状态失效。",
                  "The rolling-ball background is computed over the whole image, pixel-identical to ImageJ's Subtract Background (see the validation notes); band IntDen is the corrected signal sum. Background ROIs are unused in this mode. A larger radius keeps more low-frequency background; 25–50 is common. Switching methods invalidates all review states.",
                )
              : t(
                  "每条条带用其背景取样框的信号均值扣背景（默认方法）。",
                  "Each band subtracts the mean signal of its own background ROIs (default method).",
                )}
          </p>
        </div>
        <label className="real-checkbox real-test-choice">
          <input
            type="checkbox"
            aria-label={t("双侧配对 t 检验", "Two-sided paired t-test")}
            checked={project.statisticalTest === "paired-t"}
            disabled={
              !!busy ||
              !project.designConfirmed ||
              calculated.summaries.filter(
                (summary) => summary.protein === protein,
              ).length !== 2
            }
            onChange={(event) =>
              commit((previous) =>
                updateRealProject(previous, {
                  statisticalTest: event.target.checked ? "paired-t" : "none",
                }),
              )
            }
          />
          <span>
            {t("选择双侧配对 t 检验", "Select a two-sided paired t-test")}
            <small>
              {t(
                "先确认独立性，且仅比较两个配对条件。检验使用目标/内参比值，不使用把各自对照设为 1 后的数值。跨膜、曝光或批次的比值尺度须可比；选择共同基准并不能校准这些差异。须假设配对差值近似正态；小样本难以核实此假设。P 值未经多重比较校正，不能消除图像质量问题。",
                "Confirm independence first; only two paired conditions are supported. The test uses target/reference ratios, not values divided by each pair's own control. Ratio scales must be comparable across membranes, exposures, and batches; selecting a common baseline cannot calibrate those differences. It assumes approximately normal paired differences, an assumption hard to assess with small n. P-values are unadjusted and do not resolve image-quality problems.",
              )}
            </small>
          </span>
        </label>
        {calculated.problem && (
          <div className="real-error" role="alert">
            {localizeMessage(calculated.problem, language)}
          </div>
        )}
        {!calculated.rows.length ? (
          <div className="real-empty">
            {t(
              "完成图像角色、实验与膜配对后，目标泳道结果会显示在这里。",
              "Target-lane results appear after image roles and experiment/membrane pairing are set.",
            )}
          </div>
        ) : (
          <>
            <div className="real-results-controls">
              <label className="real-field">
                {t("目标蛋白", "Target protein")}
                <select
                  aria-label={t("图表目标蛋白", "Figure target protein")}
                  value={protein}
                  onChange={(event) => setSelectedProtein(event.target.value)}
                >
                  {proteins.map((label) => (
                    <option key={label}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="real-field">
                {t("图形样式", "Plot style")}
                <select
                  aria-label={t("图形样式", "Plot style")}
                  value={plotStyle}
                  onChange={(event) =>
                    setPlotStyle(event.target.value as "bars" | "paired")
                  }
                >
                  <option value="bars">
                    {t("柱状图 + 单点 + SD", "Bars + individual points + SD")}
                  </option>
                  <option value="paired">
                    {t("配对连线图 + SD", "Paired points + SD")}
                  </option>
                </select>
              </label>
              <span className="real-method-badge" aria-live="polite">
                {project.backgroundCorrection?.kind === "rolling-ball"
                  ? t(
                      `背景：Rolling ball r=${project.backgroundCorrection.radius}（ImageJ 一致）`,
                      `Background: rolling ball r=${project.backgroundCorrection.radius} (ImageJ-compatible)`,
                    )
                  : t(
                      "背景：局部背景取样框",
                      "Background: local background ROIs",
                    )}
              </span>
              <div className="real-actions">
                <button
                  className="real-button"
                  disabled={!!busy}
                  onClick={() => {
                    saveBlob(
                      new Blob(["\ufeff" + exportRealCsv(project)], {
                        type: "text/csv;charset=utf-8",
                      }),
                      `${fileStem(project.name)}-results.csv`,
                    );
                    setNotice(
                      t(
                        "CSV 保留所有状态与警告，阻断记录不含可用比值。",
                        "CSV retains statuses and warnings; blocked records have no usable ratios.",
                      ),
                    );
                  }}
                >
                  <Download size={15} />
                  CSV
                </button>
                <button
                  className="real-button"
                  disabled={!!busy}
                  onClick={() =>
                    saveBlob(
                      new Blob(["\ufeff" + exportRealStatisticsCsv(project)], {
                        type: "text/csv;charset=utf-8",
                      }),
                      `${fileStem(project.name)}-statistics.csv`,
                    )
                  }
                >
                  <Download size={15} />
                  {t("统计 CSV", "Statistics CSV")}
                </button>
                {(["svg", "png", "tiff"] as const).map((format) => (
                  <button
                    className="real-button"
                    key={format}
                    disabled={!!busy || !figureAvailable}
                    onClick={() => exportFigure(format)}
                  >
                    <Download size={15} />
                    {format.toUpperCase()}
                  </button>
                ))}
                {(["svg", "png", "tiff"] as const).map((format) => (
                  <button
                    className="real-button"
                    key={`composed-${format}`}
                    disabled={!!busy || !figureAvailable}
                    onClick={() =>
                      void run(
                        t("正在合成组合图版…", "Composing the figure…"),
                        () => exportComposedFigure(format),
                      )
                    }
                  >
                    <Layers size={15} />
                    {t("组合图版", "Composed figure")} {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {figureAvailable ? (
              <div className="real-figure-wrap">
                <ResultFigure
                  project={project}
                  protein={protein}
                  rows={calculated.rows}
                  summaries={calculated.summaries}
                  language={language}
                  figureRef={figureRef}
                  plotStyle={plotStyle}
                />
              </div>
            ) : (
              <div className="real-warning">
                {t(
                  "当前蛋白没有可绘制的完整配对结果。请检查下表的阻断原因。",
                  "This protein has no complete pair available for plotting. Check the blocking reasons below.",
                )}
              </div>
            )}
            <p className="real-muted" style={{ marginTop: 9 }}>
              {t(
                "SVG 为矢量图；PNG / TIFF 为 3 倍像素渲染，TIFF 带 300 DPI 标记。原始定量数据不受图形导出影响。",
                "SVG is vector. PNG / TIFF render at 3× pixel dimensions; TIFF includes a 300 DPI tag. Figure export does not change original measurements.",
              )}
            </p>
            <div className="real-table-scroll">
              <table className="real-result-table">
                <thead>
                  <tr>
                    {[
                      project.pairedDesign
                        ? t("图像 / 个体", "Image / individual")
                        : t("图像 / 实验", "Image / experiment"),
                      t("条件", "Condition"),
                      t("目标净信号", "Target net"),
                      t("内参净信号", "Reference net"),
                      t("目标 / 内参", "Target / reference"),
                      t("相对对照", "Fold vs control"),
                      t("状态", "Status"),
                      t("复核提示", "Review warnings"),
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calculated.rows
                    .filter((row) => row.protein === protein)
                    .map((row) => (
                      <tr key={`${row.imageId}-${row.lane}`}>
                        <td>
                          <button
                            className="real-file-name"
                            onClick={() => {
                              setSelectedId(row.imageId);
                              sections.current[2]?.scrollIntoView({
                                behavior: "smooth",
                              });
                            }}
                          >
                            {row.name}
                          </button>
                          <small>
                            {row.unitId ? `${row.unitId} · ` : ""}
                            {row.replicate || "—"} · {row.membrane || "—"} · r
                            {row.analysisRevision}
                          </small>
                        </td>
                        <td>{row.sample}</td>
                        <td>{numberText(row.targetNet)}</td>
                        <td>{numberText(row.referenceNet)}</td>
                        <td>{numberText(row.ratio)}</td>
                        <td>{numberText(row.fold)}</td>
                        <td>
                          <span className={`real-status ${row.status}`}>
                            {row.status === "draft"
                              ? t("草稿 DRAFT", "DRAFT")
                              : row.status === "blocked"
                                ? t("已阻断", "Blocked")
                                : t("已复核", "Reviewed")}
                          </span>
                        </td>
                        <td className="real-result-warnings">
                          {row.warnings.length ? (
                            <details>
                              <summary>
                                {t(
                                  `${row.warnings.length} 条复核提示`,
                                  `${row.warnings.length} review notes`,
                                )}
                              </summary>
                              <ul>
                                {row.warnings.map((warning, index) => (
                                  <li key={index}>
                                    {localizeMessage(warning, language)}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <details className="real-disclosure">
          <summary>
            {t("方法、限制与保存恢复", "Method, limitations, and recovery")}
          </summary>
          <p>
            {t(
              "暗条带净信号 = 条带面积 × 背景均值 − 条带像素积分；亮条带则为条带像素积分 − 条带面积 × 背景均值。目标与内参须来自已确认的同一实验和膜；多个曝光不能作为独立重复，同组多图需明确排除多余曝光。",
              "For dark bands, net signal = band area × background mean − band pixel sum. For light bands, net signal = band pixel sum − band area × background mean. Target and reference must belong to the same experiment and membrane. Additional exposures are not independent replicates; exclude them explicitly.",
            )}
          </p>
          <p>
            {t(
              "强度端点截断、非正信号、缺失配对等问题会留下草稿或阻断状态。人工复核不证明成像处于线性范围，也不恢复已经截断的原始信息。",
              "Endpoint clipping, nonpositive signals, and missing pairings retain draft or blocked status. Manual review does not establish acquisition linearity or recover clipped information.",
            )}
          </p>
          <p>
            {t(
              "真实项目与合成示例分开保存在浏览器中。离开前等待“已保存到本机”；换浏览器、地址或端口时请用导出的项目包恢复。原图随项目包保存，CSV 和图形都不能替代完整备份。",
              "Real projects and the synthetic demo use separate browser storage. Wait for Saved locally before leaving. Restore from an exported archive when changing browser, address, or port. Archives include originals; CSV and figures do not replace a full backup.",
            )}
          </p>
        </details>
      </section>
      <PublicationPanel
        key={project.id}
        project={project}
        disabled={Boolean(busy)}
        onChange={(settings) =>
          commit((previous) => updateRealPublication(previous, settings))
        }
        onRun={run}
        sectionRef={(element) => {
          sections.current[4] = element;
        }}
      />
      <footer className="real-footer">
        <span>
          {t(
            "本机计算 · 原图保留 · 参数可追溯",
            "Local computation · Preserved originals · Traceable parameters",
          )}
        </span>
        <span>
          {t(
            "实验功能；质量提示始终随结果保留。",
            "Experimental; quality warnings remain with results.",
          )}
        </span>
      </footer>
      {dialog && (
        <div className="real-dialog-backdrop">
          <div
            className="real-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="real-dialog-title"
          >
            <h2 id="real-dialog-title">
              {dialog.kind === "regions"
                ? t("替换当前图像的区域？", "Replace this image's regions?")
                : t(
                    "替换当前真实工作区？",
                    "Replace the current real workspace?",
                  )}
            </h2>
            <p>
              {dialog.kind === "regions"
                ? t(
                    "这会重新建议当前图像的条带与背景，并替换已有手动区域。旧参数会保留在历史中。",
                    "This proposes new band and background regions, replacing manual regions for this image. Previous parameters remain in history.",
                  )
                : t(
                    "当前工作区将被替换；原合成示例不受影响。需要保留当前分析时，请先导出项目包。",
                    "The real workspace will be replaced; the synthetic demo is separate. Export a project archive first to preserve your current analysis.",
                  )}
            </p>
            {dialog.kind === "new" && (
              <label className="real-field">
                {t("新项目名称", "New project name")}
                <input
                  value={newName}
                  maxLength={200}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
            )}
            {dialog.kind === "import" && (
              <p>
                <strong>{dialog.project.name}</strong> ·{" "}
                {dialog.project.images.length} {t("张原图", "original images")}
              </p>
            )}
            <div className="real-actions">
              <button
                className="real-button"
                disabled={!!busy}
                onClick={() => setDialog(null)}
              >
                {t("取消", "Cancel")}
              </button>
              {dialog.kind !== "regions" && (
                <button
                  className="real-button"
                  disabled={!!busy}
                  onClick={() => void archive()}
                >
                  {t("先导出当前项目", "Export current project")}
                </button>
              )}
              <button
                className="real-button primary"
                disabled={!!busy || (dialog.kind === "new" && !newName.trim())}
                onClick={() => {
                  if (dialog.kind === "new")
                    replace(createRealProject(newName, language));
                  else if (dialog.kind === "import") replace(dialog.project);
                  else {
                    const currentImage = project.images.find(
                      (entry) => entry.id === dialog.imageId,
                    );
                    if (currentImage)
                      void run(
                        t("正在重新建议…", "Proposing new regions…"),
                        () => {
                          const regions = proposeRegions(
                            imageRaster(currentImage),
                            requiredLaneCount(project, currentImage),
                            currentImage.signal,
                          );
                          patchImage(currentImage.id, { regions });
                          setDialog(null);
                        },
                      );
                  }
                }}
              >
                {dialog.kind === "regions"
                  ? t("确认替换区域", "Replace regions")
                  : dialog.kind === "new"
                    ? t("创建并替换", "Create and replace")
                    : t("确认导入", "Confirm import")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
