import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../i18n";
import { imageRaster, type RealProject } from "./model";
import { renderFigure } from "./figure-export";
import {
  buildPublicationSvg,
  buildSourceDataHtml,
  createPublicationRow,
  defaultPublication,
  exportPublicationBundle,
  publicationPreflight,
} from "./publication";
import {
  PUBLICATION_SOURCE_KINDS,
  type PublicationRow,
  type PublicationSettings,
  type PublicationSourceKind,
} from "./publication-settings";
import "./publication.css";

type Props = {
  project: RealProject;
  disabled: boolean;
  onChange: (settings: PublicationSettings) => void;
  onRun: (label: string, task: () => Promise<void>) => Promise<void>;
  sectionRef?: (element: HTMLElement | null) => void;
};

type NumericFieldProps = {
  label: string;
  value: number;
  disabled: boolean;
  validate: (value: number) => string;
  onCommit: (value: number) => void;
  onInvalid: (invalid: boolean) => void;
};

/** Text drafts allow empty/intermediate input without changing saved geometry. */
function NumericField({
  label,
  value,
  disabled,
  validate,
  onCommit,
  onInvalid,
}: NumericFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [showError, setShowError] = useState(false);
  const invalidCallback = useRef(onInvalid);
  invalidCallback.current = onInvalid;
  const validation = (text: string) =>
    text.trim() === "" || !Number.isFinite(Number(text))
      ? validate(Number.NaN)
      : validate(Number(text));
  const error = showError ? validation(draft) : "";

  useEffect(() => {
    setDraft(String(value));
    setShowError(false);
    invalidCallback.current(false);
  }, [value]);
  useEffect(() => () => invalidCallback.current(false), []);

  const finish = () => {
    const message = validation(draft);
    setShowError(Boolean(message));
    onInvalid(Boolean(message));
    if (!message && Number(draft) !== value) onCommit(Number(draft));
  };

  return (
    <label className="publication-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={Boolean(error)}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const message = validation(next);
          onInvalid(Boolean(message));
        }}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(value));
            setShowError(false);
            onInvalid(false);
          }
        }}
      />
      {error && (
        <span className="publication-input-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function saveDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Explicit pixel dimensions avoid rounding mm to CSS pixels before rasterizing. */
function pngSizedSvg(svg: string, widthMm: number): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (
    root.localName !== "svg" ||
    document.querySelector("parsererror") ||
    !viewBox ||
    viewBox.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    viewBox[2] <= 0 ||
    viewBox[3] <= 0
  )
    throw new Error("图版尺寸无效 / Invalid figure dimensions");
  const width = Math.round((widthMm / 25.4) * 300);
  root.setAttribute("width", String(width));
  root.setAttribute(
    "height",
    String(Math.round((width * viewBox[3]) / viewBox[2])),
  );
  return new XMLSerializer().serializeToString(root);
}

export default function PublicationPanel({
  project,
  disabled,
  onChange,
  onRun,
  sectionRef,
}: Props) {
  const { language, t } = useLanguage();
  const settings = useMemo(
    () => project.publication ?? defaultPublication(project),
    [project],
  );
  const [selectedId, setSelectedId] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>(
    {},
  );
  const [resetKeys, setResetKeys] = useState<Record<string, number>>({});
  const locked = disabled || exporting;
  const selected = project.images.some((image) => image.id === selectedId)
    ? selectedId
    : (project.images[0]?.id ?? "");
  const preflight = useMemo(
    () => publicationPreflight(project, settings),
    [project, settings],
  );
  const hasInvalidInput = Object.values(invalidFields).some(Boolean);
  const figureBlocked =
    settings.rows.length === 0 ||
    hasInvalidInput ||
    preflight.some((issue) => issue.severity === "error");
  const preview = useMemo(() => {
    if (
      !settings.rows.length ||
      preflight.some((issue) => issue.severity === "error")
    )
      return { svg: "", error: "" };
    try {
      return {
        svg: buildPublicationSvg(project, settings, language),
        error: "",
      };
    } catch (problem) {
      return {
        svg: "",
        error: problem instanceof Error ? problem.message : String(problem),
      };
    }
  }, [project, settings, language, preflight]);
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!preview.svg) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([preview.svg], { type: "image/svg+xml" }),
    );
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview.svg]);

  const setInvalid = (key: string, value: boolean) =>
    setInvalidFields((previous) =>
      Boolean(previous[key]) === value
        ? previous
        : { ...previous, [key]: value },
    );
  const change = (next: PublicationSettings) => {
    if (locked) return;
    setExportError("");
    setNotice("");
    onChange(next);
  };
  const patchRow = (id: string, patch: Partial<PublicationRow>) =>
    change({
      ...settings,
      rows: settings.rows.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    });
  const moveRow = (index: number, delta: number) => {
    const rows = [...settings.rows];
    const destination = index + delta;
    if (destination < 0 || destination >= rows.length) return;
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    change({ ...settings, rows });
  };
  const sourceLabel = (kind: PublicationSourceKind) =>
    ({
      unspecified: t("未分类", "Unspecified"),
      ecl: t("化学发光（ECL）", "Chemiluminescence (ECL)"),
      overlay: t("叠加图", "Overlay"),
      "white-light": t("白光 / Marker", "White light / marker"),
      ponceau: t("整膜染色 / 丽春红", "Total membrane / Ponceau"),
      "long-exposure": t("长曝光", "Long exposure"),
    })[kind];
  const exportFile = async (format: "svg" | "png" | "html" | "zip") => {
    if (
      locked ||
      exportLock.current ||
      hasInvalidInput ||
      ((format === "svg" || format === "png") && figureBlocked)
    )
      return;
    exportLock.current = true;
    setExporting(true);
    setExportError("");
    setNotice("");
    try {
      await onRun(
        t("正在导出图版资料…", "Exporting publication files…"),
        async () => {
          try {
            const stem =
              project.name
                .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
                .slice(0, 100) || "WB-project";
            let blob: Blob;
            let name: string;
            if (format === "html") {
              blob = new Blob(
                [buildSourceDataHtml(project, settings, language)],
                { type: "text/html;charset=utf-8" },
              );
              name = `${stem}-source-data.html`;
            } else if (format === "zip") {
              blob = await exportPublicationBundle(project, settings, language);
              name = `${stem}-publication.zip`;
            } else {
              const svg = buildPublicationSvg(project, settings, language);
              blob =
                format === "svg"
                  ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
                  : await renderFigure(
                      pngSizedSvg(svg, settings.widthMm),
                      "png",
                      1,
                    );
              name = `${stem}-figure.${format}`;
            }
            saveDownload(blob, name);
            setNotice(t(`已导出 ${name}`, `Exported ${name}`));
          } catch (problem) {
            setExportError(
              problem instanceof Error ? problem.message : String(problem),
            );
          }
        },
      );
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  };

  return (
    <section
      className="real-card publication-panel"
      ref={sectionRef}
      aria-labelledby="publication-heading"
    >
      <div className="real-section-heading">
        <span className="real-step-number">05</span>
        <div>
          <h2 id="publication-heading">
            {t("图版与原始数据", "Figure and source data")}
          </h2>
          <p>
            {t(
              "排列条带、补充标签，并将未裁剪原图与分析记录一起导出。图版裁剪只用于展示，不改变定量区域或数值。",
              "Arrange strips and labels, then export uncropped originals with analysis records. Figure crops affect presentation only; measurement regions and values stay unchanged.",
            )}
          </p>
        </div>
      </div>

      <div className="publication-layout">
        <div className="publication-editor">
          <div className="publication-settings">
            <label className="publication-field">
              <span>{t("图版标题", "Figure title")}</span>
              <input
                aria-label={t("图版标题", "Figure title")}
                value={settings.title}
                maxLength={200}
                disabled={locked}
                onChange={(event) =>
                  change({ ...settings, title: event.target.value })
                }
              />
            </label>
            <NumericField
              label={t("图版宽度（毫米）", "Figure width (mm)")}
              value={settings.widthMm}
              disabled={locked}
              validate={(value) =>
                Number.isFinite(value) && value >= 80 && value <= 200
                  ? ""
                  : t("请输入 80–200 毫米。", "Enter 80–200 mm.")
              }
              onCommit={(widthMm) => change({ ...settings, widthMm })}
              onInvalid={(value) => setInvalid("widthMm", value)}
            />
          </div>
          <div className="publication-add-row">
            <label className="publication-field">
              <span>{t("添加图版原图", "Image to add to figure")}</span>
              <select
                aria-label={t("添加图版原图", "Image to add to figure")}
                value={selected}
                disabled={locked || !project.images.length}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {!project.images.length && (
                  <option value="">
                    {t("请先导入原图", "Import an original first")}
                  </option>
                )}
                {project.images.map((image) => (
                  <option key={image.id} value={image.id}>
                    {image.name}
                    {image.excluded
                      ? t("（已从定量排除）", " (excluded from analysis)")
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="real-button"
              disabled={locked || !selected || settings.rows.length >= 24}
              onClick={() =>
                change({
                  ...settings,
                  rows: [
                    ...settings.rows,
                    createPublicationRow(project, selected),
                  ],
                })
              }
            >
              <Plus size={15} />
              {t("添加到图版", "Add to figure")}
            </button>
          </div>
          <p className="publication-help">
            {t(
              `已添加 ${settings.rows.length}/24 行；同一原图可添加多次，分别展示不同区域。`,
              `${settings.rows.length}/24 rows; add an original more than once to show different regions.`,
            )}
          </p>

          {!settings.rows.length && (
            <div className="publication-empty">
              {t(
                "选择原图后添加一行图版。没有图版行时，也可以导出全部原图的原始数据文档。",
                "Add an image to start the figure. Source data can also be exported without figure rows.",
              )}
            </div>
          )}
          <ol className="publication-rows">
            {settings.rows.map((row, index) => {
              const image = project.images.find(
                (entry) => entry.id === row.imageId,
              );
              const raster = image ? imageRaster(image) : null;
              const fieldLabel = (zh: string, en: string) =>
                t(
                  `图版第 ${index + 1} 行：${zh}`,
                  `Figure row ${index + 1}: ${en}`,
                );
              const cropFields = [
                ["x", "x", "x"],
                ["y", "y", "y"],
                ["width", "宽", "width"],
                ["height", "高", "height"],
              ] as const;
              return (
                <li key={row.id} className="publication-row">
                  <div className="publication-row-header">
                    <strong>
                      {index + 1}.{" "}
                      {image?.name ?? t("原图缺失", "Missing original")}
                    </strong>
                    <div className="publication-row-actions">
                      <button
                        type="button"
                        className="real-button small"
                        disabled={locked || index === 0}
                        aria-label={fieldLabel("上移", "move up")}
                        onClick={() => moveRow(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="real-button small"
                        disabled={locked || index === settings.rows.length - 1}
                        aria-label={fieldLabel("下移", "move down")}
                        onClick={() => moveRow(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="real-button small"
                        disabled={locked}
                        aria-label={fieldLabel("删除", "remove")}
                        onClick={() =>
                          change({
                            ...settings,
                            rows: settings.rows.filter(
                              (entry) => entry.id !== row.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="publication-row-labels">
                    <label className="publication-field">
                      <span>{t("面板", "Panel")}</span>
                      <input
                        aria-label={fieldLabel("面板", "panel")}
                        maxLength={8}
                        value={row.panel}
                        disabled={locked}
                        onChange={(event) =>
                          patchRow(row.id, { panel: event.target.value })
                        }
                      />
                    </label>
                    <label className="publication-field">
                      <span>{t("标签", "Label")}</span>
                      <input
                        aria-label={fieldLabel("标签", "label")}
                        maxLength={100}
                        value={row.label}
                        disabled={locked}
                        onChange={(event) =>
                          patchRow(row.id, { label: event.target.value })
                        }
                      />
                    </label>
                    <label className="publication-field">
                      <span>
                        {t("分子量（kDa）", "Molecular weight (kDa)")}
                      </span>
                      <input
                        aria-label={fieldLabel("分子量", "molecular weight")}
                        maxLength={40}
                        value={row.molecularWeight}
                        disabled={locked}
                        onChange={(event) =>
                          patchRow(row.id, {
                            molecularWeight: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div
                    className="publication-crop"
                    key={`${row.id}-${resetKeys[row.id] ?? 0}`}
                  >
                    {cropFields.map(([key, zh, en]) => (
                      <NumericField
                        key={key}
                        label={fieldLabel(zh, en)}
                        value={row.crop[key]}
                        disabled={locked || !raster}
                        validate={(value) => {
                          if (
                            !Number.isSafeInteger(value) ||
                            value <
                              (key === "width" || key === "height" ? 1 : 0)
                          )
                            return t(
                              "请输入有效的整数像素。",
                              "Enter a valid integer pixel value.",
                            );
                          const crop = { ...row.crop, [key]: value };
                          return raster &&
                            crop.x + crop.width <= raster.width &&
                            crop.y + crop.height <= raster.height
                            ? ""
                            : t(
                                "裁剪超出原图边界。",
                                "Crop exceeds the original.",
                              );
                        }}
                        onCommit={(value) =>
                          patchRow(row.id, {
                            crop: { ...row.crop, [key]: value },
                          })
                        }
                        onInvalid={(value) =>
                          setInvalid(`${row.id}:${key}`, value)
                        }
                      />
                    ))}
                  </div>
                  <div className="publication-crop-footer">
                    <span>
                      {raster &&
                        t(
                          `原图 ${raster.width} × ${raster.height} 像素；坐标从左上角起算。`,
                          `Original: ${raster.width} × ${raster.height} px; coordinates start at the top left.`,
                        )}
                    </span>
                    <button
                      type="button"
                      className="real-button small subtle"
                      disabled={locked || !raster}
                      aria-label={fieldLabel(
                        "复位为整幅原图",
                        "reset to full original",
                      )}
                      onClick={() => {
                        if (!raster) return;
                        setResetKeys((previous) => ({
                          ...previous,
                          [row.id]: (previous[row.id] ?? 0) + 1,
                        }));
                        patchRow(row.id, {
                          crop: {
                            x: 0,
                            y: 0,
                            width: raster.width,
                            height: raster.height,
                          },
                        });
                      }}
                    >
                      <RotateCcw size={13} />
                      {t("整幅原图", "Full original")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="publication-output">
          <div
            className="publication-preview"
            aria-label={t("图版预览", "Figure preview")}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={t("当前图版草稿预览", "Current draft figure preview")}
              />
            ) : (
              <p>
                {t(
                  "添加图版行并修正阻断问题后显示预览。",
                  "Add figure rows and resolve blocking issues to see a preview.",
                )}
              </p>
            )}
          </div>
          <p className="publication-help">
            {t(
              "SVG 保留设定的物理宽度。PNG 按该宽度对应 300 DPI 的像素数导出，排版时请采用所选毫米宽度；这不会增加原图细节。",
              "SVG preserves the chosen physical width. PNG uses the corresponding pixel dimensions at 300 DPI; place it at the selected millimeter width. This does not add source detail.",
            )}
          </p>
          <div className="publication-preflight" aria-live="polite">
            <strong>{t("导出前检查", "Export checks")}</strong>
            {preflight.length ? (
              <ul>
                {preflight.map((issue, index) => (
                  <li
                    key={`${issue.code}-${issue.rowId ?? ""}-${index}`}
                    className={issue.severity}
                  >
                    {issue.rowId && (
                      <strong>
                        {t(
                          `第 ${settings.rows.findIndex((row) => row.id === issue.rowId) + 1} 行：`,
                          `Row ${settings.rows.findIndex((row) => row.id === issue.rowId) + 1}: `,
                        )}
                      </strong>
                    )}
                    {language === "zh" ? issue.messageZh : issue.messageEn}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {t(
                  "当前未发现布局检查问题；仍须核对投稿要求。",
                  "No layout issues detected; check the journal requirements before submission.",
                )}
              </p>
            )}
            {hasInvalidInput && (
              <p className="publication-input-error">
                {t(
                  "请修正尚未保存的数值输入后导出。",
                  "Correct unsaved numeric inputs before exporting.",
                )}
              </p>
            )}
            {preview.error && (
              <p className="publication-input-error" role="alert">
                {preview.error}
              </p>
            )}
          </div>
          <div className="publication-export-buttons">
            <button
              className="real-button"
              type="button"
              disabled={locked || figureBlocked || Boolean(preview.error)}
              onClick={() => void exportFile("svg")}
            >
              <Download size={15} />
              {t("导出图版 SVG", "Export figure SVG")}
            </button>
            <button
              className="real-button"
              type="button"
              disabled={locked || figureBlocked || Boolean(preview.error)}
              onClick={() => void exportFile("png")}
            >
              <Download size={15} />
              {t("导出图版 PNG", "Export figure PNG")}
            </button>
            <button
              className="real-button"
              type="button"
              disabled={locked || hasInvalidInput || !project.images.length}
              onClick={() => void exportFile("html")}
            >
              <Download size={15} />
              {t("导出原始数据 HTML", "Export source data HTML")}
            </button>
            <button
              className="real-button primary"
              type="button"
              disabled={locked || hasInvalidInput || !project.images.length}
              onClick={() => void exportFile("zip")}
            >
              <Download size={15} />
              {t("导出完整资料 ZIP", "Export complete bundle ZIP")}
            </button>
          </div>
          <p className="publication-help">
            {t(
              "原始数据 HTML 展示完整原图的显示预览，可在浏览器中打开并打印为 PDF。原始文件字节保存在完整资料包内，随项目、分析记录与文档一起导出。",
              "Source data HTML shows full-frame display previews. Open it in a browser and print to PDF. The complete bundle preserves original file bytes alongside the project, analysis records and documents.",
            )}
          </p>
          {exporting && (
            <p className="publication-status" role="status">
              <LoaderCircle size={15} className="publication-spinner" />
              {t("正在生成导出文件…", "Preparing export…")}
            </p>
          )}
          {notice && (
            <p className="publication-status" role="status">
              {notice}
            </p>
          )}
          {exportError && (
            <p className="publication-input-error" role="alert">
              {exportError}
            </p>
          )}
        </div>
      </div>

      <details className="publication-sources">
        <summary>
          {t(
            `原图类型与完整资料（${project.images.length} 张）`,
            `Original types and complete records (${project.images.length} images)`,
          )}
        </summary>
        <p className="publication-help">
          {t(
            "类型仅用于原始数据文档的整理；不会改变目标/内参配对。从定量排除的图像仍包含在资料文档中。",
            "Types organize source data only and do not change target/reference pairing. Images excluded from quantification remain in the documentation.",
          )}
        </p>
        <div className="publication-source-list">
          {project.images.map((image) => (
            <label key={image.id} className="publication-source">
              <span>
                {image.name}
                {image.excluded && (
                  <small>{t("已从定量排除", "Excluded from analysis")}</small>
                )}
              </span>
              <select
                aria-label={t(
                  `原图类型：${image.name}`,
                  `Original type: ${image.name}`,
                )}
                disabled={locked}
                value={
                  settings.sources.find((source) => source.imageId === image.id)
                    ?.kind ?? "unspecified"
                }
                onChange={(event) =>
                  change({
                    ...settings,
                    sources: [
                      ...settings.sources.filter(
                        (source) => source.imageId !== image.id,
                      ),
                      {
                        imageId: image.id,
                        kind: event.target.value as PublicationSourceKind,
                      },
                    ],
                  })
                }
              >
                {PUBLICATION_SOURCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {sourceLabel(kind)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
