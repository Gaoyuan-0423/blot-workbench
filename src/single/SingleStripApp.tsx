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
import { measureBands, type Rect } from "../quick/analysis";
import {
  createQuickExample,
  loadQuickImage,
  type QuickImage,
} from "../quick/image";
import { relativeSignals, resultCsv } from "../quick/results";
import { recognizeSingle, type SinglePolarity } from "./model";
import "./single.css";

type Strip = { image: QuickImage } & ReturnType<typeof recognizeSingle>;
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
  const [strip, setStrip] = useState<Strip | null>(null);
  const [mode, setMode] = useState<SinglePolarity>("auto");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hover, setHover] = useState(false);
  const [control, setControl] = useState(0),
    [count, setCount] = useState(6),
    [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false),
    [kind, setKind] = useState<"rect" | "background">("rect");
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    chart = useRef<SVGSVGElement>(null),
    epoch = useRef(0);
  const drag = useRef<{
    x: number;
    y: number;
    rect: Rect;
    index: number;
  } | null>(null);
  const signals = useMemo(
    () =>
      strip
        ? measureBands(
            strip.image.gray,
            strip.image.width,
            strip.image.height,
            strip.bands,
            strip.polarity,
          )
        : [],
    [strip],
  );
  const values = relativeSignals(signals, null, control),
    valid = values.some((v) => v != null);
  const warnings = [
    ...new Set([
      ...(strip?.warnings ?? []),
      ...signals.flatMap((s, i) =>
        s.warning ? [`泳道 ${i + 1}：${s.warning}`] : [],
      ),
    ]),
  ];
  const rect = strip?.bands[selected]?.[kind];
  const replace = useCallback((image: QuickImage, polarity: SinglePolarity) => {
    const result = recognizeSingle(image, polarity);
    setStrip({ image, ...result });
    setControl(0);
    setSelected(0);
    setCount(result.bands.length || 6);
    setEditing(false);
    setKind("rect");
  }, []);
  const load = useCallback(
    async (file: File) => {
      const id = ++epoch.current;
      setBusy(true);
      setError("");
      try {
        const image = await loadQuickImage(file);
        if (id === epoch.current) replace(image, mode);
      } catch (e) {
        if (id === epoch.current)
          setError(
            `导入失败：${(e as Error).message}${strip ? " 仍显示上一张图片。" : ""}`,
          );
      } finally {
        if (id === epoch.current) setBusy(false);
      }
    },
    [mode, replace, strip],
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
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        void load(file);
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
        next,
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
    if (!strip) return;
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
    if (!m || !drag.current || !strip) return;
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
  const exportCsv = () => {
    if (!strip) return;
    download(
      new Blob(
        [
          resultCsv({
            file: strip.image.name,
            protein: strip.image.name.replace(/\.[^.]+$/, ""),
            polarity: strip.polarity,
            labels: signals.map((_, i) => `泳道 ${i + 1}`),
            control,
            bands: strip.bands,
            signals,
            reference: null,
            referenceFile: "",
            referenceProtein: "",
            values,
            rowY: 0,
            warnings,
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      "单条带识别-结果.csv",
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
      if (!ctx) throw new Error("浏览器无法导出图片，请导出 CSV。");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!png) throw new Error("图片导出失败，请导出 CSV。");
      download(png, "单条带识别-结果.png");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
      setExporting(false);
    }
  };
  const max = Math.max(1, ...values.filter((v): v is number => v != null));

  return (
    <div className="single-app">
      <header className="single-header">
        <a href="./" className="single-back">
          <ArrowLeft size={16} />
          返回工作台
        </a>
        <a href="?mode=single" className="single-brand">
          <ScanLine size={19} />
          Blot <span>单条带识别</span>
        </a>
        <span className="single-local">
          <ShieldCheck size={14} />
          图片不上传
        </span>
      </header>
      <div className="strip-suite">
        <SuiteNav />
      </div>
      <main className="single-main">
        <div className="single-heading">
          <span className="single-kicker">一个栏目，一张条带图</span>
          <h1>单条带识别</h1>
          <p>导入一张裁好的条带图，自动识别，直接看结果。</p>
        </div>
        <input
          ref={input}
          hidden
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          aria-label="导入单排条带图片"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void load(file);
          }}
        />
        {error && (
          <div className="single-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="关闭提示">
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <p className="single-loading" role="status">
            <LoaderCircle size={16} />
            正在识别条带…
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
            const file = e.dataTransfer.files[0];
            if (file) void load(file);
          }}
          className={hover ? "single-drop-active" : ""}
        >
          {!strip ? (
            <section className="single-upload">
              <div className="single-upload-icon">
                <ImagePlus size={32} />
              </div>
              <h2>拖入你的条带图片</h2>
              <p>也可以粘贴截图，或从电脑中选择</p>
              <button
                disabled={busy}
                className="single-primary"
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                导入图片
              </button>
              <small>8-bit PNG / JPG · 单排条带 · 最大 15 MB</small>
              <div className="single-example-line">
                <span>先看看效果</span>
                <button disabled={busy} onClick={sample}>
                  试用示例
                  <ArrowRight size={14} />
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
                <button disabled={busy} onClick={() => input.current?.click()}>
                  更换图片
                </button>
              </div>
              <div className="single-columns">
                <section className="single-card single-source">
                  <div className="single-card-title">
                    <h2>条带图片</h2>
                    <span>
                      {strip.bands.length
                        ? `识别到 ${strip.bands.length} 条`
                        : "等待调整"}
                    </span>
                  </div>
                  <div className="single-image-surface">
                    <svg
                      viewBox={`0 0 ${strip.image.width} ${strip.image.height}`}
                      role="img"
                      aria-label="单排条带取样预览"
                      onPointerMove={move}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                    >
                      <image
                        href={strip.image.dataUrl}
                        width={strip.image.width}
                        height={strip.image.height}
                      />
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
                            aria-label={`泳道 ${i + 1} 取样框`}
                            tabIndex={0}
                            fill={selected === i ? "#4f46e515" : "#4f46e503"}
                            stroke={selected === i ? "#4338ca" : "#818cf8"}
                            strokeWidth={selected === i ? 2 : 1.2}
                            vectorEffect="non-scaling-stroke"
                            onPointerDown={(e) => {
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
                    </svg>
                  </div>
                  <div className="single-image-caption">
                    <span>
                      <i />
                      条带框
                    </span>
                    <span>
                      <i />
                      背景框
                    </span>
                    <span>拖动框可微调</span>
                  </div>
                  {!!warnings.length && (
                    <div
                      className="single-warnings"
                      role={!strip.bands.length ? "alert" : undefined}
                    >
                      <ul>
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
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
                      识别不准？调整取样
                      <ChevronDown size={14} />
                    </summary>
                    <div className="single-options">
                      <label>
                        图像类型
                        <select
                          aria-label="图像类型"
                          disabled={busy}
                          value={mode}
                          onChange={(e) =>
                            reanalyze(e.target.value as SinglePolarity)
                          }
                        >
                          <option value="auto">
                            自动判断（
                            {strip.polarity === "dark"
                              ? "浅底深带"
                              : "深底浅带"}
                            ）
                          </option>
                          <option value="dark">浅底深色条带</option>
                          <option value="light">深底浅色条带</option>
                        </select>
                      </label>
                      <label>
                        泳道数量
                        <input
                          aria-label="泳道数量"
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
                        重新识别
                      </button>
                    </div>
                    {!!strip.bands.length && (
                      <>
                        <div className="single-options">
                          <label>
                            选择取样框
                            <select
                              aria-label="编辑泳道"
                              value={selected}
                              onChange={(e) =>
                                setSelected(Number(e.target.value))
                              }
                            >
                              {strip.bands.map((_, i) => (
                                <option key={i} value={i}>
                                  泳道 {i + 1}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            取样区域
                            <select
                              aria-label="编辑取样类型"
                              value={kind}
                              onChange={(e) =>
                                setKind(e.target.value as "rect" | "background")
                              }
                            >
                              <option value="rect">条带框</option>
                              <option value="background">背景框</option>
                            </select>
                          </label>
                          <label>
                            对照泳道
                            <select
                              aria-label="对照泳道"
                              value={control}
                              onChange={(e) =>
                                setControl(Number(e.target.value))
                              }
                            >
                              {strip.bands.map((_, i) => (
                                <option key={i} value={i}>
                                  泳道 {i + 1}
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
                                  {["X", "Y", "宽", "高"][i]}
                                  <input
                                    type="number"
                                    aria-label={`取样框 ${key}`}
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
                            添加背景框
                          </button>
                        )}
                      </>
                    )}
                  </details>
                </section>
                <section className="single-card single-results">
                  <div className="single-card-title">
                    <h2>识别结果</h2>
                    <span>
                      {valid ? (
                        <>
                          <Check size={13} />
                          自动生成
                        </>
                      ) : (
                        "尚无有效结果"
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
                          aria-label="单条带相对强度"
                        >
                          <rect
                            width="520"
                            height={signals.length * 40 + 100}
                            fill="white"
                          />
                          <text x="24" y="27" fill="#202337" fontSize="13">
                            扣背景后的相对强度 · 泳道 {control + 1} = 1
                          </text>
                          {values.map((v, i) => (
                            <g key={i}>
                              <text
                                x="24"
                                y={62 + i * 40}
                                fill="#667085"
                                fontSize="12"
                              >
                                泳道 {i + 1}
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
                            8-bit 像素估计 · 自动取样待核对 · 未做内参归一化
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
                          导出结果图
                        </button>
                        <button
                          className="single-secondary"
                          onClick={exportCsv}
                        >
                          导出 CSV
                        </button>
                      </div>
                      <details className="single-numbers">
                        <summary>
                          查看数值明细
                          <ChevronDown size={13} />
                        </summary>
                        <div className="single-table-scroll">
                          <table aria-label="单条带数值明细">
                            <thead>
                              <tr>
                                <th>泳道</th>
                                <th>净信号</th>
                                <th>相对值</th>
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
                      <p>识别到条带后，结果会直接显示在这里。</p>
                      <span>请保留条带上下和两侧的空白背景。</span>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
        <footer className="single-footer">
          <span>本地处理 · 自动取样需核对 · 刷新前请导出</span>
          <a href="?mode=quick">
            多排 / 内参分析
            <ArrowRight size={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}
