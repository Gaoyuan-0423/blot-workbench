import { connectProjectAdapter } from "../project-archive";
import {
  exportQuickProject,
  importQuickProject,
  type QuickProject,
} from "../cloud-project";
import {
  useLanguage,
  translateMessage as tr,
  formatMessage as f,
  languageUrl,
  translate as t,
} from "../i18n";
import LanguageSwitch from "../LanguageSwitch";
import SuiteNav from "../SuiteNav";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  FlaskConical,
  ImagePlus,
  Layers,
  LoaderCircle,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  detectBands,
  detectRows,
  measureBands,
  type QuickBand,
  type Rect,
} from "./analysis";
import { createQuickExample, loadQuickImage, type QuickImage } from "./image";
import { relativeSignals, resultCsv } from "./results";
import "./quick.css";

type Polarity = "dark" | "light";
type Row = {
  bounds: Rect;
  gray: Uint8Array;
  bands: QuickBand[];
  warnings: string[];
  label: string;
  automaticLabel?: number;
};
type Loaded = {
  image: QuickImage;
  rows: Row[];
  warnings: string[];
  polarity: Polarity;
};
const pretty = (n: number | null | undefined, digits = 2) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: digits });
const palette = [
  "#4f46e5",
  "#818cf8",
  "#a5b4fc",
  "#d6a268",
  "#c47e53",
  "#9d604a",
];

function analyze(image: QuickImage, polarity: Polarity): Loaded {
  const detected = detectRows(image.gray, image.width, image.height, polarity);
  const rows = detected.rows.map((bounds, i) => {
    const gray = new Uint8Array(bounds.width * bounds.height);
    for (let y = 0; y < bounds.height; y++)
      gray.set(
        image.gray.subarray(
          (bounds.y + y) * image.width + bounds.x,
          (bounds.y + y) * image.width + bounds.x + bounds.width,
        ),
        y * bounds.width,
      );
    return {
      bounds,
      gray,
      ...detectBands(gray, bounds.width, bounds.height, polarity),
      label:
        detected.rows.length === 1 ? image.name.replace(/\.[^.]+$/, "") : "",
      automaticLabel: detected.rows.length > 1 ? i + 1 : undefined,
    };
  });
  return { image, rows, warnings: detected.warnings, polarity };
}

const rowLabel = (row: Row) =>
  row.automaticLabel == null ? row.label : f("蛋白 {0}", row.automaticLabel);

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Plot({
  values,
  labels,
  protein,
  control,
  reference,
  chartRef,
}: {
  values: (number | null)[];
  labels: string[];
  protein: string;
  control: number;
  reference: boolean;
  chartRef: React.RefObject<SVGSVGElement | null>;
}) {
  const max =
    Math.max(1, ...values.filter((v): v is number => v != null)) * 1.18;
  const gap = 420 / Math.max(1, values.length);
  return (
    <svg
      ref={chartRef}
      className="quick-chart"
      viewBox="0 0 520 330"
      role="img"
      aria-label={tr("条带相对强度柱状图")}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="520" height="330" fill="white" />
      <text x="52" y="25" fill="#202337" fontSize="16" fontWeight="600">
        {protein.slice(0, 38)}
      </text>
      <text x="52" y="46" fill="#667085" fontSize="11">
        {reference ? tr("内参归一化后相对强度") : tr("扣背景后的相对强度")}{" "}
        {tr("· 对照 = 1")}{" "}
      </text>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1="52"
            x2="484"
            y1={253 - i * 46}
            y2={253 - i * 46}
            stroke="#e3e6ee"
            strokeDasharray={i ? "3 5" : undefined}
          />
          <text
            x="43"
            y={257 - i * 46}
            textAnchor="end"
            fill="#667085"
            fontSize="10"
          >
            {pretty((max * i) / 4, 1)}
          </text>
        </g>
      ))}
      {values.map((v, i) => {
        const height = v == null ? 0 : (v / max) * 184;
        const x = 58 + gap * i + gap / 2;
        return (
          <g key={i}>
            <rect
              x={x - Math.min(22, gap * 0.3)}
              y={253 - height}
              width={Math.min(44, gap * 0.6)}
              height={height}
              rx="3"
              fill={palette[i % palette.length]}
            />
            <text
              x={x}
              y={v == null ? 238 : 244 - height}
              textAnchor="middle"
              fill="#202337"
              fontSize="12"
              fontWeight="600"
            >
              {v == null ? tr("待调整") : `${pretty(v)}×`}
            </text>
            <text
              x={x}
              y="274"
              textAnchor="middle"
              fill="#667085"
              fontSize={values.length > 10 ? "8" : "11"}
            >
              {(labels[i] || f("泳道 {0}", i + 1)).slice(0, 10)}
            </text>
            {i === control && (
              <text
                x={x}
                y="290"
                textAnchor="middle"
                fill="#667085"
                fontSize="9"
              >
                {tr("对照")}{" "}
              </text>
            )}
          </g>
        );
      })}
      <text x="52" y="317" fill="#667085" fontSize="10">
        {tr("Blot Workbench · 8-bit 像素估计 · 自动草稿，取样框待核对")}{" "}
      </text>
    </svg>
  );
}

