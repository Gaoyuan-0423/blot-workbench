import { APP_VERSION } from "../core/types";
import { effectiveNormalization, results } from "./model";
import type { RealProject, RealResult } from "./model";

/**
 * One-click analysis report: aggregates every blocking reason and warning the
 * deterministic local pipeline produced into structured, stable-coded issues,
 * then derives prioritized, actionable recommendations. Pure derivation over
 * project state — no model output, no network, fully re-computable.
 */

export type IssueSeverity = "blocker" | "warning" | "info";
export type IssueScope = "project" | "image" | "lane";

export interface ReportIssue {
  severity: IssueSeverity;
  scope: IssueScope;
  /** Stable machine code for programmatic use. */
  code: string;
  /** Bilingual human message, verbatim from the pipeline where applicable. */
  message: string;
  imageName?: string;
  lane?: number;
}

export interface ReportRecommendation {
  code: string;
  /** 1 = act first. */
  priority: 1 | 2 | 3;
  title: { zh: string; en: string };
  detail: { zh: string; en: string };
}

export interface AnalysisReport {
  format: "blot-workbench-analysis-report";
  version: 1;
  appVersion: string;
  createdAt: string;
  project: {
    id: string;
    name: string;
    laneDescription: string;
    designConfirmed: boolean;
    backgroundCorrection: RealProject["backgroundCorrection"];
    normalization: ReturnType<typeof effectiveNormalization>;
  };
  summary: {
    images: number;
    excluded: number;
    results: { ready: number; draft: number; blocked: number };
    issues: Record<IssueSeverity, number>;
  };
  issues: ReportIssue[];
  recommendations: ReportRecommendation[];
}

interface IssueAccumulator {
  issues: ReportIssue[];
  seen: Set<string>;
}

function addIssue(
  acc: IssueAccumulator,
  issue: ReportIssue,
): void {
  const key = JSON.stringify([
    issue.severity,
    issue.scope,
    issue.code,
    issue.message,
    issue.imageName ?? "",
    issue.lane ?? 0,
  ]);
  if (acc.seen.has(key)) return;
  acc.seen.add(key);
  acc.issues.push(issue);
}

const BLOCKING_REASON_CODES: [RegExp, string][] = [
  [/net signal is nonpositive|净信号非正/i, "NON_POSITIVE_NET"],
  [/no paired lane design|尚未设置配对泳道/i, "LANE_DESIGN_MISSING"],
  [/regions are missing|缺少条带或背景区域/i, "REGIONS_MISSING"],
  [/reference is missing|内参缺失/i, "REFERENCE_UNAVAILABLE"],
  [/对照泳道的归一化值不可用|control.*normalization/i, "CONTROL_UNAVAILABLE"],
  [/baseline.*missing|基准.*缺失|不唯一/i, "BASELINE_UNAVAILABLE"],
];

function codeForWarning(warning: string): string {
  if (/^CLIPPED_PIXELS$|^BACKGROUND_CLIPPED$/.test(warning))
    return "CLIPPED_PIXELS";
  if (warning.startsWith("ROLLING_BALL_SATURATED"))
    return "ROLLING_BALL_SATURATED";
  for (const [pattern, code] of BLOCKING_REASON_CODES)
    if (pattern.test(warning)) return code;
  if (/CLIPPED|截断/i.test(warning)) return "CLIPPED_PIXELS";
  if (/BAND_TOUCHES_EDGE/.test(warning)) return "BAND_TOUCHES_EDGE";
  if (/LOW_LANE_SEPARATION/.test(warning)) return "LOW_LANE_SEPARATION";
  if (/EXTRA_LANES_IGNORED/.test(warning)) return "EXTRA_LANES_IGNORED";
  if (/MULTIPLE comparable band rows|多排条带|Multiple comparable/i.test(warning))
    return "MULTI_ROW_AMBIGUOUS";
  if (/VISION_CANDIDATES_REQUIRE_REVIEW/.test(warning))
    return "VISION_CANDIDATES_UNREVIEWED";
  if (/CANDIDATES_REQUIRE_REVIEW/.test(warning))
    return "CANDIDATES_REQUIRE_REVIEW";
  if (/背景面积不足/.test(warning)) return "BACKGROUND_TOO_SMALL";
  if (/背景不均匀/.test(warning)) return "BACKGROUND_UNEVEN";
  if (/接近纯黑|near-black|NEAR_BLACK/i.test(warning)) return "NEAR_BLACK_PIXELS";
  if (/Cross-experiment comparability|跨实验可比性/.test(warning))
    return "CROSS_EXPERIMENT_COMPARABILITY";
  if (/Experimental independence|实验独立性/.test(warning))
    return "DESIGN_UNCONFIRMED";
  if (/manual review|人工复核/.test(warning)) return "REVIEW_REQUIRED";
  return "IMAGE_WARNING";
}

