import {
  measureBands,
  type Polarity,
  type QuickBand,
  type QuickMeasurement,
  type Rect,
} from "../quick/analysis";
import { QUICK_IMAGE_LIMITS, type QuickImage } from "../quick/image";

export type Point = { x: number; y: number };
export type PreparationConfig = {
  /** Points use original-image edge coordinates; pixel centers are x+.5, y+.5. */
  straighten?: readonly [Point, Point];
  /** Three to eight original-image baseline points, interpolated after rotation. */
  curve?: readonly Point[];
  /** Integer rectangle in the complete corrected view, before cropping. */
  crop?: Rect;
};
export type PreparationMetadata = {
  version: "single-preparation-v1";
  coordinateSpace: "prepared-view-pixels";
  measurement: "original-8-bit-pixel-centers";
  order: "rotation-column-shift-crop";
  sourceSize: { width: number; height: number };
  fullSize: { width: number; height: number };
  straighten: [Point, Point] | null;
  curve: Point[];
  rotationRadians: number;
  rotationDegrees: number;
  rotationCos: number;
  rotationSin: number;
  rotationTranslation: Point;
  /** Curve knots in the expanded rotated coordinate system. */
  baseline: Point[];
  warpBaselineY: number;
  warpTranslationY: number;
  crop: Rect;
};
export type PreparedRaster = {
  source: QuickImage;
  gray: Uint8Array;
  /** 1 only where a preview pixel samples an original-image pixel. */
  valid: Uint8Array;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  crop: Rect;
  polarity: Polarity;
  metadata: PreparationMetadata;
};
export type PreparedMeasurement = QuickMeasurement & {
  sourceArea: number;
  backgroundSourceArea: number;
};

const EPSILON = 1e-9;
const clonePoint = ({ x, y }: Point): Point => ({
  x: x === 0 ? 0 : x,
  y: y === 0 ? 0 : y,
});
const cloneRect = ({ x, y, width, height }: Rect): Rect => ({
  x: x === 0 ? 0 : x,
  y: y === 0 ? 0 : y,
  width,
  height,
});

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

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function checkPoint(point: Point, width: number, height: number): void {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > width ||
    point.y > height
  )
    throw new Error("校直点须位于原图范围内。");
}

function borderMedian(
  source: Pick<QuickImage, "width" | "height" | "gray">,
): number {
  const histogram = new Uint32Array(256);
  let count = 0;
  const add = (x: number, y: number) => {
    histogram[source.gray[y * source.width + x]]++;
    count++;
  };
  for (let x = 0; x < source.width; x++) {
    add(x, 0);
    if (source.height > 1) add(x, source.height - 1);
  }
  for (let y = 1; y < source.height - 1; y++) {
    add(0, y);
    if (source.width > 1) add(source.width - 1, y);
  }
  const at = (index: number) => {
    let seen = 0;
    for (let value = 0; value < histogram.length; value++) {
      seen += histogram[value];
      if (seen > index) return value;
    }
    return 0;
  };
  return (at(Math.floor((count - 1) / 2)) + at(Math.floor(count / 2))) / 2;
}

function baselineAt(metadata: PreparationMetadata, x: number): number {
  const knots = metadata.baseline;
  if (!knots.length) return metadata.warpBaselineY;
  if (x <= knots[0].x) return knots[0].y;
  for (let i = 1; i < knots.length; i++) {
    if (x <= knots[i].x) {
      const left = knots[i - 1],
        right = knots[i];
      const t = (x - left.x) / (right.x - left.x);
      return left.y + t * (right.y - left.y);
    }
  }
  return knots[knots.length - 1].y;
}

function rotated(metadata: PreparationMetadata, point: Point): Point {
  const { rotationCos: c, rotationSin: s, rotationTranslation: t } = metadata;
  return {
    x: c * point.x - s * point.y + t.x,
    y: s * point.x + c * point.y + t.y,
  };
}

/** Original-image edge coordinates -> complete corrected view (without crop). */
export function sourceToFull(prepared: PreparedRaster, point: Point): Point {
  const m = prepared.metadata,
    r = rotated(m, point);
  return {
    x: r.x,
    y: r.y + m.warpBaselineY - baselineAt(m, r.x) + m.warpTranslationY,
  };
}

/** Complete corrected view -> original-image edge coordinates. */
export function fullToSource(prepared: PreparedRaster, point: Point): Point {
  const m = prepared.metadata;
  const x = point.x - m.rotationTranslation.x;
  const y =
    point.y -
    m.warpTranslationY -
    m.warpBaselineY +
    baselineAt(m, point.x) -
    m.rotationTranslation.y;
  return {
    x: m.rotationCos * x + m.rotationSin * y,
    y: -m.rotationSin * x + m.rotationCos * y,
  };
}

