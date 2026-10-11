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
  createRealProject,
  descriptiveStatistics,
  exportRealCsv,
  exportRealProject,
  imageRaster,
  importRealImages,
  importRealProject,
  isControlLane,
  isExcludedLane,
  loadRealProject,
  results,
  saveRealProject,
  updateRealImage,
  updateRealProject,
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
  "Insufficient adjacent background space; select band/background ROIs manually.":
    "相邻背景空间不足，请手动选择条带与背景区域。",
};

function localizeMessage(message: string, language: Language): string {
  if (message.startsWith("[") && message.includes('"code"'))
    return language === "zh"
      ? "项目或参数校验失败。请确认导入的是此真实工作区导出的项目包，并检查区域与图像信息。"
      : "Project or settings validation failed. Use an archive exported by the real workspace and check the regions and image metadata.";
  if (message === "invalid zip data")
    return language === "zh"
      ? "项目包不是有效的 ZIP 文件。"
      : "The project archive is not a valid ZIP file.";
  const prefixes: [string, string, string][] = [
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
  const parts = message.split(" / ");
  if (parts.length === 2) return parts[language === "zh" ? 1 : 0];
  return message;
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
const requiredLaneCount = (project: RealProject) =>
  Math.max(
    1,
    ...project.laneLabels.map((label, index) =>
      isExcludedLane(label) ? 0 : index + 1,
    ),
  );

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

function ResultFigure({
  project,
  protein,
  rows,
  summaries,
  language,
  figureRef,
}: {
  project: RealProject;
  protein: string;
  rows: RealResult[];
  summaries: RealStatistics[];
  language: Language;
  figureRef: React.RefObject<SVGSVGElement | null>;
}) {
  const t: Translate = (zh, en) => (language === "zh" ? zh : en);
  const groups = summaries.filter((summary) => summary.protein === protein);
  const included = rows.filter(
    (row) =>
      row.protein === protein &&
      row.fold !== null &&
      row.status !== "blocked" &&
      groups
        .find((group) => group.sample === row.sample)
        ?.replicates.includes(row.replicate),
  );
  const draft =
    !project.designConfirmed ||
    rows.some((row) => row.protein === protein && row.status !== "ready") ||
    groups.some((group) => group.status !== "ready");
  const rawWarnings = unique(
    rows
      .filter((row) => row.protein === protein)
      .flatMap((row) => row.warnings),
  );
  const summaryWarnings = groups.flatMap((group) => group.warnings);
  const warningLines = unique([...rawWarnings, ...summaryWarnings]).flatMap(
    (warning) => wrapText(localizeMessage(warning, language), 110),
  );
  const width = 900,
    plotTop = 106,
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
  const experiments = unique(included.map((row) => row.replicate));
  const colors = [
    "#287654",
    "#577eaf",
    "#b87940",
    "#8b6ca6",
    "#7b9243",
    "#a26373",
  ];
  const height = 520 + warningLines.length * 17;
  return (
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
        {t(
          "每次实验：目标 / 内参，再除以同次对照比值；对照 = 1。",
          "Within each experiment: (target / reference) divided by its matched control ratio; control = 1.",
        )}
      </text>
      <text x="28" y="77" fontSize="12" fill="#53695b">
        {t(
          "点与线：完整配对；横线与误差线：均值 ± SD（n ≥ 2）；无显著性检验。",
          "Points and lines: complete pairs. Summary and error bars: mean ± SD (n ≥ 2). No significance test.",
        )}
      </text>
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
        {t("相对同次对照的倍数", "Fold relative to matched control")}
      </text>
      {experiments.map((experiment, index) => {
        const values = groups
          .map((group, groupIndex) => ({
            row: included.find(
              (row) =>
                row.replicate === experiment && row.sample === group.sample,
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
            {values.length > 1 && (
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
                  {t("实验", "Experiment")} {experiment} · {row!.sample}:{" "}
                  {numberText(row!.fold)}
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
            {project.designConfirmed
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
        {t(
          "实验性本机分析；图形包含当前质量状态。",
          "Experimental local analysis; this figure retains the current quality status.",
        )}
      </text>
      {warningLines.map((line, index) => (
        <text
          key={index}
          x="28"
          y={497 + index * 17}
          fontSize="10"
          fill="#94632d"
        >
          {index === 0 ? "⚠ " : "  "}
          {line}
        </text>
      ))}
    </svg>
  );
}

export default function RealWorkbench({ onDemo }: { onDemo: () => void }) {
  const [project, setProject] = useState<RealProject | null>(null);
  const currentProject = useRef<RealProject | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const figureRef = useRef<SVGSVGElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const language = project?.language ?? "zh";
  const t: Translate = (zh, en) => (language === "zh" ? zh : en);

  const accept = (next: RealProject) => {
    currentProject.current = next;
    setProject(next);
  };
  const replace = (next: RealProject) => {
    accept(next);
    setSelectedId(next.images[0]?.id ?? "");
    setLaneDraft(next.laneDescription);
    setLanePreview(null);
    setSelectedRegion({ lane: 1, kind: "band" });
    setSelectedProtein("");
    setLoadFailed(false);
    setDialog(null);
    setError("");
  };
  const commit = (change: (previous: RealProject) => RealProject) => {
    if (!currentProject.current) return;
    try {
      accept(change(currentProject.current));
      setError("");
    } catch (problem) {
      setError(
        localizeMessage(
          problem instanceof Error ? problem.message : String(problem),
          language,
        ),
      );
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
      setError(
        localizeMessage(
          problem instanceof Error ? problem.message : String(problem),
          language,
        ),
      );
    } finally {
      working.current = false;
      setBusy(null);
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
            localizeMessage(
              problem instanceof Error ? problem.message : String(problem),
              "zh",
            ),
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
              `${t("本机保存失败，请导出项目包备份。", "Local saving failed. Export a project archive for backup.")} ${localizeMessage(problem instanceof Error ? problem.message : String(problem), language)}`,
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
      setError(
        localizeMessage(
          problem instanceof Error ? problem.message : String(problem),
          language,
        ),
      );
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
        t(
          `已导入 ${files.length} 张原图。请确认文件信息与泳道映射，再建议区域。`,
          `Imported ${files.length} originals. Check image metadata and lane assignments before suggesting regions.`,
        ),
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
          project: await importRealProject(await response.blob()),
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
    const laneWidth = raster.width / project.laneLabels.length;
    const height = Math.max(1, Math.floor(raster.height / 8));
    const regions: LaneRegion[] = project.laneLabels.map((_, index) => ({
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
    }));
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

  if (!project)
    return (
      <div className="real-workbench">
        <h1>{t("真实 WB 分析", "Real WB analysis")}</h1>
        {loadFailed ? (
          <>
            <div className="real-error" role="alert">
              {error}
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
            onClick={() =>
              commit((previous) =>
                updateRealProject(previous, {
                  language: language === "zh" ? "en" : "zh",
                }),
              )
            }
            aria-label={t("切换到英文", "Switch to Chinese")}
          >
            {language === "zh" ? "EN" : "中文"}
          </button>
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
          <span>{error}</span>
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
          <span>{notice}</span>
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
          <span>{busy}</span>
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
          <div className="real-table-scroll">
            <table className="real-mapping-table">
              <thead>
                <tr>
                  {[
                    t("文件 / 像素", "File / pixels"),
                    t("蛋白", "Protein"),
                    t("角色", "Role"),
                    t("实验编号", "Experiment ID"),
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
                          aria-label={`${entry.name} ${t("实验编号", "experiment ID")}`}
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
        </div>
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
                      applyLaneDescription(project, laneDraft).laneLabels,
                    );
                    setError("");
                  } catch (problem) {
                    setError(
                      localizeMessage(
                        problem instanceof Error
                          ? problem.message
                          : String(problem),
                        language,
                      ),
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
                    const next = applyLaneDescription(
                      currentProject.current ?? project,
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
                      localizeMessage(
                        problem instanceof Error
                          ? problem.message
                          : String(problem),
                        language,
                      ),
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
                        ? t("配对对照 = 1", "Matched control = 1")
                        : t("待比较条件", "Compared condition")}
                  </small>
                </li>
              ))}
            </ol>
          </div>
        </div>
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
              disabled={!!busy}
              onChange={(event) =>
                commit((previous) =>
                  updateRealProject(previous, {
                    designConfirmed: event.target.checked,
                  }),
                )
              }
            />
            <span>
              {t(
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
          <button
            className="real-button primary"
            disabled={
              !!busy ||
              !project.images.length ||
              lanePreview !== null ||
              laneDraft !== project.laneDescription
            }
            onClick={() =>
              void run(
                t(
                  "正在逐图建议区域并计算…",
                  "Proposing regions and calculating…",
                ),
                () => {
                  commit((previous) => analyzeAll(previous));
                  setNotice(
                    t(
                      "已处理未排除图像；已有手动区域保留。请逐图复核。",
                      "Processed included images and retained manual regions. Review each image.",
                    ),
                  );
                },
              )
            }
          >
            <ScanLine size={16} />
            {t("全部建议并计算", "Propose & calculate all")}
          </button>
        </div>
        {!image || !raster ? (
          <div className="real-empty">
            <ScanLine size={30} />
            {t(
              "先导入原图，再确认泳道映射。",
              "Import originals and confirm the lane mapping first.",
            )}
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
                              requiredLaneCount(project),
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
                "每个泳道先扣局部背景，再除以内参，最后相对同次实验的对照。仅做描述统计，不自动计算 p 值。",
                "Subtract local background, divide by the reference, then normalize to the matched control within each experiment. Descriptive summaries only; no automatic p-values.",
              )}
            </p>
          </div>
        </div>
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
                      t("图像 / 实验", "Image / experiment"),
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
                            requiredLaneCount(project),
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
