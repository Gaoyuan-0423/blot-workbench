import { describe, expect, it } from "vitest";
import {
  measureRegionRollingBall,
  rollingBallBackground,
  rollingBallShrinkFactor,
  DEFAULT_ROLLING_BALL_RADIUS,
  ROLLING_BALL_ALGORITHM,
} from "./rolling-ball";
import type { LaneRegion, Raster } from "./pixels";

function raster(
  width: number,
  height: number,
  values: (x: number, y: number) => number,
  bitDepth: 8 | 16 = 8,
): Raster {
  const max = 2 ** bitDepth - 1;
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels[y * width + x] = Math.min(max, Math.max(0, values(x, y)));
  return {
    width,
    height,
    bitDepth,
    channels: 1,
    pixels,
    max,
    format: "PNG",
    warnings: [],
  };
}

function region(
  lane: number,
  band: LaneRegion["band"],
  source: LaneRegion["source"] = "manual",
): LaneRegion {
  return { lane, band, background: { x: 0, y: 0, width: 1, height: 1 }, source };
}

describe("rolling-ball engine", () => {
  it("documents the algorithm version", () => {
    expect(ROLLING_BALL_ALGORITHM).toBe("imagej1-rolling-ball-1");
    expect(DEFAULT_ROLLING_BALL_RADIUS).toBe(50);
  });

  it("maps radii to ImageJ shrink factors", () => {
    expect(rollingBallShrinkFactor(9)).toBe(1);
    expect(rollingBallShrinkFactor(10)).toBe(2);
    expect(rollingBallShrinkFactor(29)).toBe(2);
    expect(rollingBallShrinkFactor(30)).toBe(4);
    expect(rollingBallShrinkFactor(99)).toBe(4);
    expect(rollingBallShrinkFactor(100)).toBe(4);
    expect(rollingBallShrinkFactor(101)).toBe(8);
  });

  it("rejects radii outside the supported range", () => {
    const flat = raster(64, 64, () => 200);
    expect(() =>
      rollingBallBackground(flat, 9, { lightBackground: true }),
    ).toThrow();
    expect(() =>
      rollingBallBackground(flat, 201, { lightBackground: true }),
    ).toThrow();
  });

  it("returns a flat background for a flat image", () => {
    const flat = raster(96, 64, () => 200);
    const background = rollingBallBackground(flat, 50, {
      lightBackground: true,
    });
    for (const value of background) expect(Math.abs(value - 200)).toBeLessThan(1);
  });

  it("bridges a dark band: background stays near the field level", () => {
    // Wide bright field with one dark band narrower than the ball.
    const image = raster(
      160,
      120,
      (x) => (x >= 60 && x < 100 ? 100 : 200),
    );
    const background = rollingBallBackground(image, 50, {
      lightBackground: true,
    });
    for (let y = 0; y < 120; y++)
      for (let x = 60; x < 100; x++)
        expect(background[y * 160 + x]).toBeGreaterThan(190);
    // Anti-extensive in the inverted domain, up to smoothing spread at edges.
    for (let i = 0; i < background.length; i++)
      expect(background[i]).toBeGreaterThanOrEqual(image.pixels[i] - 2);
  });

  it("keeps an open background below bright bands on dark fields", () => {
    const image = raster(
      160,
      120,
      (x) => (x >= 60 && x < 100 ? 200 : 40),
    );
    const background = rollingBallBackground(image, 50, {
      lightBackground: false,
    });
    for (let y = 0; y < 120; y++)
      for (let x = 60; x < 100; x++)
        expect(background[y * 160 + x]).toBeLessThan(50);
    // Anti-extensive in the direct domain, up to smoothing spread at edges.
    for (let i = 0; i < background.length; i++)
      expect(background[i]).toBeLessThanOrEqual(image.pixels[i] + 2);
  });

  it("completes an 8-megapixel-class image within the interactive budget", () => {
    const image = raster(
      2048,
      1024,
      (x, y) => 180 + ((x * 7 + y * 13) % 20) - (x > 1000 ? 60 : 0),
    );
    const started = performance.now();
    rollingBallBackground(image, 50, { lightBackground: true });
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});

describe("rolling-ball measurement", () => {
  it("quantizes exactly like the reference formula (dark bands)", () => {
    const image = raster(40, 20, () => 100);
    const background = new Float64Array(40 * 20).fill(110);
    // signal per pixel = trunc(100 - 110 + 255.5) -> 245 clamped; 255 - 245 = 10.
    const measurement = measureRegionRollingBall(
      image,
      region(1, { x: 5, y: 5, width: 10, height: 8 }),
      "dark",
      background,
    );
    expect(measurement.net).toBe(10 * 10 * 8);
    expect(measurement.bandSum).toBe(10 * 10 * 8);
    expect(measurement.area).toBe(80);
    expect(measurement.saturatedFraction).toBe(0);
    expect(measurement.warnings).not.toContain("NON_POSITIVE_NET");
  });

  it("quantizes exactly like the reference formula (light bands)", () => {
    const image = raster(40, 20, () => 100);
    const background = new Float64Array(40 * 20).fill(90);
    // corrected = trunc(100 - 90 + 0.5) = 10 per pixel.
    const measurement = measureRegionRollingBall(
      image,
      region(1, { x: 2, y: 2, width: 6, height: 6 }),
      "light",
      background,
    );
    expect(measurement.net).toBe(10 * 36);
  });

  it("flags saturation when the corrected image clamps", () => {
    const image = raster(40, 20, () => 100);
    const background = new Float64Array(40 * 20); // bg 0 -> dark branch clamps at max
    const measurement = measureRegionRollingBall(
      image,
      region(1, { x: 2, y: 2, width: 4, height: 4 }),
      "dark",
      background,
    );
    expect(measurement.saturatedFraction).toBe(1);
    expect(measurement.warnings).toContain("ROLLING_BALL_SATURATED");
    expect(measurement.net).toBe(0);
    expect(measurement.warnings).toContain("NON_POSITIVE_NET");
  });

  it("keeps edge and candidate-review warnings", () => {
    const image = raster(40, 20, () => 100);
    const background = new Float64Array(40 * 20).fill(95);
    const measurement = measureRegionRollingBall(
      image,
      region(1, { x: 0, y: 0, width: 5, height: 5 }, "automatic"),
      "dark",
      background,
    );
    expect(measurement.warnings).toContain("BAND_TOUCHES_EDGE");
    expect(measurement.warnings).toContain("CANDIDATES_REQUIRE_REVIEW");
  });

  it("rejects band geometry outside the raster", () => {
    const image = raster(40, 20, () => 100);
    const background = new Float64Array(40 * 20);
    expect(() =>
      measureRegionRollingBall(
        image,
        region(1, { x: 38, y: 2, width: 5, height: 5 }),
        "dark",
        background,
      ),
    ).toThrow();
    expect(() =>
      measureRegionRollingBall(
        image,
        region(1, { x: 0, y: 0, width: 4, height: 4 }),
        "dark",
        new Float64Array(7),
      ),
    ).toThrow();
  });
});