/** Original-image edge coordinates -> final, cropped preview coordinates. */
export function forward(prepared: PreparedRaster, point: Point): Point {
  const full = sourceToFull(prepared, point);
  return { x: full.x - prepared.crop.x, y: full.y - prepared.crop.y };
}

/** Final, cropped preview coordinates -> original-image edge coordinates. */
export function inverse(prepared: PreparedRaster, point: Point): Point {
  return fullToSource(prepared, {
    x: point.x + prepared.crop.x,
    y: point.y + prepared.crop.y,
  });
}

function checkedSize(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > QUICK_IMAGE_LIMITS.maxSide ||
    height > QUICK_IMAGE_LIMITS.maxSide ||
    width * height > QUICK_IMAGE_LIMITS.maxPixels
  )
    throw new Error("校直后的图片过大，请先使用较小的条带图片。");
}

/** Geometry produces detection pixels only. No source pixels are changed. */
export function prepareRaster(
  source: QuickImage,
  config: PreparationConfig = {},
): PreparedRaster {
  checkedSize(source.width, source.height);
  if (
    !(source.gray instanceof Uint8Array) ||
    source.gray.length !== source.width * source.height
  )
    throw new Error("图片尺寸与像素不一致。");
  const straighten = config.straighten
    ? (config.straighten.map(clonePoint) as [Point, Point])
    : null;
  if (straighten && straighten.length !== 2)
    throw new Error("整体校直需要两个不同的点。");
  let angle = 0;
  if (straighten) {
    straighten.forEach((p) => checkPoint(p, source.width, source.height));
    let dx = straighten[1].x - straighten[0].x,
      dy = straighten[1].y - straighten[0].y;
    if (dx * dx + dy * dy < 1) throw new Error("整体校直需要两个不同的点。");
    if (dx < 0 || (dx === 0 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    angle = -Math.atan2(dy, dx) || 0;
  }
  const snap = (n: number) =>
    Math.abs(n) < 1e-12
      ? 0
      : Math.abs(n - 1) < 1e-12
        ? 1
        : Math.abs(n + 1) < 1e-12
          ? -1
          : n;
  const c = snap(Math.cos(angle)),
    s = snap(Math.sin(angle));
  const corners = [
    { x: 0, y: 0 },
    { x: source.width, y: 0 },
    { x: source.width, y: source.height },
    { x: 0, y: source.height },
  ].map((p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y }));
  const minX = Math.min(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const fullWidth = Math.ceil(
    Math.max(...corners.map((p) => p.x)) - minX - EPSILON,
  );
  const curve = config.curve?.map(clonePoint) ?? [];
  if (curve.length && (curve.length < 3 || curve.length > 8))
    throw new Error("弯曲校直需要 3–8 个基线点。");
  curve.forEach((p) => checkPoint(p, source.width, source.height));
  const metadata: PreparationMetadata = {
    version: "single-preparation-v1",
    coordinateSpace: "prepared-view-pixels",
    measurement: "original-8-bit-pixel-centers",
    order: "rotation-column-shift-crop",
    sourceSize: { width: source.width, height: source.height },
    fullSize: { width: fullWidth, height: 0 },
    straighten,
    curve,
    rotationRadians: angle,
    rotationDegrees: (angle * 180) / Math.PI,
    rotationCos: c,
    rotationSin: s,
    rotationTranslation: { x: -minX || 0, y: -minY || 0 },
    baseline: [],
    warpBaselineY: 0,
    warpTranslationY: 0,
    crop: { x: 0, y: 0, width: 0, height: 0 },
  };
  metadata.baseline = curve
    .map((p) => rotated(metadata, p))
    .sort((a, b) => a.x - b.x);
  if (
    metadata.baseline.some((p, i, knots) => i > 0 && p.x - knots[i - 1].x < 1)
  )
    throw new Error("弯曲基线点须从左到右分开，不能位于同一列。");
  if (curve.length)
    metadata.warpBaselineY =
      metadata.baseline.reduce((sum, p) => sum + p.y, 0) / curve.length;

  // A piecewise affine warp reaches extrema at polygon corners or knot crossings.
  const boundary = corners.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  const samples = [...boundary];
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length];
    for (const knot of metadata.baseline) {
      if (Math.abs(b.x - a.x) < EPSILON) continue;
      const t = (knot.x - a.x) / (b.x - a.x);
      if (t > 0 && t < 1) samples.push({ x: knot.x, y: a.y + t * (b.y - a.y) });
    }
  }
  const ys = samples.map(
    (p) => p.y + metadata.warpBaselineY - baselineAt(metadata, p.x),
  );
  const warpedMinY = Math.min(...ys);
  metadata.warpTranslationY = -warpedMinY || 0;
  const fullHeight = Math.ceil(Math.max(...ys) - warpedMinY - EPSILON);
  checkedSize(fullWidth, fullHeight);
  const crop = config.crop
    ? cloneRect(config.crop)
    : { x: 0, y: 0, width: fullWidth, height: fullHeight };
  if (!validRect(crop, fullWidth, fullHeight))
    throw new Error("裁剪范围须位于校直后的完整图片内，且坐标为整数。");
  metadata.fullSize = { width: fullWidth, height: fullHeight };
  metadata.crop = cloneRect(crop);
  const gray = new Uint8Array(crop.width * crop.height);
  const valid = new Uint8Array(gray.length);
  const background = borderMedian(source);
  gray.fill(Math.round(background));
  const prepared: PreparedRaster = {
    source,
    gray,
    valid,
    width: crop.width,
    height: crop.height,
    fullWidth,
    fullHeight,
    crop,
    polarity: background >= 127.5 ? "dark" : "light",
    metadata,
  };
  for (let y = 0; y < prepared.height; y++) {
    for (let x = 0; x < prepared.width; x++) {
      const point = inverse(prepared, { x: x + 0.5, y: y + 0.5 });
      if (
        point.x < 0 ||
        point.y < 0 ||
        point.x >= source.width ||
        point.y >= source.height
      )
        continue;
      const index = y * prepared.width + x;
      gray[index] =
        source.gray[Math.floor(point.y) * source.width + Math.floor(point.x)];
      valid[index] = 1;
    }
  }
  // A user crop may remove a surrounding screenshot frame of the opposite
  // polarity. Infer its own border only when the complete crop is supported;
  // rotated/warped padding must never influence automatic polarity.
  if (
    config.crop &&
    fullySupported(prepared, {
      x: 0,
      y: 0,
      width: prepared.width,
      height: prepared.height,
    })
  )
    prepared.polarity = borderMedian(prepared) >= 127.5 ? "dark" : "light";
  return prepared;
}

