import type { LaneMeasurement, LaneRegion, Raster, Signal } from "./pixels";

/**
 * Rolling-ball background subtraction numerically compatible with ImageJ 1.x
 * "Process › Subtract Background". Algorithm reference: ImageJ1's public-domain
 * `BackgroundSubtracter.java` / `RollingBall.java` (Wayne Rasband et al.).
 * This file is an independent TypeScript implementation of that documented
 * algorithm; the ImageJ parity suite (`scripts/imagej-parity/`) verifies the
 * numbers against a real ImageJ installation.
 *
 * ImageJ performs the subtraction on a float copy of the image. For a light
 * background (dark bands) it negates the pixels, rolls the ball across the
 * negated surface, subtracts, and negates the result back, so the exported
 * `background` below is always expressed in the original polarity. The
 * quantized, clamped correction reproduces what an ImageJ user measures after
 * this command (IntDen of the corrected image, LUT-inverted for dark bands).
 */

export const ROLLING_BALL_ALGORITHM = "imagej1-rolling-ball-1";
export const DEFAULT_ROLLING_BALL_RADIUS = 50;
export const ROLLING_BALL_RADIUS_RANGE = { min: 10, max: 200 } as const;

const f32 = Math.fround;
const clamp = (value: number, low: number, high: number) =>
  value < low ? low : value > high ? high : value;

function fail(message: string): never {
  throw new Error(message);
}

function validateRect(rect: LaneRegion["band"], raster: Raster) {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x + rect.width > raster.width ||
    rect.y + rect.height > raster.height
  )
    fail("ROI must contain whole pixels within the image.");
}

/** ImageJ shrinks the image before rolling; the factor only depends on radius. */
export function rollingBallShrinkFactor(radius: number): 1 | 2 | 4 | 8 {
  if (radius < 10) return 1;
  if (radius < 30) return 2;
  if (radius <= 100) return 4;
  return 8;
}

/** Arc-trim percentages from ImageJ's RollingBall (sphere rim trimmed before sampling). */
function arcTrimPercent(radius: number): number {
  if (radius <= 30) return 24;
  if (radius <= 100) return 32;
  return 40;
}

/** Three-point running average over rows, then columns, as ImageJ's smoothing pass. */
function smooth3(data: Float32Array, width: number, height: number): void {
  const filter = (length: number, first: number, stride: number) => {
    let v3 = data[first],
      v2 = v3;
    for (let i = 0, at = first; i < length; i++, at += stride) {
      const v1 = v2;
      v2 = v3;
      if (i < length - 1) v3 = data[at + stride];
      data[at] = f32(f32(f32(v1 + v2) + v3) / 3);
    }
  };
  for (let y = 0; y < height; y++) filter(width, y * width, 1);
  for (let x = 0; x < width; x++) filter(height, x, width);
}

/**
 * Ball cross-sections on the shrunken grid. ImageJ trims the sphere rim so the
 * patch stays inside the ball's arc; `half` is the patch half-width.
 */
function buildBall(smallRadius: number, trimPercent: number) {
  const half = Math.round(
    smallRadius - Math.trunc(Math.trunc(trimPercent * smallRadius) / 100),
  );
  const size = 2 * half + 1;
  const ball = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - half,
        dy = y - half;
      ball[y * size + x] = f32(
        Math.sqrt(Math.max(0, smallRadius * smallRadius - dx * dx - dy * dy)),
      );
    }
  return { ball, half };
}

/**
 * Erosion by the sphere, then dilation: the ball pressed under the surface.
 * ImageJ evaluates every shrunken position, including positions whose patch
 * extends past the grid; only in-bounds neighbours enter the min/max.
 */
function rollBall(
  small: Float32Array,
  smallWidth: number,
  smallHeight: number,
  ball: Float32Array,
  half: number,
): Float32Array {
  const size = 2 * half + 1;
  const pressed = new Float32Array(small.length).fill(-3.4028234663852886e38);
  for (let y = -half; y < smallHeight + half; y++)
    for (let x = -half; x < smallWidth + half; x++) {
      const x0 = Math.max(0, x - half),
        x1 = Math.min(smallWidth - 1, x + half);
      const y0 = Math.max(0, y - half),
        y1 = Math.min(smallHeight - 1, y + half);
      let lowest = 3.4028234663852886e38;
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++)
          lowest = Math.min(
            lowest,
            f32(
              small[yy * smallWidth + xx] -
                ball[(yy - y + half) * size + (xx - x + half)],
            ),
          );
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) {
          const at = yy * smallWidth + xx;
          const raised = f32(
            lowest + ball[(yy - y + half) * size + (xx - x + half)],
          );
          if (raised > pressed[at]) pressed[at] = raised;
        }
    }
  return pressed;
}

/**
 * ImageJ's bilinear weights mapping each full-resolution pixel to a shrunken
 * grid point and its right-hand neighbour. Weights may extrapolate at edges.
 */
function gridWeight(index: number, gridLength: number, shrink: number) {
  let base = Math.trunc((index - Math.trunc(shrink / 2)) / shrink);
  if (base < 0) base = 0;
  if (base > gridLength - 2) base = gridLength - 2;
  const weight = f32(1 - ((index + 0.5) / shrink - (base + 0.5)));
  return { base, weight };
}

export interface RollingBallOptions {
  /** ImageJ's "Light background" flag: dark bands on a bright field. */
  lightBackground: boolean;
  /** ImageJ performs a 3-point smoothing pass before rolling. */
  smoothing?: boolean;
}