export default function QuickApp() {
  const { language } = useLanguage();
  const [data, setData] = useState<Loaded | null>(null),
    [external, setExternal] = useState<Loaded | null>(null);
  const [inspectReference, setInspectReference] = useState(false);
  const [externalActive, setExternalActive] = useState(0);
  const [active, setActive] = useState(0),
    [reference, setReference] = useState("none"),
    [control, setControl] = useState(0);
  const [labels, setLabels] = useState<string[]>([]),
    [polarity, setPolarity] = useState<Polarity>("dark");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState(0),
    [editing, setEditing] = useState(false),
    [editBackground, setEditBackground] = useState(false),
    [count, setCount] = useState(6);
  const [showBoxes, setShowBoxes] = useState(true),
    [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    epoch = useRef(0),
    chartRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    rect: Rect;
    index: number;
  } | null>(null);
  const projectSnapshot = useMemo<QuickProject>(
    () => ({
      data,
      external,
      inspectReference,
      externalActive,
      active,
      reference,
      control,
      labels,
      polarity,
      selected,
      editing,
      editBackground,
      count,
      showBoxes,
    }),
    [
      data,
      external,
      inspectReference,
      externalActive,
      active,
      reference,
      control,
      labels,
      polarity,
      selected,
      editing,
      editBackground,
      count,
      showBoxes,
    ],
  );
  const snapshotRef = useRef(projectSnapshot);
  snapshotRef.current = projectSnapshot;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    let mounted = true;
    const dispose = connectProjectAdapter({
      tool: "wb-quick",
      exportProject: async () => {
        if (busyRef.current)
          throw new Error(
            t("请等待图片导入完成。", "Wait for image import to finish."),
          );
        const state = snapshotRef.current;
        const result = await exportQuickProject(state);
        return {
          blob: result.blob,
          name: `${(state.data?.image.name ?? "WB quick project").replace(/\.[^.]+$/, "")}.wisplab.zip`,
          format: "wisplab-wb-quick-v1.zip",
          summaryTranslations: {
            zh:
              result.completeness.join("\n") ||
              "保留原图、内参、样本名称、分行与手动取样框。",
            en:
              result.completeness.join("\n") ||
              "Preserves originals, reference images, sample names, rows and manual sampling boxes.",
          },
          summary:
            result.completeness.join("\n") ||
            t(
              "保留原图、内参、样本名称、分行与手动取样框。",
              "Preserves originals, reference images, sample names, rows and manual sampling boxes.",
            ),
        };
      },
      importProject: async (blob, options) => {
        const before = snapshotRef.current,
          version = epoch.current;
        const result = await importQuickProject(blob);
        const current = () =>
          options?.isCurrent?.() !== false &&
          mounted &&
          epoch.current === version &&
          snapshotRef.current === before;
        if (!current()) throw new DOMException("Cancelled", "AbortError");
        if (
          !window.confirm(
            t(
              "打开此版本会替换当前工作内容，是否继续？",
              "Opening this version replaces the current workspace. Continue?",
            ) +
              (result.completeness.length
                ? "\n\n" + result.completeness.join("\n")
                : ""),
          )
        )
          throw new DOMException("Cancelled", "AbortError");
        if (!current()) throw new DOMException("Cancelled", "AbortError");
        ++epoch.current;
        setBusy(false);
        drag.current = null;
        setDragging(false);
        const p = result.project;
        setData(p.data);
        setExternal(p.external);
        setInspectReference(p.inspectReference);
        setExternalActive(p.externalActive);
        setActive(p.active);
        setReference(p.reference);
        setControl(p.control);
        setLabels(p.labels);
        setPolarity(p.polarity);
        setSelected(p.selected);
        setEditing(p.editing);
        setEditBackground(p.editBackground);
        setCount(p.count);
        setShowBoxes(p.showBoxes);
        setError(result.completeness.join("\n"));
      },
    });
    return () => {
      mounted = false;
      ++epoch.current;
      dispose();
    };
  }, []);
  const row = data?.rows[active];
  const refParts = reference.split(":");
  const refSource = refParts[0] === "external" ? external : data;
  const refRow =
    reference === "none"
      ? null
      : (refSource?.rows[Number(refParts[1])] ?? null);
  const signals = useMemo(
    () =>
      row && data
        ? measureBands(
            row.gray,
            row.bounds.width,
            row.bounds.height,
            row.bands,
            data.polarity,
          )
        : [],
    [row, data],
  );
  const refSignals = useMemo(
    () =>
      refRow && refSource
        ? measureBands(
            refRow.gray,
            refRow.bounds.width,
            refRow.bounds.height,
            refRow.bands,
            refSource.polarity,
          )
        : null,
    [refRow, refSource],
  );
  const values = relativeSignals(signals, refSignals, control);
  const hasValues = values.some((v) => v != null);
  const laneLabels = signals.map((_, i) => labels[i] || f("泳道 {0}", i + 1));
  const displayData = inspectReference && external ? external : data;
  const displayIndex = inspectReference && external ? externalActive : active;
  const displayRow = displayData?.rows[displayIndex];
  const selectedBand = displayRow?.bands[selected];
  const selectedRect = editBackground
    ? selectedBand?.background
    : selectedBand?.rect;

  const replace = useCallback((loaded: Loaded) => {
    setData(loaded);
    setExternal(null);
    setInspectReference(false);
    setExternalActive(0);
    setActive(0);
    setReference("none");
    setControl(0);
    setLabels([]);
    setSelected(0);
    setEditing(false);
    setCount(loaded.rows[0]?.bands.length || 6);
  }, []);
  const importFile = useCallback(
    async (file: File, isReference = false) => {
      const id = ++epoch.current;
      setBusy(true);
      setError("");
      try {
        const img = await loadQuickImage(file);
        if (id !== epoch.current) return;
        const loaded = analyze(img, polarity);
        if (isReference) {
          setExternal(loaded);
          setExternalActive(0);
          setReference("external:0");
          setInspectReference(false);
        } else replace(loaded);
      } catch (e) {
        if (id === epoch.current) setError((e as Error).message);
      } finally {
        if (id === epoch.current) setBusy(false);
      }
    },
    [polarity, replace],
  );
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          'input,textarea,[contenteditable="true"]',
        )
      )
        return;
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        void importFile(file);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [importFile]);
  const example = async () => {
    const id = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const img = await createQuickExample();
      if (id === epoch.current) {
        setPolarity("dark");
        replace(analyze(img, "dark"));
      }
    } catch (e) {
      if (id === epoch.current) setError((e as Error).message);
    } finally {
      if (id === epoch.current) setBusy(false);
    }
  };
  const updateRow = (fn: (r: Row) => Row) =>
    setData((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((r, i) => (i === active ? fn(r) : r)),
          }
        : current,
    );
  const updateDisplayedRow = (fn: (r: Row) => Row) => {
    if (inspectReference && external)
      setExternal((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((r, i) =>
                i === externalActive ? fn(r) : r,
              ),
            }
          : current,
      );
    else updateRow(fn);
  };
  const changePolarity = (next: Polarity) => {
    epoch.current++;
    setBusy(false);
    setExternalActive(0);
    if (inspectReference && external) {
      setExternal(analyze(external.image, next));
      setReference("external:0");
      setSelected(0);
      setError("");
      return;
    }
    setPolarity(next);
    setError("");
    setSelected(0);
    setControl(0);
    setReference("none");
    setActive(0);
    if (data) setData(analyze(data.image, next));
  };
  const changeRow = (index: number) => {
    if (inspectReference && external) {
      setExternalActive(index);
      setReference(`external:${index}`);
      setSelected(0);
      setEditBackground(false);
      setCount(external.rows[index].bands.length || 6);
      return;
    }
    setActive(index);
    setSelected(0);
    setReference("none");
    setControl(0);
    setCount(data?.rows[index].bands.length || 6);
  };
  const patchRect = (
    index: number,
    rect: Rect,
    background = editBackground,
  ) => {
    if (!displayRow) return;
    const r = {
      x: Math.max(0, Math.min(displayRow.bounds.width - 1, Math.round(rect.x))),
      y: Math.max(
        0,
        Math.min(displayRow.bounds.height - 1, Math.round(rect.y)),
      ),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
    r.width = Math.min(r.width, displayRow.bounds.width - r.x);
    r.height = Math.min(r.height, displayRow.bounds.height - r.y);
    updateDisplayedRow((current) => ({
      ...current,
      bands: current.bands.map((b, i) =>
        i === index ? { ...b, [background ? "background" : "rect"]: r } : b,
      ),
    }));
  };
  const resample = (manual: boolean) => {
    if (!displayRow) return;
    setError("");
    try {
      const n = Math.max(
        1,
        Math.min(
          32,
          Math.floor(displayRow.bounds.width / 3),
          Math.round(count) || 1,
        ),
      );
      const result = detectBands(
        displayRow.gray,
        displayRow.bounds.width,
        displayRow.bounds.height,
        displayData?.polarity ?? polarity,
        manual ? n : undefined,
      );
      updateDisplayedRow((r) => ({ ...r, ...result }));
      setSelected(0);
      if (!inspectReference) setControl(0);
      setCount(result.bands.length || n);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pointerPosition = (e: PointerEvent<SVGSVGElement>) => {
    const matrix = e.currentTarget.getScreenCTM();
    return matrix
      ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
      : new DOMPoint();
  };
  const exportChart = async (png = false) => {
    if (!chartRef.current || !row) return;
    setExporting(true);
    setError("");
    const blob = new Blob(
      [new XMLSerializer().serializeToString(chartRef.current)],
      { type: "image/svg+xml;charset=utf-8" },
    );
    try {
      if (!png) save(blob, f("{0}-相对强度.svg", rowLabel(row)));
      else {
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 1560;
          canvas.height = 990;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error(tr("浏览器无法导出图表。"));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          if (!out) throw new Error(tr("PNG 导出失败，请导出 SVG。"));
          save(out, f("{0}-相对强度.png", rowLabel(row)));
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const exportCsv = () => {
    if (!row || !data) return;
    save(
      new Blob(
        [
          resultCsv({
            file: data.image.name,
            protein: rowLabel(row),
            polarity: data.polarity,
            labels: laneLabels,
            control,
            bands: row.bands,
            signals,
            reference: refSignals,
            referenceFile:
              reference === "none" ? "" : refSource?.image.name || "",
            referenceProtein: refRow ? rowLabel(refRow) : "",
            values,
            rowY: row.bounds.y,
            referenceBands: refRow?.bands,
            referenceRowY: refRow?.bounds.y,
            referencePolarity: refSource?.polarity,
            warnings,
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      f("{0}-结果.csv", rowLabel(row)),
    );
  };
  const warnings = [
    ...new Set([
      ...(data?.warnings ?? []),
      ...(row?.warnings ?? []),
      ...(reference !== "none"
        ? [...(refSource?.warnings ?? []), ...(refRow?.warnings ?? [])].map(
            (w) => f("内参：{0}", tr(w)),
          )
        : []),
      ...signals.flatMap((s, i) =>
        s.warning ? [f("泳道 {0}：{1}", i + 1, tr(s.warning))] : [],
      ),
      ...(refSignals && refSignals.length !== signals.length
        ? [
            tr(
              "内参与目标的泳道数量不同。请调整取样框，数量一致后才计算归一化结果。",
            ),
          ]
        : []),
      ...(refSignals?.flatMap((s, i) =>
        s.warning ? [f("内参泳道 {0}：{1}", i + 1, tr(s.warning))] : [],
      ) ?? []),
    ]),
  ];

  return (
    <div className="quick-app" lang={language === "zh" ? "zh-CN" : "en"}>
      <header className="quick-header">
        <a className="quick-brand" href={languageUrl("./")}>
          <span className="quick-brand-icon">
            <ScanLine size={23} />
          </span>
          <span>
            Blot Workbench<small>{tr("印迹工作台")}</small>
          </span>
          <span className="quick-version">{tr("简易版")}</span>
        </a>
        <nav aria-label={tr("模式")}>
          <span className="quick-active-mode">{tr("快速定量")}</span>
          <a href={languageUrl("?mode=single")}>{tr("单条带识别")}</a>
          <a href={languageUrl("?mode=project")}>
            {tr("项目演示")} <ArrowRight size={14} />
          </a>
        </nav>
      </header>
      <div className="strip-suite">
        <SuiteNav />
        <LanguageSwitch />
      </div>
      <main className="quick-main">
        <section className={`quick-intro ${data ? "has-data" : ""}`}>
          <div>
            <p className="quick-eyebrow">
              <span />{" "}
              {language === "zh"
                ? "少些点击，清楚看结果"
                : "LESS CLICKING, MORE CLARITY"}
            </p>
            <h1>
              {data ? tr("条带与结果，一眼对上。") : tr("导入条带，直接看结果")}
            </h1>
            <p>
              {data
                ? tr(
                    "自动取样、扣除背景、生成图表。检查框的位置，修改后结果随即更新。",
                  )
                : tr(
                    "放入一张 WB 图片，自动取样、扣背景、出图。单排条带和多排膜图都可以。",
                  )}
            </p>
          </div>
          <div className="quick-local">
            <ShieldCheck size={19} />
            <span>
              {tr("图片留在你的浏览器")}
              <small>{tr("无需账号 · 无需配置 API")}</small>
            </span>
          </div>
        </section>
        <input
          ref={input}
          className="quick-file"
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          aria-label={tr("导入条带图片")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <input
          ref={referenceInput}
          className="quick-file"
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          aria-label={tr("添加内参图片")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f, true);
          }}
        />
        {error && (
          <div className="quick-error" role="alert">
            {tr(error)}
            <button aria-label={tr("关闭提示")} onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <div role="status" className="quick-loading">
            <LoaderCircle size={17} className="quick-spin" />
            {tr("正在读取图片并生成结果…")}{" "}
          </div>
        )}
        <div className="quick-workspace">
          <section
            className="quick-panel quick-input-panel"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void importFile(f);
            }}
          >
            <div className="quick-panel-heading">
              <div>
                <span className="quick-step">01</span>
                <h2>{inspectReference ? tr("内参取样") : tr("条带图片")}</h2>
                {data && (
                  <span className="quick-pill">
                    {data.rows.length} {tr("排 ·")} {signals.length}{" "}
                    {tr("条")}{" "}
                  </span>
                )}
              </div>
              {data && (
                <button
                  disabled={busy}
                  className="quick-text-button"
                  onClick={() => input.current?.click()}
                >
                  <ImagePlus size={15} />
                  {tr("换一张")}{" "}
                </button>
              )}
            </div>
            {!displayData ? (
              <div
                className={`quick-dropzone ${dragging ? "is-dragging" : ""}`}
              >
                <div className="quick-upload-icon">
                  <ImagePlus size={32} />
                  <span>+</span>
                </div>
                <h3>{tr("把条带拖到这里")}</h3>
                <p>
                  {tr("或直接粘贴截图")} <kbd>⌘ / Ctrl + V</kbd>
                </p>
                <button
                  className="quick-primary"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  <Plus size={17} />
                  {tr("选择条带图片")}{" "}
                </button>
                <small>{tr("8-bit PNG / JPG · 最大 15 MB")}</small>
                <div className="quick-drop-divider">
                  <span />
                  {tr("还没有准备好图片？")} <span />
                </div>
                <button
                  className="quick-example"
                  disabled={busy}
                  onClick={() => void example()}
                >
                  <FlaskConical size={16} />
                  {tr("试用示例")} <ArrowRight size={14} />
                </button>
                <small>{tr("合成条带，仅用于体验")}</small>
              </div>
            ) : (
              <>
                <div className="quick-source">
                  <span title={displayData.image.name}>
                    {displayData.image.name}
                  </span>
                  <small>
                    {displayData.image.width} × {displayData.image.height} px
                  </small>
                </div>
                {displayData.rows.length > 1 && (
                  <div
                    className="quick-row-picker"
                    aria-label={tr("选择蛋白行")}
                  >
                    {displayData.rows.map((r, i) => (
                      <button
                        key={i}
                        aria-pressed={displayIndex === i}
                        onClick={() => changeRow(i)}
                      >
                        {f("第 {0} 排", i + 1)}
                        <span>
                          {r.bands.length} {tr("条")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {displayRow && (
                  <div
                    className={`quick-image-wrap ${dragging ? "is-dragging" : ""}`}
                  >
                    <svg
                      className="quick-image"
                      viewBox={`${displayRow.bounds.x} ${displayRow.bounds.y} ${displayRow.bounds.width} ${displayRow.bounds.height}`}
                      role="img"
                      aria-label={tr("原图与取样框")}
                      onPointerMove={(e) => {
                        if (!drag.current) return;
                        const p = pointerPosition(e);
                        const d = drag.current;
                        patchRect(
                          d.index,
                          {
                            ...d.rect,
                            x: Math.max(
                              0,
                              Math.min(
                                displayRow.bounds.width - d.rect.width,
                                d.rect.x + p.x - d.x,
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                displayRow.bounds.height - d.rect.height,
                                d.rect.y + p.y - d.y,
                              ),
                            ),
                          },
                          false,
                        );
                      }}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                    >
                      <image
                        href={displayData.image.dataUrl}
                        width={displayData.image.width}
                        height={displayData.image.height}
                      />
                      {showBoxes &&
                        displayRow.bands.map((b, i) => (
                          <g key={b.id}>
                            {b.background && (
                              <rect
                                x={b.background.x + displayRow.bounds.x}
                                y={b.background.y + displayRow.bounds.y}
                                width={b.background.width}
                                height={b.background.height}
                                fill="#c49a4520"
                                stroke="#c19244"
                                strokeWidth="1.3"
                                strokeDasharray="4 3"
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                            <rect
                              className="quick-roi"
                              role="button"
                              aria-label={f("泳道 {0} 取样框", i + 1)}
                              tabIndex={0}
                              x={b.rect.x + displayRow.bounds.x}
                              y={b.rect.y + displayRow.bounds.y}
                              width={b.rect.width}
                              height={b.rect.height}
                              fill={selected === i ? "#4f46e522" : "#4f46e508"}
                              stroke={selected === i ? "#4338ca" : "#818cf8"}
                              strokeWidth={selected === i ? 2 : 1.2}
                              vectorEffect="non-scaling-stroke"
                              onPointerDown={(e) => {
                                setSelected(i);
                                setEditBackground(false);
                                const svg = e.currentTarget.ownerSVGElement;
                                if (!svg) return;
                                const m = svg.getScreenCTM();
                                if (!m) return;
                                const p = new DOMPoint(
                                  e.clientX,
                                  e.clientY,
                                ).matrixTransform(m.inverse());
                                drag.current = {
                                  x: p.x,
                                  y: p.y,
                                  rect: b.rect,
                                  index: i,
                                };
                                svg.setPointerCapture(e.pointerId);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setSelected(i);
                                  setEditing(true);
                                }
                                const offsets: Record<
                                  string,
                                  [number, number]
                                > = {
                                  ArrowLeft: [-1, 0],
                                  ArrowRight: [1, 0],
                                  ArrowUp: [0, -1],
                                  ArrowDown: [0, 1],
                                };
                                const offset = offsets[e.key];
                                if (offset) {
                                  e.preventDefault();
                                  setSelected(i);
                                  setEditBackground(false);
                                  patchRect(
                                    i,
                                    {
                                      ...b.rect,
                                      x: b.rect.x + offset[0],
                                      y: b.rect.y + offset[1],
                                    },
                                    false,
                                  );
                                }
                              }}
                            />
                            <text
                              x={
                                b.rect.x +
                                b.rect.width / 2 +
                                displayRow.bounds.x
                              }
                              y={Math.max(
                                displayRow.bounds.y + 10,
                                b.rect.y + displayRow.bounds.y - 4,
                              )}
                              textAnchor="middle"
                              fill="#4338ca"
                              fontSize={Math.max(
                                9,
                                displayRow.bounds.width / 65,
                              )}
                              fontWeight="600"
                              pointerEvents="none"
                            >
                              {i + 1}
                            </text>
                          </g>
                        ))}
                    </svg>
                  </div>
                )}
                <div className="quick-image-legend">
                  <span>
                    <i />
                    {tr("条带取样")}{" "}
                  </span>
                  <span>
                    <i />
                    {tr("背景取样")}{" "}
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={showBoxes}
                      onChange={(e) => setShowBoxes(e.target.checked)}
                    />
                    {tr("显示取样框")}{" "}
                  </label>
                </div>
                <div className="quick-settings-line">
                  <label>
                    {tr("图像类型")}{" "}
                    <select
                      aria-label={tr("图像类型")}
                      disabled={busy}
                      value={displayData.polarity}
                      onChange={(e) =>
                        changePolarity(e.target.value as Polarity)
                      }
                    >
                      <option value="dark">{tr("浅底 · 深色条带")}</option>
                      <option value="light">{tr("深底 · 浅色条带")}</option>
                    </select>
                  </label>
                  <button
                    className="quick-secondary"
                    aria-expanded={editing}
                    onClick={() => setEditing(!editing)}
                  >
                    <SlidersHorizontal size={15} />
                    {tr("调整取样框")} <ChevronDown size={13} />
                  </button>
                </div>
                {editing && displayRow && (
                  <div className="quick-editor">
                    <div className="quick-editor-count">
                      <label>
                        {tr("泳道数量")}{" "}
                        <input
                          aria-label={tr("泳道数量")}
                          type="number"
                          min="1"
                          max="32"
                          value={count}
                          onChange={(e) => setCount(Number(e.target.value))}
                        />
                      </label>
                      <button
                        className="quick-secondary"
                        onClick={() => resample(true)}
                      >
                        {tr("按数量重新取样")}{" "}
                      </button>
                      <button
                        className="quick-text-button"
                        aria-label={tr("恢复自动取样")}
                        onClick={() => resample(false)}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                    <p>
                      {tr(
                        "数量不对时重新取样；拖动绿色框可微调位置，方向键移动 1 像素。",
                      )}{" "}
                    </p>
                    {!!displayRow.bands.length && (
                      <>
                        <div className="quick-editor-choice">
                          <select
                            aria-label={tr("编辑泳道")}
                            value={selected}
                            onChange={(e) =>
                              setSelected(Number(e.target.value))
                            }
                          >
                            {displayRow.bands.map((_, i) => (
                              <option key={i} value={i}>
                                {tr("泳道")} {i + 1}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={tr("编辑取样类型")}
                            value={editBackground ? "background" : "band"}
                            onChange={(e) =>
                              setEditBackground(e.target.value === "background")
                            }
                          >
                            <option value="band">{tr("条带框")}</option>
                            <option value="background">{tr("背景框")}</option>
                          </select>
                        </div>
                        {selectedRect ? (
                          <div className="quick-coordinates">
                            {(["x", "y", "width", "height"] as const).map(
                              (key, i) => (
                                <label key={key}>
                                  {["X", "Y", tr("宽"), tr("高")][i]}
                                  <input
                                    aria-label={f("取样框 {0}", key)}
                                    type="number"
                                    value={selectedRect[key]}
                                    onChange={(e) => {
                                      const value = Number(e.target.value);
                                      if (Number.isFinite(value))
                                        patchRect(selected, {
                                          ...selectedRect,
                                          [key]: value,
                                        });
                                    }}
                                  />
                                </label>
                              ),
                            )}
                          </div>
                        ) : (
                          <button
                            className="quick-secondary"
                            onClick={() =>
                              patchRect(selected, {
                                x: selectedBand?.rect.x || 0,
                                y: 0,
                                width: selectedBand?.rect.width || 10,
                                height: Math.max(
                                  1,
                                  Math.min(5, displayRow.bounds.height),
                                ),
                              })
                            }
                          >
                            {tr("添加背景框，再调整位置")}{" "}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {!!warnings.length && (
                  <details className="quick-checks" open={!hasValues}>
                    <summary>
                      {f("有 {0} 项取样提示", warnings.length)}{" "}
                      <ChevronDown size={14} />
                    </summary>
                    <ul>
                      {warnings.map((w) => (
                        <li key={w}>{tr(w)}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="quick-reference">
                  <div>
                    <Layers size={17} />
                    <span>
                      {tr("需要内参归一化？")}{" "}
                      <small>{tr("添加同一膜、相同泳道顺序的内参图片")}</small>
                    </span>
                  </div>
                  <button
                    className="quick-secondary"
                    disabled={busy}
                    onClick={() => referenceInput.current?.click()}
                  >
                    <Plus size={15} />
                    {tr("添加内参")}{" "}
                  </button>
                </div>
                {external && (
                  <div className="quick-reference-preview">
                    <span>
                      {tr("内参文件：")}
                      {external.image.name}
                    </span>
                    <button
                      className="quick-secondary"
                      onClick={() => {
                        setInspectReference(!inspectReference);
                        setSelected(0);
                        setEditBackground(false);
                        setEditing(true);
                        setCount(
                          (inspectReference
                            ? row
                            : external.rows[externalActive]
                          )?.bands.length || 6,
                        );
                      }}
                    >
                      {inspectReference
                        ? tr("返回目标条带")
                        : tr("调整内参取样")}
                    </button>
                    <img
                      src={external.image.dataUrl}
                      alt={tr("已导入的内参图片")}
                    />
                    <button
                      className="quick-text-button"
                      onClick={() => {
                        setExternal(null);
                        setInspectReference(false);
                        setSelected(0);
                        setReference("none");
                      }}
                    >
                      {tr("移除内参图片")}{" "}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="quick-panel quick-results-panel">
            <div className="quick-panel-heading">
              <div>
                <span className="quick-step">02</span>
                <h2>{tr("定量结果")}</h2>
              </div>
              <span
                className={`quick-result-state ${hasValues ? "ready" : ""}`}
              >
                {data ? (
                  hasValues ? (
                    <>
                      <Check size={13} />
                      {tr("已生成 · 待核对")}{" "}
                    </>
                  ) : (
                    tr("等待调整取样")
                  )
                ) : (
                  tr("导入后自动生成")
                )}
              </span>
            </div>
            {!data ? (
              <div className="quick-result-placeholder">
                <div className="quick-preview-bars" aria-hidden="true">
                  {[42, 68, 54, 92, 120, 84].map((h, i) => (
                    <span key={i} style={{ height: h }} />
                  ))}
                </div>
                <h3>{tr("你的结果，就在这里")}</h3>
                <p>
                  {tr("图片与图表并排，变化一眼可见。")} <br />
                  {tr("无需翻页，也不用逐步点击分析。")}{" "}
                </p>
                <div className="quick-result-features">
                  <span>
                    <Check size={14} />
                    {tr("自动扣背景")}{" "}
                  </span>
                  <span>
                    <Check size={14} />
                    {tr("对照倍数")}{" "}
                  </span>
                  <span>
                    <Check size={14} />
                    {tr("图表与 CSV")}{" "}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="quick-result-controls">
                  <label>
                    {tr("蛋白名称")}{" "}
                    <input
                      aria-label={tr("蛋白名称")}
                      value={row ? rowLabel(row) : ""}
                      onChange={(e) =>
                        updateRow((r) => ({
                          ...r,
                          label: e.target.value.slice(0, 80),
                          automaticLabel: undefined,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {tr("对照 = 1")}{" "}
                    <select
                      aria-label={tr("对照泳道")}
                      value={control}
                      onChange={(e) => setControl(Number(e.target.value))}
                    >
                      {signals.map((_, i) => (
                        <option key={i} value={i}>
                          {laneLabels[i]}
                          {i === 0 ? tr("（默认）") : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr("内参")}{" "}
                    <select
                      aria-label={tr("内参条带")}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    >
                      <option value="none">{tr("不使用内参")}</option>
                      {data.rows.map(
                        (r, i) =>
                          i !== active && (
                            <option key={`row:${i}`} value={`row:${i}`}>
                              {f("第 {0} 排", i + 1)} · {rowLabel(r)}
                            </option>
                          ),
                      )}
                      {external?.rows.map((r, i) => (
                        <option key={`external:${i}`} value={`external:${i}`}>
                          {tr("内参文件 ·")} {rowLabel(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="quick-method-note">
                  {reference === "none"
                    ? tr("当前为扣背景后的相对灰度，未做内参归一化。")
                    : tr(
                        "目标 / 内参，按从左到右配对后相对对照。请核对样本对应关系。",
                      )}
                </p>
                {signals.length ? (
                  <Plot
                    values={values}
                    labels={laneLabels}
                    protein={row ? rowLabel(row) : tr("条带")}
                    control={control}
                    reference={reference !== "none"}
                    chartRef={chartRef}
                  />
                ) : (
                  <div className="quick-no-result">
                    <ScanLine size={30} />
                    <h3>{tr("还没有找到清晰条带")}</h3>
                    <p>
                      {tr(
                        "检查图像类型，或在左侧“调整取样框”中指定泳道数量。尽量使用裁去标签和边框的 WB 图片。",
                      )}{" "}
                    </p>
                  </div>
                )}
                {!!signals.length && !hasValues && (
                  <p role="status" className="quick-invalid-note">
                    {tr(
                      "暂时无法计算相对值，请检查取样背景、对照和内参。无效值显示为“—”。",
                    )}{" "}
                  </p>
                )}
                <div className="quick-export-row">
                  <button
                    className="quick-primary"
                    disabled={!hasValues || exporting}
                    onClick={() => void exportChart(true)}
                  >
                    <ArrowDownToLine size={15} />
                    {tr("导出 PNG")}{" "}
                  </button>
                  <button
                    className="quick-secondary"
                    disabled={!hasValues || exporting}
                    onClick={() => void exportChart()}
                  >
                    {tr("导出 SVG")}{" "}
                  </button>
                  <button
                    className="quick-secondary"
                    disabled={!signals.length}
                    onClick={exportCsv}
                  >
                    {tr("导出 CSV")}{" "}
                  </button>
                </div>
                {!!signals.length && (
                  <div className="quick-table-wrap">
                    <table
                      className="quick-table"
                      aria-label={tr("条带定量结果")}
                    >
                      <thead>
                        <tr>
                          <th>{tr("泳道 / 样本")}</th>
                          <th>{tr("净信号")}</th>
                          {refSignals && <th>{tr("内参净信号")}</th>}
                          <th>{tr("相对值")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.map((s, i) => (
                          <tr
                            key={s.id}
                            className={i === selected ? "selected" : ""}
                          >
                            <td>
                              <i
                                style={{
                                  background: palette[i % palette.length],
                                }}
                              />
                              <input
                                aria-label={f("泳道 {0} 名称", i + 1)}
                                value={laneLabels[i]}
                                onFocus={() => setSelected(i)}
                                onChange={(e) =>
                                  setLabels((current) => {
                                    const next = [...current];
                                    next[i] = e.target.value.slice(0, 50);
                                    return next;
                                  })
                                }
                              />
                              {i === control && <small>{tr("对照")}</small>}
                            </td>
                            <td>{pretty(s.net, 0)}</td>
                            {refSignals && (
                              <td>{pretty(refSignals[i]?.net, 0)}</td>
                            )}
                            <td data-testid={`relative-${i + 1}`}>
                              {values[i] == null
                                ? "—"
                                : `${pretty(values[i])}×`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="quick-result-footnote">
                  {tr(
                    "净信号 = 条带积分 − 背景均值 × 取样面积。每根柱代表一条泳道，不自动推断生物学重复或显著性。",
                  )}{" "}
                </p>
              </>
            )}
          </section>
        </div>
        <footer className="quick-footer">
          <span>
            <ShieldCheck size={14} />
            {tr("本机计算。刷新前请下载项目文件或导出结果。")}{" "}
          </span>
          <span>
            {tr(
              "8-bit 像素估计 · 自动取样需核对 · 原始 TIFF / 16-bit 请保留原始定量流程",
            )}{" "}
          </span>
          <a href={languageUrl("?mode=project")}>
            {tr("多批次项目演示")} <ArrowRight size={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}
