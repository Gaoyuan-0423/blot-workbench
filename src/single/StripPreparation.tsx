import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Crop, RotateCcw, ScanLine, SlidersHorizontal } from "lucide-react";
import { translate as t, translateMessage as tr } from "../i18n";
import type { QuickImage } from "../quick/image";
import type { Rect } from "../quick/analysis";
import type { Point, PreparedRaster, PreparationConfig } from "./preparation";

export type Appearance = { brightness: number; contrast: number };

/** A display/detection raster only. Quantification always uses prepared.source. */
export function rasterPreview(prepared: PreparedRaster): QuickImage {
  if (
    prepared.gray === prepared.source.gray &&
    prepared.width === prepared.source.width &&
    prepared.height === prepared.source.height
  )
    return prepared.source;
  const canvas = document.createElement("canvas");
  canvas.width = prepared.width;
  canvas.height = prepared.height;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error(
      t("无法创建图片预览。", "Could not create the image preview."),
    );
  const pixels = context.createImageData(prepared.width, prepared.height);
  for (let i = 0; i < prepared.gray.length; i++) {
    pixels.data[i * 4] =
      pixels.data[i * 4 + 1] =
      pixels.data[i * 4 + 2] =
        prepared.gray[i];
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return {
    name: prepared.source.name,
    dataUrl: canvas.toDataURL("image/png"),
    gray: prepared.gray,
    width: prepared.width,
    height: prepared.height,
  };
}

type Props = {
  image: QuickImage;
  prepared: PreparedRaster;
  config: PreparationConfig;
  appearance: Appearance;
  onAppearance: (value: Appearance) => void;
  onApply: (config: PreparationConfig) => boolean;
  disabled: boolean;
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerEnd: () => void;
  children: ReactNode;
};

export default function StripPreparation(props: Props) {
  const {
    image,
    prepared,
    config,
    appearance,
    onAppearance,
    onApply,
    disabled,
    children,
  } = props;
  const [tool, setTool] = useState<"straighten" | "crop" | null>(null);
  const [curved, setCurved] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [display, setDisplay] = useState(false);
  const [original, setOriginal] = useState(false);
  const cropStart = useRef<Point | null>(null);
  const raw = tool === "straighten" || original;
  const shown = raw ? prepared.source : image;
  const changed = !!(config.straighten || config.curve || config.crop);
  const editing = tool !== null;
  const begin = (next: "straighten" | "crop") => {
    props.onPointerEnd();
    cropStart.current = null;
    setOriginal(false);
    setPoints([]);
    setCrop(null);
    setTool(tool === next ? null : next);
  };
  const position = (event: PointerEvent<SVGSVGElement>): Point | null => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return {
      x: Math.max(0, Math.min(shown.width, p.x)),
      y: Math.max(0, Math.min(shown.height, p.y)),
    };
  };
  const apply = () => {
    if (tool === "straighten" && points.length >= (curved ? 3 : 2)) {
      const ordered = [...points].sort((a, b) => a.x - b.x);
      if (
        onApply({
          straighten: [ordered[0], ordered[ordered.length - 1]],
          ...(curved ? { curve: ordered } : {}),
        })
      )
        setTool(null);
    } else if (tool === "crop" && crop && crop.width >= 8 && crop.height >= 8) {
      if (
        onApply({
          ...config,
          crop: {
            ...crop,
            x: crop.x + prepared.crop.x,
            y: crop.y + prepared.crop.y,
          },
        })
      )
        setTool(null);
    }
  };
  const dragCrop = (p: Point) => {
    const start = cropStart.current;
    if (!start) return;
    const x = Math.floor(Math.min(start.x, p.x)),
      y = Math.floor(Math.min(start.y, p.y));
    setCrop({
      x,
      y,
      width: Math.ceil(Math.max(start.x, p.x)) - x,
      height: Math.ceil(Math.max(start.y, p.y)) - y,
    });
  };
  const pointSize = Math.max(3, shown.width / 110);
  return (
    <div className="single-preparation">
      <div
        className="single-prep-toolbar"
        aria-label={t("图片准备", "Image preparation")}
      >
        <button
          disabled={disabled}
          aria-pressed={tool === "straighten"}
          onClick={() => begin("straighten")}
        >
          <ScanLine size={14} />
          {t("拉直条带", "Straighten strip")}
        </button>
        <button
          disabled={disabled}
          aria-pressed={tool === "crop"}
          onClick={() => begin("crop")}
        >
          <Crop size={14} />
          {t("圈出一排", "Select one row")}
        </button>
        <button
          disabled={disabled}
          aria-expanded={display}
          onClick={() => setDisplay(!display)}
        >
          <SlidersHorizontal size={14} />
          {t("显示调整", "Display adjustments")}
        </button>
      </div>
      {display && (
        <div className="single-prep-panel single-appearance">
          <p>
            {t(
              "仅改变显示，不改变测量值；过曝的原始信号无法通过调暗恢复。",
              "Display only; measurements stay unchanged. Dimming cannot recover saturated source signals.",
            )}
          </p>
          {(["brightness", "contrast"] as const).map((key) => (
            <label key={key}>
              <span>
                {key === "brightness"
                  ? t("显示亮度", "Display brightness")
                  : t("显示对比度", "Display contrast")}{" "}
                <output>{appearance[key]}%</output>
              </span>
              <input
                type="range"
                aria-label={
                  key === "brightness"
                    ? t("显示亮度", "Display brightness")
                    : t("显示对比度", "Display contrast")
                }
                min={key === "brightness" ? 40 : 25}
                max={key === "brightness" ? 200 : 300}
                step={1}
                value={appearance[key]}
                disabled={disabled}
                onChange={(e) =>
                  onAppearance({ ...appearance, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <button
            disabled={disabled}
            onClick={() => onAppearance({ brightness: 100, contrast: 100 })}
          >
            {t("恢复显示", "Reset display")}
          </button>
        </div>
      )}
      {tool === "straighten" && (
        <div className="single-prep-panel">
          <div className="single-prep-options">
            <button
              disabled={disabled}
              aria-pressed={!curved}
              onClick={() => {
                setCurved(false);
                setPoints([]);
              }}
            >
              {t("整体倾斜", "Overall tilt")}
            </button>
            <button
              disabled={disabled}
              aria-pressed={curved}
              onClick={() => {
                setCurved(true);
                setPoints([]);
              }}
            >
              {t("弯曲校直", "Curved strip")}
            </button>
          </div>
          <p>
            {curved
              ? t(
                  "沿同一排条带的中心线，从左到右点 3–8 个点，再应用校直。",
                  "Mark 3–8 points from left to right along the center of one band row, then apply.",
                )
              : t(
                  "在原图上，沿同一排条带的中心线点左右两端，再应用校直。",
                  "On the original image, mark the left and right ends of the center line of one band row, then apply.",
                )}
          </p>
          <small>
            {t(
              "应用后重新识别，当前裁剪和取样框会重置。",
              "Applying re-detects bands and resets the current crop and regions.",
            )}
          </small>
          <div className="single-prep-actions">
            <span role="status">
              {t("已选", "Selected")} {points.length} / {curved ? "3–8" : "2"}
            </span>
            <button
              disabled={disabled || !points.length}
              onClick={() => setPoints(points.slice(0, -1))}
            >
              {t("撤回一点", "Undo point")}
            </button>
            <button
              className="single-primary"
              disabled={disabled || points.length < (curved ? 3 : 2)}
              onClick={apply}
            >
              {t("应用校直", "Apply straightening")}
            </button>
            <button disabled={disabled} onClick={() => setTool(null)}>
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {tool === "crop" && (
        <div className="single-prep-panel">
          <p>
            {t(
              "拖动框出一排条带，保留上下少量空白作背景。应用后自动重新识别。",
              "Drag around one band row, leaving a little clear background above and below. Bands are re-detected after applying.",
            )}
          </p>
          <div className="single-prep-actions">
            <span>
              {crop
                ? `${crop.width} × ${crop.height} px`
                : t("在下图拖动选择", "Drag on the image below")}
            </span>
            <button
              className="single-primary"
              disabled={disabled || !crop || crop.width < 8 || crop.height < 8}
              onClick={apply}
            >
              {t("应用裁剪", "Apply crop")}
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                cropStart.current = null;
                setTool(null);
              }}
            >
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}
      <div
        className={`single-image-surface${editing ? " single-prep-editing" : ""}`}
      >
        <svg
          viewBox={`0 0 ${shown.width} ${shown.height}`}
          role="img"
          aria-label={tr("单排条带取样预览")}
          onPointerDown={(event) => {
            if (disabled || !tool) return;
            const p = position(event);
            if (!p) return;
            if (tool === "straighten")
              setPoints((current) =>
                current.length >= (curved ? 8 : 2) ? current : [...current, p],
              );
            else {
              cropStart.current = p;
              setCrop(null);
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerMove={(event) => {
            if (disabled) return;
            if (tool === "crop") {
              const p = position(event);
              if (p) dragCrop(p);
            } else if (!editing && !original) props.onPointerMove(event);
          }}
          onPointerUp={(event) => {
            if (tool === "crop" && !disabled) {
              const p = position(event);
              if (p) dragCrop(p);
            }
            cropStart.current = null;
            props.onPointerEnd();
          }}
          onPointerCancel={() => {
            cropStart.current = null;
            props.onPointerEnd();
          }}
          onLostPointerCapture={() => {
            cropStart.current = null;
            props.onPointerEnd();
          }}
        >
          <image
            href={shown.dataUrl}
            width={shown.width}
            height={shown.height}
            style={{
              filter: original
                ? "none"
                : `brightness(${appearance.brightness}%) contrast(${appearance.contrast}%)`,
            }}
          />
          {!editing && !original && children}
          {tool === "straighten" && (
            <g pointerEvents="none">
              <polyline
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#4f46e5"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              {points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={pointSize}
                    fill="#4f46e5"
                    stroke="white"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={p.x}
                    y={p.y - pointSize * 2}
                    textAnchor="middle"
                    fill="#4338ca"
                    fontSize={pointSize * 3}
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          )}
          {tool === "crop" && crop && (
            <rect
              {...crop}
              fill="#6366f122"
              stroke="#4f46e5"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
      <div className="single-prep-view">
        <button
          disabled={disabled || editing}
          aria-pressed={original}
          onClick={() => {
            props.onPointerEnd();
            setOriginal(!original);
          }}
        >
          {t("查看原图", "View original")}
        </button>
        {changed && (
          <>
            <span>
              {t("已校直／裁剪", "Straightened / cropped")} ·{" "}
              {prepared.metadata.rotationDegrees.toFixed(1)}°
            </span>
            <button
              disabled={disabled}
              onClick={() => {
                if (onApply({})) {
                  setOriginal(false);
                  setTool(null);
                }
              }}
            >
              <RotateCcw size={12} />
              {t("恢复完整原图", "Restore full original")}
            </button>
          </>
        )}
        {original && (
          <small>
            {t(
              "正在查看未经处理的原图，取样框暂时隐藏。",
              "Showing the unmodified source; sampling regions are hidden.",
            )}
          </small>
        )}
      </div>
    </div>
  );
}
