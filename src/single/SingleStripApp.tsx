import { connectProjectAdapter } from "../project-archive";
import {
  exportSingleProject,
  importSingleProject,
  type SingleProject,
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
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  ImagePlus,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { type Rect } from "../quick/analysis";
import {
  createQuickExample,
  loadQuickImage,
  type QuickImage,
} from "../quick/image";
import { relativeSignals, resultCsv } from "../quick/results";
import { recognizeSingle, type SinglePolarity } from "./model";
import {
  prepareRaster,
  measurePreparedBands,
  type PreparedRaster,
  type PreparationConfig,
} from "./preparation";
import StripPreparation, {
  rasterPreview,
  type Appearance,
} from "./StripPreparation";
import "./single.css";

type Strip = {
  id: string;
  image: QuickImage;
  prepared: PreparedRaster;
  config: PreparationConfig;
  appearance: Appearance;
  mode: SinglePolarity;
  control: number;
  count: number;
  selected: number;
} & ReturnType<typeof recognizeSingle>;
const MAX_EXPOSURES = 6;
const MAX_EXPOSURE_PIXELS = 30_000_000;

function newStrip(image: QuickImage, mode: SinglePolarity): Strip {
  const prepared = prepareRaster(image);
  const result = recognizeSingle(
    image,
    mode === "auto" ? prepared.polarity : mode,
  );
  return {
    id: crypto.randomUUID(),
    image,
    prepared,
    config: {},
    appearance: { brightness: 100, contrast: 100 },
    mode,
    control: 0,
    count: result.bands.length || 6,
    selected: 0,
    ...result,
  };
}
const number = (value: number | null) =>
  value == null
    ? "—"
    : value > 0 && value < 0.01
      ? value.toExponential(2)
      : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function SingleStripApp() {
  const { language } = useLanguage();
  const [strips, setStrips] = useState<Strip[]>([]);
  const [activeId, setActiveId] = useState("");
  const strip = strips.find((entry) => entry.id === activeId) ?? null;
  const setStrip = useCallback(
    (next: Strip | null | ((current: Strip | null) => Strip | null)) => {
      setStrips((entries) =>
        entries.flatMap((entry) => {
          if (entry.id !== activeId) return [entry];
          const changed = typeof next === "function" ? next(entry) : next;
          return changed ? [changed] : [];
        }),
      );
    },
    [activeId],
  );
  const mode = strip?.mode ?? "auto";
  const control = strip?.control ?? 0,
    count = strip?.count ?? 6,
    selected = strip?.selected ?? 0;
  const setMode = (mode: SinglePolarity) =>
    setStrip((current) => current && { ...current, mode });
  const setControl = (control: number) =>
    setStrip((current) => current && { ...current, control });
  const setCount = (count: number) =>
    setStrip((current) => current && { ...current, count });
  const setSelected = (selected: number) =>
    setStrip((current) => current && { ...current, selected });
  const [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<{ file?: string; message: string }[]>([]),
    [hover, setHover] = useState(false);
  const setError = (message: string) => setErrors(message ? [{ message }] : []);
  const [editing, setEditing] = useState(false),
    [kind, setKind] = useState<"rect" | "background">("rect");
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    exposureInput = useRef<HTMLInputElement>(null),
    chart = useRef<SVGSVGElement>(null),
    epoch = useRef(0);
  const drag = useRef<{
    x: number;
    y: number;
    rect: Rect;
    index: number;
  } | null>(null);
  const projectSnapshot = useMemo<SingleProject>(
    () => ({ strips, activeId, editing, kind }),
    [strips, activeId, editing, kind],
  );
  const snapshotRef = useRef(projectSnapshot);
  snapshotRef.current = projectSnapshot;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [restoration, setRestoration] = useState(0);
  useEffect(() => {
    let mounted = true;
    const dispose = connectProjectAdapter({
      tool: "wb-single",
      exportProject: async () => {
        if (busyRef.current)
          throw new Error(
            t("请等待图片导入完成。", "Wait for image import to finish."),
          );
        const state = snapshotRef.current;
        const result = await exportSingleProject(state);
        return {
          blob: result.blob,
          name: `${(state.strips.find((s) => s.id === state.activeId)?.image.name ?? "WB single strip").replace(/\.[^.]+$/, "")}.wisplab.zip`,
          format: "wisplab-wb-single-v1.zip",
          summaryTranslations: {
            zh:
              result.completeness.join("\n") ||
              "保留原图、多曝光、校直裁剪、手动取样框和显示设置。",
            en:
              result.completeness.join("\n") ||
              "Preserves originals, exposures, geometry, manual sampling boxes and display settings.",
          },
          summary:
            result.completeness.join("\n") ||
            t(
              "保留原图、多曝光、校直裁剪、手动取样框和显示设置。",
              "Preserves originals, exposures, geometry, manual sampling boxes and display settings.",
            ),
        };
      },
      importProject: async (blob, options) => {
        const before = snapshotRef.current,
          version = epoch.current;
        const result = await importSingleProject(blob);
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
        setStrips(result.project.strips);
        setActiveId(result.project.activeId);
        setEditing(result.project.editing);
        setKind(result.project.kind);
        drag.current = null;
        setHover(false);
        setErrors(result.completeness.map((message) => ({ message })));
        setRestoration((n) => n + 1);
      },
    });
    return () => {
      mounted = false;
      ++epoch.current;
      dispose();
    };
  }, []);
  const signals = useMemo(
    () =>
      strip
        ? measurePreparedBands(strip.prepared, strip.bands, strip.polarity)
        : [],
    [strip?.prepared, strip?.bands, strip?.polarity],
  );
  const values = relativeSignals(signals, null, control),
    valid = values.some((v) => v != null);
  const warnings = [
    ...new Set([
      ...(strip?.warnings ?? []),
      ...signals.flatMap((s, i) =>
        s.warning ? [f("泳道 {0}：{1}", i + 1, tr(s.warning))] : [],
      ),
    ]),
  ];
  const rect = strip?.bands[selected]?.[kind];
  const replace = useCallback((image: QuickImage, polarity: SinglePolarity) => {
    const next = newStrip(image, polarity);
    setStrips([next]);
    setActiveId(next.id);
    setEditing(false);
    setKind("rect");
    drag.current = null;
  }, []);
  const load = useCallback(
    async (files: File[], append = false) => {
      if (!files.length) return;
      const id = ++epoch.current;
      setBusy(true);
      setError("");
      const retained = append ? strips : [];
      const loaded: Strip[] = [];
      const failures: { file?: string; message: string }[] = [];
      let pixels = retained.reduce(
        (sum, entry) =>
          sum + entry.prepared.source.width * entry.prepared.source.height,
        0,
      );
      const room = MAX_EXPOSURES - retained.length;
      if (files.length > room)
        failures.push({
          message: t(
            "一次最多保留 6 张曝光图，多出的文件未导入。",
            "Keep up to 6 exposures at a time. Extra files were not imported.",
          ),
        });
      try {
        for (const file of files.slice(0, room)) {
          if (epoch.current !== id) return;
          try {
            const image = await loadQuickImage(file);
            if (epoch.current !== id) return;
            if (pixels + image.width * image.height > MAX_EXPOSURE_PIXELS) {
              failures.push({
                file: file.name,
                message: t(
                  "曝光图总像素超过 3000 万，请移除部分图片后再添加。",
                  "The exposures exceed 30 million pixels in total. Remove an image before adding more.",
                ),
              });
              continue;
            }
            loaded.push(newStrip(image, "auto"));
            pixels += image.width * image.height;
          } catch (e) {
            failures.push({ file: file.name, message: (e as Error).message });
          }
        }
        if (epoch.current !== id) return;
        if (loaded.length) {
          setStrips((current) => [...(append ? current : []), ...loaded]);
          setActiveId(loaded[0].id);
          setEditing(false);
          setKind("rect");
          drag.current = null;
        }
        if (failures.length) {
          if (!loaded.length && strip)
            failures.push({ message: "仍显示上一张图片。" });
          setErrors(failures);
        }
      } finally {
        if (epoch.current === id) setBusy(false);
      }
    },
    [strips, strip],
  );
  const chooseExposure = (id: string) => {
    drag.current = null;
    setEditing(false);
    setKind("rect");
    setError("");
    setActiveId(id);
  };
  const removeExposure = () => {
    if (!strip) return;
    const remaining = strips.filter((entry) => entry.id !== strip.id);
    setStrips(remaining);
    chooseExposure(remaining[0]?.id ?? "");
  };
  const applyPreparation = (config: PreparationConfig) => {
    if (!strip || busy) return false;
    try {
      const prepared = prepareRaster(strip.prepared.source, config);
      const image = rasterPreview(prepared);
      const result = recognizeSingle(
        image,
        mode === "auto" ? prepared.polarity : mode,
      );
      setStrip({
        ...strip,
        image,
        prepared,
        config,
        ...result,
        control: 0,
        selected: 0,
        count: result.bands.length || 6,
      });
      setEditing(false);
      setKind("rect");
      setError("");
      drag.current = null;
      return true;
    } catch (e) {
      setError(tr((e as Error).message));
      return false;
    }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          'input,textarea,[contenteditable="true"]',
        )
      )
        return;
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        void load([file]);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [load]);
  const sample = () => {
    ++epoch.current;
    setBusy(false);
    setError("");
    setMode("auto");
    replace(createQuickExample(), "auto");
  };
  const reanalyze = (next: SinglePolarity, manual = false) => {
    if (!strip) return;
    setError("");
    try {
      const result = recognizeSingle(
        strip.image,
        next === "auto" ? strip.prepared.polarity : next,
        manual
          ? Math.max(
              1,
              Math.min(
                32,
                Math.floor(strip.image.width / 3),
                Math.round(count) || 1,
              ),
            )
          : undefined,
      );
      setStrip({ ...strip, ...result });
      setMode(next);
      setControl(0);
      setSelected(0);
      setCount(result.bands.length || count);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const changeRect = (
    index: number,
    next: Rect,
    target: "rect" | "background" = kind,
  ) => {
    if (!strip || busy) return;
    const width = Math.max(
        1,
        Math.min(strip.image.width, Math.round(next.width)),
      ),
      height = Math.max(
        1,
        Math.min(strip.image.height, Math.round(next.height)),
      );
    const x = Math.max(
        0,
        Math.min(strip.image.width - width, Math.round(next.x)),
      ),
      y = Math.max(
        0,
        Math.min(strip.image.height - height, Math.round(next.y)),
      );
    const bounded = {
      x,
      y,
      width,
      height,
    };
    setStrip((current) =>
      current
        ? {
            ...current,
            bands: current.bands.map((b, i) =>
              i === index ? { ...b, [target]: bounded } : b,
            ),
          }
        : current,
    );
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const m = event.currentTarget.getScreenCTM();
    if (!m || !drag.current || !strip || busy) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        m.inverse(),
      ),
      d = drag.current;
    changeRect(
      d.index,
      {
        ...d.rect,
        x: Math.max(
          0,
          Math.min(strip.image.width - d.rect.width, d.rect.x + p.x - d.x),
        ),
        y: Math.max(
          0,
          Math.min(strip.image.height - d.rect.height, d.rect.y + p.y - d.y),
        ),
      },
      "rect",
    );
  };
  const exportStem = strip
    ? `${strip.image.name
        .replace(/\.[^.]+$/, "")
        .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
        .slice(0, 64)}-${strip.id.slice(0, 8)}`
    : "single-strip";
  const exportCsv = () => {
    if (!strip) return;
    download(
      new Blob(
        [
          resultCsv({
            file: strip.image.name,
            protein: strip.image.name.replace(/\.[^.]+$/, ""),
            polarity: strip.polarity,
            labels: signals.map((_, i) => f("泳道 {0}", i + 1)),
            control,
            bands: strip.bands,
            signals: signals.map((signal) => ({
              ...signal,
              warning: signal.warning ? tr(signal.warning) : undefined,
            })),
            reference: null,
            referenceFile: "",
            referenceProtein: "",
            values,
            rowY: 0,
            warnings,
            preparation: {
              exposureId: strip.id,
              sourceWidth: strip.prepared.source.width,
              sourceHeight: strip.prepared.source.height,
              metadata: strip.prepared.metadata,
              transformed: !!(
                strip.config.straighten ||
                strip.config.curve ||
                strip.config.crop
              ),
              areas: signals.map((signal) => ({
                source: signal.sourceArea,
                background: signal.backgroundSourceArea,
              })),
            },
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      `${exportStem}-${tr("单条带识别-结果.csv")}`,
    );
  };
  const exportImage = async () => {
    if (!chart.current || !strip) return;
    setExporting(true);
    setError("");
    const blob = new Blob(
        [new XMLSerializer().serializeToString(chart.current)],
        { type: "image/svg+xml;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1040;
      canvas.height = (signals.length * 40 + 100) * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(tr("浏览器无法导出图片，请导出 CSV。"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!png) throw new Error(tr("图片导出失败，请导出 CSV。"));
      download(png, `${exportStem}-${tr("单条带识别-结果.png")}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
      setExporting(false);
    }
  };
  const max = Math.max(1, ...values.filter((v): v is number => v != null));

  return (
    <div className="single-app" lang={language === "zh" ? "zh-CN" : "en"}>
      <header className="single-header">
        <a href={languageUrl("./")} className="single-back">
          <ArrowLeft size={16} />
          {tr("返回工作台")}{" "}
        </a>
        <a href={languageUrl("?mode=single")} className="single-brand">
          <ScanLine size={19} />
          Blot <span>{tr("单条带识别")}</span>
        </a>
        <span className="single-local">
          <ShieldCheck size={14} />
          {tr("本机分析 · 本地项目保存")}{" "}
        </span>
      </header>
      <div className="strip-suite">
        <SuiteNav />
        <LanguageSwitch />
      </div>
      <main className="single-main">
        <div className="single-heading">
          <span className="single-kicker">
            {t("导入 · 看清 · 看结果", "Import · Inspect · See results")}
          </span>
          <h1>{tr("单条带识别")}</h1>
          <p>
            {t(
              "导入条带图，自动看结果；倾斜、多排或多张曝光，也能在这里整理。",
              "Import a strip and see results. Straighten, select a row, or compare exposures here.",
            )}
          </p>
        </div>
        <input
          ref={input}
          hidden
          type="file"
          multiple
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          aria-label={tr("导入单排条带图片")}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void load(files);
          }}
        />
        <input
          ref={exposureInput}
          hidden
          type="file"
          multiple
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          aria-label={t("添加曝光图片", "Add exposure images")}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void load(files, true);
          }}
        />
        {!!errors.length && (
          <div className="single-error" role="alert">
            <div>
              {errors.map((error, index) => (
                <p key={index}>
                  {error.file && <>{error.file}: </>}
                  {error.file
                    ? f("导入失败：{0}{1}", tr(error.message), "")
                    : tr(error.message)}
                </p>
              ))}
            </div>
            <button onClick={() => setError("")} aria-label={tr("关闭提示")}>
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <p className="single-loading" role="status">
            <LoaderCircle size={16} />
            {tr("正在识别条带…")}{" "}
          </p>
        )}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setHover(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setHover(false);
            void load(Array.from(e.dataTransfer.files));
          }}
          className={hover ? "single-drop-active" : ""}
        >
          {!strip ? (
            <section className="single-upload">
              <div className="single-upload-icon">
                <ImagePlus size={32} />
              </div>
              <h2>{tr("拖入你的条带图片")}</h2>
              <p>{tr("也可以粘贴截图，或从电脑中选择")}</p>
              <button
                disabled={busy}
                className="single-primary"
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                {tr("导入图片")}{" "}
              </button>
              <small>
                {t(
                  "8-bit PNG / JPG · 每张最大 15 MB · 可同时选择多张曝光图",
                  "8-bit PNG / JPG · Up to 15 MB each · Select several exposures together",
                )}
              </small>
              <div className="single-example-line">
                <span>{tr("先看看效果")}</span>
                <button disabled={busy} onClick={sample}>
                  {tr("试用示例")} <ArrowRight size={14} />
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="single-filebar">
                <span title={strip.image.name}>
                  <ImagePlus size={15} />
                  {strip.image.name}
                </span>
                <div className="single-file-actions">
                  <button
                    disabled={busy || strips.length >= MAX_EXPOSURES}
                    onClick={() => exposureInput.current?.click()}
                  >
                    {t("添加曝光图", "Add exposure")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    {tr("更换图片")}
                  </button>
                  <button disabled={busy} onClick={removeExposure}>
                    {t("移除此图", "Remove image")}
                  </button>
                </div>
              </div>
              {strips.length > 1 && (
                <section
                  className="single-exposures"
                  aria-label={t("选择曝光图", "Choose an exposure")}
                >
                  <div
                    role="tablist"
                    aria-label={t("曝光图片", "Exposure images")}
                  >
                    {strips.map((entry, i) => (
                      <button
                        key={entry.id}
                        role="tab"
                        aria-selected={entry.id === activeId}
                        disabled={busy}
                        onClick={() => chooseExposure(entry.id)}
                        aria-label={entry.image.name}
                      >
                        <img src={entry.prepared.source.dataUrl} alt="" />
                        <span>
                          <small>{i + 1}</small>
                          {entry.image.name}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p>
                    {t(
                      "点击切换当前曝光；每张图分别保留取样和显示设置，结果不会混合。",
                      "Select an exposure. Each keeps its own regions and display settings; results are kept separate.",
                    )}
                  </p>
                </section>
              )}
              <div className="single-columns">
                <section className="single-card single-source">
                  <div className="single-card-title">
                    <h2>{tr("条带图片")}</h2>
                    <span>
                      {strip.bands.length
                        ? f("识别到 {0} 条", strip.bands.length)
                        : tr("等待调整")}
                    </span>
                  </div>
                  <StripPreparation
                    key={`${strip.id}:${restoration}`}
                    image={strip.image}
                    prepared={strip.prepared}
                    config={strip.config}
                    appearance={strip.appearance}
                    onAppearance={(appearance) =>
                      setStrip(
                        (current) => current && { ...current, appearance },
                      )
                    }
                    onApply={applyPreparation}
                    disabled={busy}
                    onPointerMove={move}
                    onPointerEnd={() => {
                      drag.current = null;
                    }}
                  >
                    {strip.bands.map((b, i) => (
                      <g key={b.id}>
                        {b.background && (
                          <rect
                            {...b.background}
                            fill="none"
                            stroke="#be955b"
                            strokeWidth="1"
                            strokeDasharray="4 3"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        <rect
                          {...b.rect}
                          className="single-roi"
                          role="button"
                          aria-label={f("泳道 {0} 取样框", i + 1)}
                          tabIndex={0}
                          fill={selected === i ? "#4f46e515" : "#4f46e503"}
                          stroke={selected === i ? "#4338ca" : "#818cf8"}
                          strokeWidth={selected === i ? 2 : 1.2}
                          vectorEffect="non-scaling-stroke"
                          onPointerDown={(e) => {
                            if (busy) return;
                            const svg = e.currentTarget.ownerSVGElement,
                              m = svg?.getScreenCTM();
                            if (!m || !svg) return;
                            const p = new DOMPoint(
                              e.clientX,
                              e.clientY,
                            ).matrixTransform(m.inverse());
                            setSelected(i);
                            setKind("rect");
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
                              setKind("rect");
                              setEditing(true);
                            }
                            const delta: Record<string, [number, number]> = {
                              ArrowLeft: [-1, 0],
                              ArrowRight: [1, 0],
                              ArrowUp: [0, -1],
                              ArrowDown: [0, 1],
                            };
                            const d = delta[e.key];
                            if (d) {
                              e.preventDefault();
                              setSelected(i);
                              setKind("rect");
                              changeRect(
                                i,
                                {
                                  ...b.rect,
                                  x: Math.max(
                                    0,
                                    Math.min(
                                      strip.image.width - b.rect.width,
                                      b.rect.x + d[0],
                                    ),
                                  ),
                                  y: Math.max(
                                    0,
                                    Math.min(
                                      strip.image.height - b.rect.height,
                                      b.rect.y + d[1],
                                    ),
                                  ),
                                },
                                "rect",
                              );
                            }
                          }}
                        />
                        <text
                          x={b.rect.x + b.rect.width / 2}
                          y={Math.max(10, b.rect.y - 5)}
                          fontSize={Math.max(10, strip.image.width / 55)}
                          fill="#4338ca"
                          textAnchor="middle"
                          pointerEvents="none"
                        >
                          {i + 1}
                        </text>
                      </g>
                    ))}
                  </StripPreparation>
                  <div className="single-image-caption">
                    <span>
                      <i />
                      {tr("条带框")}{" "}
                    </span>
                    <span>
                      <i />
                      {tr("背景框")}{" "}
                    </span>
                    <span>{tr("拖动框可微调")}</span>
                  </div>
                  {!!warnings.length && (
                    <div
                      className="single-warnings"
                      role={!strip.bands.length ? "alert" : undefined}
                    >
                      <ul>
                        {warnings.map((w) => (
                          <li key={w}>{tr(w)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details
                    className="single-adjust"
                    open={editing}
                    onToggle={(e) => setEditing(e.currentTarget.open)}
                  >
                    <summary>
                      <SlidersHorizontal size={15} />
                      {tr("识别不准？调整取样")} <ChevronDown size={14} />
                    </summary>
                    <div className="single-options">
                      <label>
                        {tr("图像类型")}{" "}
                        <select
                          aria-label={tr("图像类型")}
                          disabled={busy}
                          value={mode}
                          onChange={(e) =>
                            reanalyze(e.target.value as SinglePolarity)
                          }
                        >
                          <option value="auto">
                            {tr("自动判断（")}{" "}
                            {strip.polarity === "dark"
                              ? tr("浅底深带")
                              : tr("深底浅带")}
                            ）
                          </option>
                          <option value="dark">{tr("浅底深色条带")}</option>
                          <option value="light">{tr("深底浅色条带")}</option>
                        </select>
                      </label>
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
                        className="single-secondary"
                        disabled={busy}
                        onClick={() => reanalyze(mode, true)}
                      >
                        {tr("重新识别")}{" "}
                      </button>
                    </div>
                    {!!strip.bands.length && (
                      <>
                        <div className="single-options">
                          <label>
                            {tr("选择取样框")}{" "}
                            <select
                              aria-label={tr("编辑泳道")}
                              value={selected}
                              onChange={(e) =>
                                setSelected(Number(e.target.value))
                              }
                            >
                              {strip.bands.map((_, i) => (
                                <option key={i} value={i}>
                                  {tr("泳道")} {i + 1}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {tr("取样区域")}{" "}
                            <select
                              aria-label={tr("编辑取样类型")}
                              value={kind}
                              onChange={(e) =>
                                setKind(e.target.value as "rect" | "background")
                              }
                            >
                              <option value="rect">{tr("条带框")}</option>
                              <option value="background">{tr("背景框")}</option>
                            </select>
                          </label>
                          <label>
                            {tr("对照泳道")}{" "}
                            <select
                              aria-label={tr("对照泳道")}
                              value={control}
                              onChange={(e) =>
                                setControl(Number(e.target.value))
                              }
                            >
                              {strip.bands.map((_, i) => (
                                <option key={i} value={i}>
                                  {tr("泳道")} {i + 1}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {rect ? (
                          <div className="single-coordinates">
                            {(["x", "y", "width", "height"] as const).map(
                              (key, i) => (
                                <label key={key}>
                                  {["X", "Y", tr("宽"), tr("高")][i]}
                                  <input
                                    type="number"
                                    aria-label={f("取样框 {0}", key)}
                                    value={rect[key]}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (Number.isFinite(n))
                                        changeRect(selected, {
                                          ...rect,
                                          [key]: n,
                                        });
                                    }}
                                  />
                                </label>
                              ),
                            )}
                          </div>
                        ) : (
                          <button
                            className="single-secondary"
                            onClick={() =>
                              changeRect(
                                selected,
                                {
                                  x: strip.bands[selected].rect.x,
                                  y: 0,
                                  width: strip.bands[selected].rect.width,
                                  height: Math.min(5, strip.image.height),
                                },
                                "background",
                              )
                            }
                          >
                            {tr("添加背景框")}{" "}
                          </button>
                        )}
                      </>
                    )}
                  </details>
                </section>
                <section className="single-card single-results">
                  <div className="single-card-title">
                    <h2>{tr("识别结果")}</h2>
                    <span>
                      {valid ? (
                        <>
                          <Check size={13} />
                          {tr("自动生成")}{" "}
                        </>
                      ) : (
                        tr("尚无有效结果")
                      )}
                    </span>
                  </div>
                  {!!signals.length ? (
                    <>
                      <div className="single-result-scroll">
                        <svg
                          ref={chart}
                          viewBox={`0 0 520 ${signals.length * 40 + 100}`}
                          xmlns="http://www.w3.org/2000/svg"
                          role="img"
                          aria-label={tr("单条带相对强度")}
                        >
                          <rect
                            width="520"
                            height={signals.length * 40 + 100}
                            fill="white"
                          />
                          <text x="24" y="27" fill="#202337" fontSize="13">
                            {tr("扣背景后的相对强度 · 泳道")} {control + 1} = 1
                          </text>
                          {values.map((v, i) => (
                            <g key={i}>
                              <text
                                x="24"
                                y={62 + i * 40}
                                fill="#667085"
                                fontSize="12"
                              >
                                {tr("泳道")} {i + 1}
                              </text>
                              <rect
                                x="88"
                                y={47 + i * 40}
                                width="326"
                                height="21"
                                fill="#f1f2f8"
                                rx="4"
                              />
                              {v != null && (
                                <rect
                                  x="88"
                                  y={47 + i * 40}
                                  width={(v / max) * 326}
                                  height="21"
                                  fill={i === control ? "#a5b4fc" : "#4f46e5"}
                                  rx="4"
                                />
                              )}
                              <text
                                data-testid={`single-relative-${i + 1}`}
                                x="433"
                                y={62 + i * 40}
                                fill="#373065"
                                fontSize="13"
                                fontWeight="600"
                              >
                                {v == null ? "—" : `${number(v)}×`}
                              </text>
                            </g>
                          ))}
                          <text
                            x="24"
                            y={signals.length * 40 + 78}
                            fill="#667085"
                            fontSize="11"
                          >
                            {tr(
                              "8-bit 像素估计 · 自动取样待核对 · 未做内参归一化",
                            )}{" "}
                          </text>
                          <text
                            x="24"
                            y={signals.length * 40 + 94}
                            fill="#667085"
                            fontSize="9"
                          >
                            <title>
                              {strip.image.name} · {strip.id}
                            </title>
                            {t("来源", "Source")}:{" "}
                            {strip.image.name.length > 48
                              ? strip.image.name.slice(0, 45) + "…"
                              : strip.image.name}{" "}
                            · {strip.id.slice(0, 8)}
                          </text>
                        </svg>
                      </div>
                      <div className="single-downloads">
                        <button
                          className="single-primary"
                          disabled={!valid || exporting}
                          onClick={() => void exportImage()}
                        >
                          <Download size={15} />
                          {tr("导出结果图")}{" "}
                        </button>
                        <button
                          className="single-secondary"
                          onClick={exportCsv}
                        >
                          {tr("导出 CSV")}{" "}
                        </button>
                      </div>
                      <details className="single-numbers">
                        <summary>
                          {tr("查看数值明细")} <ChevronDown size={13} />
                        </summary>
                        <div className="single-table-scroll">
                          <table aria-label={tr("单条带数值明细")}>
                            <thead>
                              <tr>
                                <th>{tr("泳道")}</th>
                                <th>{tr("净信号")}</th>
                                <th>{tr("相对值")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {signals.map((s, i) => (
                                <tr key={s.id}>
                                  <td>{i + 1}</td>
                                  <td>{number(s.net)}</td>
                                  <td>{number(values[i])}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  ) : (
                    <div className="single-empty-result">
                      <ScanLine size={28} />
                      <p>
                        {t(
                          "识别到条带后，结果会直接显示在这里。多排图片可点「圈出一排」，倾斜图片可先「拉直条带」。",
                          "Results appear here once bands are detected. Use Select one row for multiple rows, or Straighten strip for a tilted image.",
                        )}
                      </p>
                      <span>{tr("请保留条带上下和两侧的空白背景。")}</span>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
        <footer className="single-footer">
          <span>{tr("本地处理 · 自动取样需核对 · 刷新前请导出")}</span>
          <a href={languageUrl("?mode=quick")}>
            {tr("多排 / 内参分析")} <ArrowRight size={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}
