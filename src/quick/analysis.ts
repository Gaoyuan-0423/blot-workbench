/** Deterministic 8-bit image measurements. Coordinates are original-image pixels. */
export type Rect = { x: number; y: number; width: number; height: number };
export type Polarity = "dark" | "light";
export type QuickBand = { id: string; rect: Rect; background: Rect | null };
export type QuickMeasurement = {
  id: string;
  raw: number;
  /** Estimated background integrated over the BAND area, in the same units as raw. */
  background: number | null;
  net: number | null;
  warning?: string;
};
type Span = { start: number; end: number };

function assertImage(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  polarity: Polarity,
): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    gray.length !== width * height
  )
    throw new Error("图片尺寸与像素不一致。");
  if (polarity !== "dark" && polarity !== "light")
    throw new Error("请选择深色或浅色条带。");
  for (let i = 0; i < gray.length; i++)
    if (!Number.isFinite(gray[i]) || gray[i] < 0 || gray[i] > 255)
      throw new Error("仅支持 0–255 灰度像素。");
}

function signal(value: number, polarity: Polarity): number {
  return polarity === "dark" ? 255 - value : value;
}

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    const start = Math.max(0, i - radius),
      end = Math.min(values.length - 1, i + radius);
    for (let j = start; j <= end; j++) sum += values[j];
    return sum / (end - start + 1);
  });
}

/** Projection segments are proposals, not a claim that every peak is a protein. */
function segments(values: number[], radius: number, minWidth: number): Span[] {
  const profile = smooth(values, radius);
  const baseline = quantile(profile, 0.2);
  const peak = Math.max(...profile);
  const noise = quantile(
    profile.slice(1).map((value, i) => Math.abs(value - profile[i])),
    0.5,
  );
  const threshold = baseline + Math.max(2, (peak - baseline) * 0.1, noise * 4);
  if (peak <= threshold) return [];
  const spans: Span[] = [];
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] <= threshold) continue;
    const start = i;
    while (i + 1 < profile.length && profile[i + 1] > threshold) i++;
    const previous = spans.at(-1);
    if (previous && start - previous.end - 1 <= Math.max(1, radius))
      previous.end = i;
    else spans.push({ start, end: i });
  }
  return spans.filter(({ start, end }) => end - start + 1 >= minWidth);
}

function rowSpans(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  polarity: Polarity,
): Span[] {
  const projection = Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      projection[y] += signal(gray[y * width + x], polarity);
    projection[y] /= width;
  }
  return segments(projection, Math.min(3, Math.floor(height / 160)), 2);
}

/** Split a membrane at blank vertical gaps, preserving context for local background. */
export function detectRows(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  polarity: Polarity,
): { rows: Rect[]; warnings: string[] } {
  assertImage(gray, width, height, polarity);
  const spans = rowSpans(gray, width, height, polarity);
  if (!spans.length || spans.length > 16)
    return {
      rows: [{ x: 0, y: 0, width, height }],
      warnings: ["未能可靠分开蛋白行，请裁剪到单排条带，保留上下空白背景。"],
    };
  const edges = [
    0,
    ...spans
      .slice(1)
      .map((span, i) => Math.floor((spans[i].end + 1 + span.start) / 2)),
    height,
  ];
  return {
    rows: spans.map((_, i) => ({
      x: 0,
      y: edges[i],
      width,
      height: edges[i + 1] - edges[i],
    })),
    warnings:
      spans.length > 1
        ? [
            "按水平信号自动分行，请核对每排是否对应同一蛋白；文字和边框也可能产生信号。",
          ]
        : [],
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function validRect(rect: Rect, width: number, height: number): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= width &&
    rect.y + rect.height <= height
  );
}

function localBackground(rect: Rect, height: number): Rect | null {
  const gap = Math.max(1, Math.ceil(rect.height * 0.15));
  const above = rect.y - gap,
    below = height - rect.y - rect.height - gap;
  // Prefer a full-height sample; otherwise use the side with more available pixels.
  const useAbove = above >= rect.height || above >= below;
  const h = Math.min(rect.height, useAbove ? above : below);
  if (h < 2 || h * rect.width < Math.max(4, rect.width * rect.height * 0.1))
    return null;
  return {
    x: rect.x,
    y: useAbove ? rect.y - gap - h : rect.y + rect.height + gap,
    width: rect.width,
    height: h,
  };
}

