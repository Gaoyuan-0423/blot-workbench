import type { LaneRegion } from "./pixels";

/**
 * Composed publication figure: annotated original + quantification chart +
 * method footer, assembled as one standalone SVG string. Pure string
 * assembly (no DOM), so the layout is unit-testable in Node; rasterization
 * and TIFF encoding stay in figure-export.ts.
 */

export type ComposedFigureLayout = "side-by-side" | "stacked";

export interface ComposedFigureInput {
  layout: ComposedFigureLayout;
  /** Self-contained image href (data URL), never a blob URL. */
  imageHref: string;
  imageWidth: number;
  imageHeight: number;
  regions: LaneRegion[];
  /** Full lane labels; index i labels lane i+1. */
  laneLabels: string[];
  /** Serialized quantification chart `<svg>…</svg>`. */
  chartSvg: string;
  captionLines: string[];
}

const MARGIN = 24;
const GUTTER = 24;
const FOOTER_LINE_HEIGHT = 20;
const TOTAL_WIDTH = 1400;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function chartViewBox(chartSvg: string): { width: number; height: number } {
  const match = /viewBox="([\d.\s+-]+)"/.exec(chartSvg);
  if (match) {
    const parts = match[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0)
      return { width: parts[2], height: parts[3] };
  }
  return { width: 900, height: 500 };
}

export function buildComposedFigureSvg(input: ComposedFigureInput): string {
  if (!Number.isFinite(input.imageWidth) || input.imageWidth <= 0 ||
      !Number.isFinite(input.imageHeight) || input.imageHeight <= 0)
    throw new Error("Invalid image dimensions / 图像尺寸无效");
  if (!input.imageHref.startsWith("data:image/"))
    throw new Error("The composed figure needs a self-contained image data URL.");
  const chart = input.chartSvg.trim();
  if (!chart.startsWith("<svg")) throw new Error("Invalid chart SVG / 图表无效");
  const viewBox = chartViewBox(chart);

  const footerHeight = input.captionLines.length * FOOTER_LINE_HEIGHT;
  const panelWidth =
    input.layout === "side-by-side"
      ? (TOTAL_WIDTH - 3 * MARGIN - GUTTER) / 2
      : TOTAL_WIDTH - 2 * MARGIN;
  const imagePanelHeight = (panelWidth * input.imageHeight) / input.imageWidth;
  const chartPanelHeight = (panelWidth * viewBox.height) / viewBox.width;
  const contentHeight =
    input.layout === "side-by-side"
      ? Math.max(imagePanelHeight, chartPanelHeight)
      : imagePanelHeight + GUTTER + chartPanelHeight;
  const totalHeight = MARGIN + contentHeight + MARGIN + footerHeight + MARGIN / 2;

  const imageX = MARGIN;
  const imageY = MARGIN;
  const chartX =
    input.layout === "side-by-side" ? MARGIN + panelWidth + GUTTER : MARGIN;
  const chartY =
    input.layout === "side-by-side"
      ? MARGIN
      : MARGIN + imagePanelHeight + GUTTER;

  const scale = panelWidth / input.imageWidth;
  const stroke = Math.max(1.5, input.imageWidth / 400);
  const rects = input.regions
    .map((region) => {
      const label =
        input.laneLabels[region.lane - 1] ?? `Lane ${region.lane}`;
      const band = region.band;
      return [
        `<rect x="${(imageX + band.x * scale).toFixed(2)}" y="${(imageY + band.y * scale).toFixed(2)}" width="${(band.width * scale).toFixed(2)}" height="${(band.height * scale).toFixed(2)}" fill="none" stroke="#148677" stroke-width="${stroke}"/>`,
        `<rect x="${(imageX + region.background.x * scale).toFixed(2)}" y="${(imageY + region.background.y * scale).toFixed(2)}" width="${(region.background.width * scale).toFixed(2)}" height="${(region.background.height * scale).toFixed(2)}" fill="none" stroke="#6d8baf" stroke-width="${stroke}" stroke-dasharray="4 3"/>`,
        `<text x="${(imageX + band.x * scale).toFixed(2)}" y="${(imageY + (band.y + band.height) * scale + 14).toFixed(2)}" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#222">${escapeXml(label)}</text>`,
      ].join("");
    })
    .join("");

  const footer = input.captionLines
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${(MARGIN + contentHeight + MARGIN / 2 + index * FOOTER_LINE_HEIGHT + 14).toFixed(2)}" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#444">${escapeXml(line)}</text>`,
    )
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TOTAL_WIDTH}" height="${totalHeight.toFixed(0)}" viewBox="0 0 ${TOTAL_WIDTH} ${totalHeight.toFixed(0)}">`,
    `<rect width="${TOTAL_WIDTH}" height="${totalHeight.toFixed(0)}" fill="#ffffff"/>`,
    `<svg x="${imageX}" y="${imageY}" width="${panelWidth}" height="${imagePanelHeight}" viewBox="0 0 ${input.imageWidth} ${input.imageHeight}" preserveAspectRatio="xMidYMid meet">`,
    `<image href="${escapeXml(input.imageHref)}" x="0" y="0" width="${input.imageWidth}" height="${input.imageHeight}"/>`,
    rects,
    `</svg>`,
    `<svg x="${chartX.toFixed(2)}" y="${chartY.toFixed(2)}" width="${panelWidth.toFixed(2)}" height="${chartPanelHeight.toFixed(2)}" viewBox="0 0 ${viewBox.width} ${viewBox.height}" preserveAspectRatio="xMidYMid meet">${chart.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg>`,
    footer,
    `</svg>`,
  ].join("");
}