const IGNORED_AS_NOISE = /^(?:RGB_MEAN_INTENSITY|OPAQUE_ALPHA_IGNORED|WHITE_IS_ZERO_INVERTED|METADATA_SUBDIRECTORIES_IGNORED)$/;

/** Per-lane/per-image causes that genuinely block a result row. */
const BLOCKING_CODES = new Set([
  "NON_POSITIVE_NET",
  "LANE_DESIGN_MISSING",
  "REGIONS_MISSING",
  "REFERENCE_UNAVAILABLE",
  "CONTROL_UNAVAILABLE",
  "BASELINE_UNAVAILABLE",
  "IMAGE_ANALYSIS_ERROR",
]);

/** Row warnings already covered once at project scope. */
const PROJECT_LEVEL_CODES = new Set([
  "DESIGN_UNCONFIRMED",
  "CROSS_EXPERIMENT_COMPARABILITY",
]);

function collectResultIssues(
  project: RealProject,
  rows: RealResult[],
  acc: IssueAccumulator,
): void {
  for (const row of rows) {
    const image = project.images.find((entry) => entry.id === row.imageId);
    for (const warning of row.warnings) {
      const code = codeForWarning(warning);
      if (IGNORED_AS_NOISE.test(code)) continue;
      if (PROJECT_LEVEL_CODES.has(code)) continue;
      addIssue(acc, {
        severity:
          row.status === "blocked" && BLOCKING_CODES.has(code)
            ? "blocker"
            : "warning",
        scope: "lane",
        code,
        message: warning,
        imageName: image?.name ?? row.name,
        lane: row.lane,
      });
    }
  }
}

function collectProjectIssues(
  project: RealProject,
  acc: IssueAccumulator,
): void {
  if (!project.designConfirmed)
    addIssue(acc, {
      severity: "warning",
      scope: "project",
      code: "DESIGN_UNCONFIRMED",
      message:
        "Experiment design is unconfirmed; n counts paired sets only / 实验设计尚未确认，n 仅表示配对组数",
    });
  for (const image of project.images) {
    if (image.excluded)
      addIssue(acc, {
        severity: "info",
        scope: "image",
        code: "IMAGE_EXCLUDED",
        message: "Image is excluded from analysis / 此图已排除",
        imageName: image.name,
      });
    else if (!image.regions.length && !image.analysisError)
      addIssue(acc, {
        severity: "warning",
        scope: "image",
        code: "REGIONS_MISSING",
        message: "No band/background regions proposed yet / 尚未提出条带与背景候选",
        imageName: image.name,
      });
    if (image.analysisError)
      addIssue(acc, {
        severity: "blocker",
        scope: "image",
        code: "IMAGE_ANALYSIS_ERROR",
        message: image.analysisError,
        imageName: image.name,
      });
  }
}