/** Every point in the rectangle must have original-image support, including edges. */
function fullySupported(prepared: PreparedRaster, rect: Rect): boolean {
  const xs = [rect.x, rect.x + rect.width];
  for (const knot of prepared.metadata.baseline) {
    const x = knot.x - prepared.crop.x;
    if (x > rect.x && x < rect.x + rect.width) xs.push(x);
  }
  for (const x of xs)
    for (const y of [rect.y, rect.y + rect.height]) {
      const p = inverse(prepared, { x, y });
      if (
        p.x < -EPSILON ||
        p.y < -EPSILON ||
        p.x > prepared.source.width + EPSILON ||
        p.y > prepared.source.height + EPSILON
      )
        return false;
    }
  return true;
}

type Stats = { sum: number; squares: number; area: number; saturated: number };

/**
 * Scan source pixels once, accumulating into a compressed grid formed by all ROI
 * edges. Measurement costs O(source pixels + ROI grid), never pixels × lanes.
 * Interpolation and padded preview pixels never enter these accumulators.
 */
function sourceStats(
  prepared: PreparedRaster,
  rectangles: Rect[],
  polarity: Polarity,
): Map<Rect, Stats> {
  const xs = [...new Set(rectangles.flatMap((r) => [r.x, r.x + r.width]))].sort(
    (a, b) => a - b,
  );
  const ys = [
    ...new Set(rectangles.flatMap((r) => [r.y, r.y + r.height])),
  ].sort((a, b) => a - b);
  const columns = xs.length - 1,
    rows = ys.length - 1;
  const count = columns * rows;
  const sums = new Float64Array(count),
    squares = new Float64Array(count);
  const areas = new Uint32Array(count),
    saturated = new Uint32Array(count);
  const xIndex = new Int16Array(prepared.width).fill(-1),
    yIndex = new Int16Array(prepared.height).fill(-1);
  for (let i = 0; i < columns; i++) xIndex.fill(i, xs[i], xs[i + 1]);
  for (let i = 0; i < rows; i++) yIndex.fill(i, ys[i], ys[i + 1]);
  const extents = rectangles.map((r) => ({
    rect: r,
    left: xs.indexOf(r.x),
    right: xs.indexOf(r.x + r.width),
    top: ys.indexOf(r.y),
    bottom: ys.indexOf(r.y + r.height),
  }));
  const active = new Uint8Array(count);
  for (const r of extents)
    for (let y = r.top; y < r.bottom; y++)
      active.fill(1, y * columns + r.left, y * columns + r.right);
  const { source, metadata: m, crop } = prepared;
  for (let y = 0; y < source.height; y++) {
    const sy = y + 0.5;
    for (let x = 0; x < source.width; x++) {
      const sx = x + 0.5;
      const rx =
        m.rotationCos * sx - m.rotationSin * sy + m.rotationTranslation.x;
      const vx = Math.floor(rx - crop.x);
      if (vx < 0 || vx >= prepared.width) continue;
      const xi = xIndex[vx];
      if (xi < 0) continue;
      const ry =
        m.rotationSin * sx + m.rotationCos * sy + m.rotationTranslation.y;
      const vy = Math.floor(
        ry + m.warpBaselineY - baselineAt(m, rx) + m.warpTranslationY - crop.y,
      );
      if (vy < 0 || vy >= prepared.height) continue;
      const yi = yIndex[vy];
      if (yi < 0) continue;
      const index = yi * columns + xi;
      if (!active[index]) continue;
      const pixel = source.gray[y * source.width + x];
      const signal = polarity === "dark" ? 255 - pixel : pixel;
      sums[index] += signal;
      squares[index] += signal * signal;
      areas[index]++;
      if (signal >= 254) saturated[index]++;
    }
  }
  const result = new Map<Rect, Stats>();
  for (const r of extents) {
    const stats = { sum: 0, squares: 0, area: 0, saturated: 0 };
    for (let y = r.top; y < r.bottom; y++)
      for (let x = r.left; x < r.right; x++) {
        const i = y * columns + x;
        stats.sum += sums[i];
        stats.squares += squares[i];
        stats.area += areas[i];
        stats.saturated += saturated[i];
      }
    result.set(r.rect, stats);
  }
  return result;
}