/**
 * Compute the rolling-ball background surface in the original pixel polarity.
 * Pure function over the raster; callers cache the (expensive) result per
 * raster and radius.
 */
export function rollingBallBackground(
  raster: Pick<Raster, "width" | "height" | "pixels">,
  radius: number,
  options: RollingBallOptions,
): Float64Array {
  if (
    !Number.isFinite(radius) ||
    radius < ROLLING_BALL_RADIUS_RANGE.min ||
    radius > ROLLING_BALL_RADIUS_RANGE.max
  )
    fail(
      `Rolling-ball radius must be ${ROLLING_BALL_RADIUS_RANGE.min}-${ROLLING_BALL_RADIUS_RANGE.max}.`,
    );
  const { width, height } = raster;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++)
    data[i] = options.lightBackground
      ? f32(-raster.pixels[i])
      : f32(raster.pixels[i]);
  if (options.smoothing !== false) smooth3(data, width, height);

  let shrink = rollingBallShrinkFactor(radius);
  if (Math.ceil(width / shrink) < 2 || Math.ceil(height / shrink) < 2) shrink = 1;
  const smallWidth = Math.ceil(width / shrink);
  const smallHeight = Math.ceil(height / shrink);
  const small = new Float32Array(smallWidth * smallHeight);
  for (let y = 0; y < smallHeight; y++)
    for (let x = 0; x < smallWidth; x++) {
      let lowest = 3.4028234663852886e38;
      for (let yy = y * shrink; yy < Math.min(height, (y + 1) * shrink); yy++)
        for (let xx = x * shrink; xx < Math.min(width, (x + 1) * shrink); xx++)
          lowest = Math.min(lowest, data[yy * width + xx]);
      small[y * smallWidth + x] = lowest;
    }

  const smallRadius = radius / shrink;
  const { ball, half } = buildBall(smallRadius, arcTrimPercent(radius));
  const pressed = rollBall(small, smallWidth, smallHeight, ball, half);

  const background = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const { base: yb, weight: wy } = gridWeight(y, smallHeight, shrink);
    for (let x = 0; x < width; x++) {
      const { base: xb, weight: wx } = gridWeight(x, smallWidth, shrink);
      const a = f32(
        f32(pressed[yb * smallWidth + xb] * wx) +
          f32(pressed[yb * smallWidth + xb + 1] * (1 - wx)),
      );
      const b = f32(
        f32(pressed[(yb + 1) * smallWidth + xb] * wx) +
          f32(pressed[(yb + 1) * smallWidth + xb + 1] * (1 - wx)),
      );
      background[y * width + x] = f32(f32(a * wy) + f32(b * (1 - wy)));
    }
  }
  if (options.lightBackground)
    for (let i = 0; i < background.length; i++) background[i] = -background[i];
  return background;
}

export interface RollingBallMeasurement extends LaneMeasurement {
  /** Fraction of band pixels whose ImageJ correction was clamped at 0 or the depth maximum. */
  saturatedFraction: number;
}

/**
 * ImageJ-consistent band measurement on a rolling-ball corrected image.
 *
 * `net` equals the IntDen an ImageJ user reads after Subtract Background
 * (LUT-inverted for dark bands): each pixel is corrected, quantized to the
 * raster depth with clamping, and for dark bands re-inverted, so
 * `signal(i) = max − corrected(i)` (dark) or `corrected(i)` (light).
 */
export function measureRegionRollingBall(
  raster: Raster,
  region: LaneRegion,
  signal: Signal,
  background: Float64Array,
): RollingBallMeasurement {
  if (background.length !== raster.width * raster.height)
    fail("Rolling-ball background does not match the raster dimensions.");
  if (signal !== "dark" && signal !== "light") fail("Unknown signal polarity.");
  validateRect(region.band, raster);
  const offset = signal === "dark" ? raster.max : 0;
  let sum = 0,
    saturated = 0,
    backgroundSum = 0;
  const { width } = raster;
  for (let y = region.band.y; y < region.band.y + region.band.height; y++)
    for (let x = region.band.x; x < region.band.x + region.band.width; x++) {
      const at = y * width + x;
      const value = raster.pixels[at];
      if (!Number.isFinite(value) || value < 0 || value > raster.max)
        fail("Raster contains invalid intensity values.");
      // ImageJ's subtract truncates with a +0.5 bias and clamps to the depth.
      const corrected = Math.trunc(f32(f32(value - background[at]) + f32(offset + 0.5)));
      if (corrected < 0 || corrected > raster.max) saturated++;
      const clamped = clamp(corrected, 0, raster.max);
      sum += signal === "dark" ? raster.max - clamped : clamped;
      backgroundSum += background[at];
    }
  const area = region.band.width * region.band.height;
  const net = sum;
  const warnings: string[] = [...new Set(region.warnings ?? [])];
  if (saturated) warnings.push("ROLLING_BALL_SATURATED");
  if (net <= 0) warnings.push("NON_POSITIVE_NET");
  if (
    region.band.x === 0 ||
    region.band.y === 0 ||
    region.band.x + region.band.width === raster.width ||
    region.band.y + region.band.height === raster.height
  )
    warnings.push("BAND_TOUCHES_EDGE");
  if (region.source === "automatic") warnings.push("CANDIDATES_REQUIRE_REVIEW");
  return {
    lane: region.lane,
    area,
    bandSum: sum,
    backgroundMean: backgroundSum / area,
    net,
    clippedFraction: 0,
    saturatedFraction: saturated / area,
    warnings,
  };
}