/** Prioritized, actionable directions derived from the issue set and options. */
function deriveRecommendations(
  issues: ReportIssue[],
  project: RealProject,
): ReportRecommendation[] {
  const codes = new Set(issues.map((issue) => issue.code));
  const out: ReportRecommendation[] = [];
  const push = (
    code: string,
    priority: 1 | 2 | 3,
    zh: [string, string],
    en: [string, string],
  ) =>
    out.push({
      code,
      priority,
      title: { zh: zh[0], en: en[0] },
      detail: { zh: zh[1], en: en[1] },
    });

  if (codes.has("LANE_DESIGN_MISSING"))
    push(
      "FIX_LANE_DESIGN",
      1,
      [
        "补全泳道与配对设计",
        "此图的泳道没有映射到配对设计；请补一次泳道说明或 N/T 配对表后重算。",
      ],
      [
        "Fix the lane/pairing design",
        "Some lanes are not mapped to a paired design; complete the lane description or N/T pair table, then recalculate.",
      ],
    );
  if (codes.has("IMAGE_ANALYSIS_ERROR") || codes.has("REGIONS_MISSING"))
    push(
      "MANUAL_ROIS_FOR_FAILED",
      1,
      [
        "对自动候选失败的图改用手动框选",
        "此图无法可靠地自动提出泳道/条带候选（对比度不足或布局歧义）。请在图像视图中手动绘制条带与背景区域，或裁剪出更干净的条带图后重试。",
      ],
      [
        "Draw manual ROIs where the automatic proposal failed",
        "This image has no reliable automatic candidates (insufficient contrast or ambiguous layout). Draw band and background regions manually, or export a cleaner crop and retry.",
      ],
    );
  if (codes.has("NON_POSITIVE_NET"))
    push(
      "RECHECK_BOXES_OR_ROLLING_BALL",
      1,
      [
        "修正非正净信号的取样框",
        "扣除背景后信号非正通常是条带框偏移或背景取样框落在条带上。请核对该框位置，或切换 rolling ball 背景后重算比较。",
      ],
      [
        "Recheck boxes behind nonpositive net signals",
        "Nonpositive net usually means the band box drifted or the background ROI overlaps signal. Recheck the boxes, or switch to the rolling-ball background and compare.",
      ],
    );
  if (codes.has("CLIPPED_PIXELS") || codes.has("ROLLING_BALL_SATURATED"))
    push(
      "EXPOSURE_SATURATION",
      1,
      [
        "存在饱和像素",
        "端点（0 或满量程）像素无法恢复真实强度，会低估条带。建议缩短曝光/降低增益后重新采集；已采图像的结果保留 DRAFT 提示。",
      ],
      [
        "Saturated pixels present",
        "Clipped pixels (0 or full scale) cannot recover true intensity and underestimate bands. Re-acquire with shorter exposure or lower gain; existing results keep their DRAFT flag.",
      ],
    );
  if (codes.has("DESIGN_UNCONFIRMED") && project.images.length > 0)
    push(
      "CONFIRM_DESIGN",
      2,
      [
        "确认实验设计",
        "确认泳道映射与独立单位后，n 才代表独立实验/个体；确认不会消除图像质量问题。",
      ],
      [
        "Confirm the experiment design",
        "Only after confirming lane mapping and independent units does n represent independent experiments/individuals; confirmation does not resolve image-quality problems.",
      ],
    );
  if (codes.has("LOW_LANE_SEPARATION") || codes.has("MULTI_ROW_AMBIGUOUS"))
    push(
      "MANUAL_ROIS_FOR_AMBIGUOUS",
      2,
      [
        "对歧义泳道改用手动 ROI",
        "泳道分隔弱或同泳道多排条带无法可靠自动分割；请在放大视图下手动框选条带与背景。",
      ],
      [
        "Use manual ROIs for ambiguous lanes",
        "Weak lane separation or multiple band rows cannot be segmented reliably; draw band and background ROIs manually in the zoomed view.",
      ],
    );
  if (
    codes.has("BACKGROUND_TOO_SMALL") ||
    codes.has("BACKGROUND_UNEVEN") ||
    codes.has("BACKGROUND_CLIPPED")
  )
    push(
      "IMPROVE_BACKGROUND",
      2,
      [
        "改善背景取样",
        "背景框过小、不均匀或含饱和像素会放大噪声。建议在条带上下各取更宽的干净区域，避开边框、文字与水印。",
      ],
      [
        "Improve background sampling",
        "Small, uneven, or clipped backgrounds amplify noise. Sample wider clean strips above and below the band, away from borders, text, and watermarks.",
      ],
    );
  if (codes.has("BAND_TOUCHES_EDGE"))
    push(
      "RECAST_WITH_MARGIN",
      3,
      [
        "裁剪时为条带留边",
        "贴边的条带无法确认信号完整。重新导出图像时在四周多留 10–20 像素。",
      ],
      [
        "Leave margins around bands",
        "Edge-touching bands cannot confirm complete signal. Export images with 10–20 pixels of margin around the blot.",
      ],
    );
  if (
    codes.has("CANDIDATES_REQUIRE_REVIEW") ||
    codes.has("VISION_CANDIDATES_UNREVIEWED") ||
    codes.has("REVIEW_REQUIRED")
  )
    push(
      "REVIEW_CANDIDATES",
      2,
      [
        "逐图复核自动/视觉候选",
        "候选框是草稿：请核对每条条带与背景的位置后再标记复核；视觉来源的候选同样必须人工确认。",
      ],
      [
        "Review automatic/vision candidates per image",
        "Proposals are drafts: verify every band and background before marking reviewed; vision-sourced candidates equally require manual confirmation.",
      ],
    );
  if (
    project.normalizationPreference === "reference-unit" ||
    project.normalization?.kind === "reference-unit"
  )
    push(
      "VALIDATE_CROSS_MEMBRANE",
      3,
      [
        "共同基准不能替代跨膜可比性验证",
        "共同基准把选定对照定义为 1，但不同膜/曝光的比值尺度仍需另行验证后才能直接比较。",
      ],
      [
        "A common baseline does not validate cross-membrane comparability",
        "The shared baseline defines one control as 1; ratio scales across membranes or exposures still require separate validation before direct comparison.",
      ],
    );
  if (
    !codes.has("NON_POSITIVE_NET") &&
    !issues.some((issue) => issue.severity === "blocker") &&
    project.images.some((image) => !image.excluded)
  )
    push(
      "RESULTS_READY",
      3,
      [
        "结果就绪",
        "没有阻断项。导出 CSV/统计/组合图版前，请确认已逐图复核且设计已确认。",
      ],
      [
        "Results are ready",
        "No blockers. Before exporting CSV/statistics/composed figures, confirm per-image review and the design confirmation.",
      ],
    );
  return out;
}

/** Build the full one-click report from current project state. */
export function buildAnalysisReport(project: RealProject): AnalysisReport {
  const rows = results(project);
  const acc: IssueAccumulator = { issues: [], seen: new Set() };
  collectResultIssues(project, rows, acc);
  collectProjectIssues(project, acc);
  const summary = {
    images: project.images.length,
    excluded: project.images.filter((image) => image.excluded).length,
    results: {
      ready: rows.filter((row) => row.status === "ready").length,
      draft: rows.filter((row) => row.status === "draft").length,
      blocked: rows.filter((row) => row.status === "blocked").length,
    },
    issues: {
      blocker: acc.issues.filter((issue) => issue.severity === "blocker").length,
      warning: acc.issues.filter((issue) => issue.severity === "warning").length,
      info: acc.issues.filter((issue) => issue.severity === "info").length,
    },
  };
  return {
    format: "blot-workbench-analysis-report",
    version: 1,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      laneDescription: project.laneDescription,
      designConfirmed: project.designConfirmed,
      backgroundCorrection: project.backgroundCorrection,
      normalization: effectiveNormalization(project),
    },
    summary,
    issues: acc.issues,
    recommendations: deriveRecommendations(acc.issues, project),
  };
}