export function measurePreparedBands(
  prepared: PreparedRaster,
  bands: QuickBand[],
  polarity: Polarity,
): PreparedMeasurement[] {
  if (polarity !== "dark" && polarity !== "light")
    throw new Error("请选择深色或浅色条带。");
  if (bands.length > 32)
    throw new Error("泳道数量须为 1–32，且每个泳道至少有 3 像素宽。");
  if (new Set(bands.map((b) => b.id)).size !== bands.length)
    throw new Error("条带 ID 重复。");
  if (bands.some((b) => !validRect(b.rect, prepared.width, prepared.height)))
    throw new Error("条带取样框越界或坐标不是整数。");
  if (!bands.length) return [];
  const m = prepared.metadata;
  if (
    m.rotationCos === 1 &&
    m.rotationSin === 0 &&
    m.baseline.every((p) => p.y === m.warpBaselineY)
  ) {
    const offset = (r: Rect): Rect => ({
      ...r,
      x: r.x + prepared.crop.x,
      y: r.y + prepared.crop.y,
    });
    const shifted = bands.map((b) => ({
      ...b,
      rect: offset(b.rect),
      background:
        b.background && validRect(b.background, prepared.width, prepared.height)
          ? offset(b.background)
          : null,
    }));
    return measureBands(
      prepared.source.gray,
      prepared.source.width,
      prepared.source.height,
      shifted,
      polarity,
    ).map((measurement, i) => ({
      ...measurement,
      sourceArea: bands[i].rect.width * bands[i].rect.height,
      backgroundSourceArea: shifted[i].background
        ? shifted[i].background!.width * shifted[i].background!.height
        : 0,
    }));
  }
  const rectangles = bands.flatMap((b) => [
    b.rect,
    ...(b.background && validRect(b.background, prepared.width, prepared.height)
      ? [b.background]
      : []),
  ]);
  const allStats = sourceStats(prepared, rectangles, polarity);
  return bands.map((band) => {
    const measured = allStats.get(band.rect)!;
    const bg = band.background ? allStats.get(band.background) : undefined;
    const result: PreparedMeasurement = {
      id: band.id,
      raw: measured.sum,
      background: null,
      net: null,
      sourceArea: measured.area,
      backgroundSourceArea: bg?.area ?? 0,
    };
    const warn = (warning: string) => ({ ...result, warning });
    if (
      bands.some((other) => other !== band && overlaps(band.rect, other.rect))
    )
      return warn("条带取样框重叠，请调整泳道数或重新裁剪。");
    if (!fullySupported(prepared, band.rect) || !measured.area)
      return warn("取样框包含校直后空白区域，请将框移回原图范围内。");
    if (!band.background || !bg) return warn("缺少有效背景，无法计算净信号。");
    if (bands.some((other) => overlaps(band.background!, other.rect)))
      return warn("背景框与条带重叠，无法计算净信号。");
    if (!fullySupported(prepared, band.background))
      return warn("背景框包含校直后空白区域，请将框移回原图范围内。");
    if (bg.area < Math.max(4, measured.area * 0.1))
      return warn("背景面积不足，无法计算净信号。");
    const mean = bg.sum / bg.area;
    if (Math.sqrt(Math.max(0, bg.squares / bg.area - mean * mean)) > 20)
      return warn("背景变化较大，可能包含其他条带、文字或边框，请重新裁剪。");
    result.background = mean * measured.area;
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
