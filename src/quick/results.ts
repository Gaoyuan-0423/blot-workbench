import type { QuickBand } from "./analysis";

export interface Signal {
  id: string;
  raw: number;
  background: number | null;
  net: number | null;
  warning?: string;
}
export function relativeSignals(
  target: Signal[],
  reference: Signal[] | null,
  control: number,
) {
  const paired = !reference || reference.length === target.length;
  const ratios = target.map((s, i) => {
    const ref = reference?.[i]?.net;
    if (
      !paired ||
      s.net == null ||
      !Number.isFinite(s.net) ||
      s.net <= 0 ||
      (reference && (ref == null || !Number.isFinite(ref) || ref <= 0))
    )
      return null;
    const ratio = reference ? s.net / ref! : s.net;
    return Number.isFinite(ratio) ? ratio : null;
  });
  const baseline = ratios[control];
  return ratios.map((value) => {
    if (value == null || baseline == null || baseline <= 0) return null;
    const normalized = value / baseline;
    return Number.isFinite(normalized) ? normalized : null;
  });
}

export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  // Spreadsheet apps may ignore leading whitespace before a formula marker.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function resultCsv(input: {
  file: string;
  protein: string;
  polarity: string;
  bitDepth?: 8 | 16;
  referenceBitDepth?: 8 | 16;
  labels: string[];
  control: number;
  bands: QuickBand[];
  signals: Signal[];
  reference: Signal[] | null;
  referenceFile: string;
  referenceProtein: string;
  values: (number | null)[];
  rowY: number;
  referenceBands?: QuickBand[];
  referenceRowY?: number;
  referencePolarity?: string;
  warnings?: string[];
  preparation?: {
    exposureId: string;
    sourceWidth: number;
    sourceHeight: number;
    metadata: unknown;
    transformed: boolean;
    areas: { source: number; background: number }[];
  };
}) {
  const header = [
    "source",
    "protein",
    "lane",
    "control_lane",
    "polarity",
    "raw_signal",
    "background_signal",
    "net_signal",
    "reference_source",
    "reference_protein",
    "reference_net_signal",
    "relative_value",
    "roi_x",
    "roi_y",
    "roi_width",
    "roi_height",
    "background_roi",
    "method",
    "status",
    "note",
    "reference_raw_signal",
    "reference_background_signal",
    "reference_polarity",
    "reference_roi_x",
    "reference_roi_y",
    "reference_roi_width",
    "reference_roi_height",
    "reference_background_roi",
    "reference_warning",
    "warnings",
  ];
  if (input.preparation)
    header.push(
      "coordinate_space",
      "source_width",
      "source_height",
      "preparation",
      "source_pixel_area",
      "background_source_pixel_area",
      "exposure_id",
    );
  const validValues = relativeSignals(
    input.signals,
    input.reference,
    input.control,
  );
  const pairingWarning =
    input.reference && input.reference.length !== input.signals.length
      ? "Reference lane count does not match target lane count; normalization unavailable"
      : "";
  const rows = input.signals.map((s, i) => {
    const b = input.bands[i];
    const bg = b.background
      ? { ...b.background, y: b.background.y + input.rowY }
      : null;
    const reference = input.reference?.[i];
    const referenceBand = reference ? input.referenceBands?.[i] : undefined;
    const referenceOffset = input.referenceRowY ?? 0;
    const referenceBackground = referenceBand?.background
      ? {
          ...referenceBand.background,
          y: referenceBand.background.y + referenceOffset,
        }
      : null;
    const value =
      validValues[i] != null && Number.isFinite(input.values[i])
        ? input.values[i]
        : null;
    const note = [
      s.warning,
      value == null
        ? "Relative value unavailable; check control and reference pairing"
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const warnings = [
      ...new Set(
        [
          ...(input.warnings ?? []),
          note,
          pairingWarning,
          reference?.warning ? `Reference: ${reference.warning}` : "",
          reference && !referenceBand
            ? "Reference ROI metadata unavailable"
            : "",
        ].filter(Boolean),
      ),
    ].join(" | ");
    return [
      input.file,
      input.protein,
      input.labels[i] || `泳道 ${i + 1}`,
      input.labels[input.control] || `泳道 ${input.control + 1}`,
      input.polarity,
      s.raw,
      s.background,
      s.net,
      input.referenceFile,
      input.referenceProtein,
      reference?.net,
      value,
      b.rect.x,
      b.rect.y + input.rowY,
      b.rect.width,
      b.rect.height,
      bg ? JSON.stringify(bg) : "",
      input.preparation
        ? `single-preparation-v1; ${input.bitDepth ?? 8}-bit decoded source pixels; original pixel center integration; local mean background subtraction; relative to selected control`
        : `quick-v1; ${input.bitDepth ?? 8}-bit pixels; local mean background subtraction; optional reference ratio; relative to selected control${input.reference ? `; reference ${input.referenceBitDepth ?? 8}-bit pixels` : ""}`,
      "UNREVIEWED_PIXEL_ESTIMATE",
      note,
      reference?.raw,
      reference?.background,
      input.reference ? input.referencePolarity : "",
      referenceBand?.rect.x,
      referenceBand ? referenceBand.rect.y + referenceOffset : null,
      referenceBand?.rect.width,
      referenceBand?.rect.height,
      referenceBackground ? JSON.stringify(referenceBackground) : "",
      reference?.warning,
      warnings,
      ...(input.preparation
        ? [
            input.preparation.transformed ? "prepared_pixels" : "source_pixels",
            input.preparation.sourceWidth,
            input.preparation.sourceHeight,
            JSON.stringify(input.preparation.metadata),
            input.preparation.areas[i]?.source,
            input.preparation.areas[i]?.background,
            input.preparation.exposureId,
          ]
        : []),
    ];
  });
  return (
    "\uFEFF" +
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}