/** Detect one cropped row. An explicit count divides the image into equal lanes. */
export function detectBands(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  polarity: Polarity,
  count?: number,
): { bands: QuickBand[]; warnings: string[] } {
  assertImage(gray, width, height, polarity);
  if (
    count !== undefined &&
    (!Number.isInteger(count) || count < 1 || count > 32 || width / count < 3)
  )
    throw new Error("泳道数量须为 1–32，且每个泳道至少有 3 像素宽。");
  const failure = (warning: string) => ({ bands: [], warnings: [warning] });
  if (width < 8 || height < 8)
    return failure("图片过小，请导入清晰的单排条带图。");
  const rows = rowSpans(gray, width, height, polarity);
  if (!rows.length)
    return failure(
      "未找到明确条带，请检查深浅色模式，或裁剪到单排条带并保留空白背景。",
    );
  if (rows.length !== 1)
    return failure("检测到多排信号，请启用多排自动分行，或裁剪到单排条带。");
  const row = rows[0];
  if (row.start === 0 || row.end === height - 1)
    return failure(
      "条带或边框触及图片上下边缘，请保留完整条带和上下背景后重新导入。",
    );
  const projection = Array<number>(width).fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = row.start; y <= row.end; y++)
      projection[x] += signal(gray[y * width + x], polarity);
    projection[x] /= row.end - row.start + 1;
  }
  const spans = segments(
    projection,
    Math.min(3, Math.floor(width / 500)),
    Math.max(2, Math.floor(width / 250)),
  );
  if (spans.some((span) => span.start === 0 || span.end === width - 1))
    return failure(
      "条带或边框触及图片左右边缘，请保留完整条带及两侧空白后重新导入。",
    );
  if (count === undefined && (!spans.length || spans.length > 32))
    return failure(
      "未能分开泳道，请手动指定泳道数，或裁剪掉文字与边框后重试。",
    );
  const padY = Math.max(1, Math.ceil((row.end - row.start + 1) * 0.15));
  const top = Math.max(0, row.start - padY),
    bottom = Math.min(height, row.end + 1 + padY);
  let rectangles: Rect[];
  const warnings: string[] = [];
  if (count !== undefined) {
    const laneWidth = Math.floor(width / count);
    rectangles = Array.from({ length: count }, (_, i) => ({
      x: Math.round(((i + 0.5) * width) / count - laneWidth / 2),
      y: top,
      width: laneWidth,
      height: bottom - top,
    }));
    warnings.push(
      "已按整张图片等宽分配泳道，请核对框的位置；空泳道不会生成有效结果。",
    );
  } else {
    const commonWidth =
      Math.max(...spans.map((span) => span.end - span.start + 1)) + 2;
    rectangles = spans.map((span) => ({
      x: Math.round((span.start + span.end + 1 - commonWidth) / 2),
      y: top,
      width: commonWidth,
      height: bottom - top,
    }));
    if (
      rectangles.some((rect) => !validRect(rect, width, height)) ||
      rectangles.some((rect, i) =>
        rectangles.slice(i + 1).some((other) => overlaps(rect, other)),
      )
    )
      return failure(
        "条带间距或宽度差异较大，无法放置同尺寸取样框；请指定泳道数并检查框的位置。",
      );
    const gaps = spans
      .slice(1)
      .map(
        (span, i) =>
          (span.start + span.end - spans[i].start - spans[i].end) / 2,
      );
    if (gaps.length > 1 && Math.max(...gaps) > Math.min(...gaps) * 1.6)
      warnings.push(
        "泳道间距不均，可能漏掉弱条带或空泳道；请核对数量，必要时手动指定泳道数。",
      );
  }
  const bands = rectangles.map((rect, i) => ({
    id: `band-${i + 1}`,
    rect,
    background: localBackground(rect, height),
  }));
  if (bands.some((band) => !band.background))
    warnings.push(
      "部分条带周围没有足够空白背景，将不计算其净信号；请扩大裁剪范围。",
    );
  return { bands, warnings };
}

function stats(
  gray: ArrayLike<number>,
  width: number,
  rect: Rect,
  polarity: Polarity,
) {
  let sum = 0,
    squares = 0,
    saturated = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++)
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const value = signal(gray[y * width + x], polarity);
      sum += value;
      squares += value * value;
      if (value >= 254) saturated++;
    }
  const area = rect.width * rect.height,
    mean = sum / area;
  return {
    sum,
    area,
    mean,
    sd: Math.sqrt(Math.max(0, squares / area - mean * mean)),
    saturated,
  };
}

/** Integrated signal minus local mean background × ROI area; never clamp negative values to zero. */
export function measureBands(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  bands: QuickBand[],
  polarity: Polarity,
): QuickMeasurement[] {
  assertImage(gray, width, height, polarity);
  if (new Set(bands.map((band) => band.id)).size !== bands.length)
    throw new Error("条带 ID 重复。");
  if (bands.some((band) => !validRect(band.rect, width, height)))
    throw new Error("条带取样框越界或坐标不是整数。");
  return bands.map((band) => {
    const measured = stats(gray, width, band.rect, polarity);
    const result: QuickMeasurement = {
      id: band.id,
      raw: measured.sum,
      background: null,
      net: null,
    };
    if (
      bands.some((other) => other !== band && overlaps(band.rect, other.rect))
    )
      return { ...result, warning: "条带取样框重叠，请调整泳道数或重新裁剪。" };
    if (!band.background || !validRect(band.background, width, height))
      return { ...result, warning: "缺少有效背景，无法计算净信号。" };
    if (bands.some((other) => overlaps(band.background!, other.rect)))
      return { ...result, warning: "背景框与条带重叠，无法计算净信号。" };
    const background = stats(gray, width, band.background, polarity);
    if (background.area < Math.max(4, measured.area * 0.1))
      return { ...result, warning: "背景面积不足，无法计算净信号。" };
    if (background.sd > 20)
      return {
        ...result,
        warning: "背景变化较大，可能包含其他条带、文字或边框，请重新裁剪。",
      };
    result.background = background.mean * measured.area;
    const net = result.raw - result.background;
    if (net <= 0)
      return {
        ...result,
        warning: "扣背景后信号不大于零，请检查空泳道、取样框或深浅色模式。",
      };
    result.net = net;
    if (measured.saturated / measured.area > 0.01)
      result.warning =
        "存在接近饱和的像素，定量可能低估真实差异；请检查原始曝光。";
    return result;
  });
}
