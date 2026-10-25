import { describe, expect, it } from "vitest";
import { measureBands, type QuickBand, type Rect } from "../quick/analysis";
import type { QuickImage } from "../quick/image";
import { recognizeSingle } from "./model";
import {
  forward,
  fullToSource,
  inverse,
  measurePreparedBands,
  prepareRaster,
  sourceToFull,
  type Point,
} from "./preparation";

function image(width = 12, height = 10, background = 220): QuickImage {
  return {
    name: "source.png",
    dataUrl: "original-url",
    width,
    height,
    gray: new Uint8Array(width * height).fill(background),
  };
}

function contains(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x &&
    p.x < rect.x + rect.width &&
    p.y >= rect.y &&
    p.y < rect.y + rect.height
  );
}

function mark(source: QuickImage, rect: Rect, value: number): void {
  for (let y = rect.y; y < rect.y + rect.height; y++)
    for (let x = rect.x; x < rect.x + rect.width; x++)
      source.gray[y * source.width + x] = value;
}

function expectPoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("single-strip geometric preparation", () => {
  it("keeps identity pixels and existing measurements exact, without changing source or configuration", () => {
    const source = image();
    const band = {
      id: "a",
      rect: { x: 3, y: 4, width: 4, height: 2 },
      background: { x: 3, y: 1, width: 4, height: 2 },
    };
    mark(source, band.rect, 100);
    const original = source.gray.slice();
    const prepared = prepareRaster(source);
    expect(prepared.gray).toEqual(original);
    expect(prepared.valid.every((v) => v === 1)).toBe(true);
    expect(prepared.polarity).toBe("dark");
    const measurements = measurePreparedBands(prepared, [band], "dark");
    const expected = measureBands(
      original,
      source.width,
      source.height,
      [band],
      "dark",
    );
    expect(measurements).toEqual(
      expected.map((m) => ({ ...m, sourceArea: 8, backgroundSourceArea: 8 })),
    );
    expect(measurements[0].net).toBe(960);
    expectPoint(forward(prepared, { x: 3.5, y: 4.5 }), { x: 3.5, y: 4.5 });
    expect(source.gray).toEqual(original);
    expect(source.dataUrl).toBe("original-url");
    expect(prepared.metadata.measurement).toBe("original-8-bit-pixel-centers");
  });

  it("crops in the full corrected view and preserves exact identity-crop integration", () => {
    const source = image();
    const rect = { x: 3, y: 4, width: 4, height: 2 };
    mark(source, rect, 100);
    const crop = { x: 2, y: 1, width: 8, height: 7 };
    const prepared = prepareRaster(source, { crop });
    const band = {
      id: "a",
      rect: { x: 1, y: 3, width: 4, height: 2 },
      background: { x: 1, y: 0, width: 4, height: 2 },
    };
    expectPoint(forward(prepared, { x: 3.5, y: 4.5 }), { x: 1.5, y: 3.5 });
    expectPoint(inverse(prepared, { x: 1.5, y: 3.5 }), { x: 3.5, y: 4.5 });
    expect(measurePreparedBands(prepared, [band], "dark")[0].net).toBe(960);
    expect(prepared.gray[3 * 8 + 1]).toBe(100);
    expect(crop).toEqual({ x: 2, y: 1, width: 8, height: 7 });
    crop.x = 0;
    expect(prepared.crop.x).toBe(2);
    expect(prepared.metadata.crop.x).toBe(2);
  });

  it("recognizes light bands after cropping off a white screenshot frame, while padded crops keep source polarity", () => {
    const source = image(160, 80, 255);
    mark(source, { x: 10, y: 10, width: 140, height: 60 }, 15);
    for (let lane = 0; lane < 3; lane++)
      mark(source, { x: 25 + lane * 40, y: 32, width: 10, height: 8 }, 180);
    expect(prepareRaster(source).polarity).toBe("dark");
    const crop = prepareRaster(source, {
      crop: { x: 12, y: 12, width: 136, height: 54 },
    });
    expect(crop.polarity).toBe("light");
    const detected = recognizeSingle(
      { ...source, width: crop.width, height: crop.height, gray: crop.gray },
      crop.polarity,
    );
    expect(detected.bands).toHaveLength(3);
    expect(
      measurePreparedBands(crop, detected.bands, detected.polarity).map(
        (m) => m.net,
      ),
    ).toEqual([13200, 13200, 13200]);

    const framed = image(40, 40, 255);
    mark(framed, { x: 1, y: 1, width: 38, height: 38 }, 15);
    const padded = prepareRaster(framed, {
      straighten: [
        { x: 0, y: 0 },
        { x: 40, y: 40 },
      ],
      crop: { x: 8, y: 2, width: 20, height: 20 },
    });
    expect(padded.valid.includes(0)).toBe(true);
    // This border would naively choose light. It includes synthetic padding,
    // so it must not replace the original-image polarity estimate.
    expect(
      recognizeSingle({
        ...framed,
        width: padded.width,
        height: padded.height,
        gray: padded.gray,
      }).polarity,
    ).toBe("light");
    expect(padded.polarity).toBe("dark");
  });

  it("expands a quarter turn and maps original pixel centers to a lossless rotated preview", () => {
    const source = image(8, 6);
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++)
        source.gray[y * source.width + x] = y * 8 + x;
    const original = source.gray.slice();
    const prepared = prepareRaster(source, {
      straighten: [
        { x: 4, y: 0 },
        { x: 4, y: 6 },
      ],
    });
    expect(prepared.width).toBe(6);
    expect(prepared.height).toBe(8);
    expect(prepared.valid.every((v) => v === 1)).toBe(true);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 8; x++) {
        expectPoint(forward(prepared, { x: x + 0.5, y: y + 0.5 }), {
          x: y + 0.5,
          y: 8 - x - 0.5,
        });
        expect(prepared.gray[(7 - x) * 6 + y]).toBe(original[y * 8 + x]);
      }
    const band = {
      id: "a",
      rect: { x: 2, y: 1, width: 2, height: 3 },
      background: { x: 0, y: 1, width: 2, height: 3 },
    };
    // Rotated ROI is source x=4..6,y=2..3; background x=4..6,y=0..1.
    const expected = measureBands(
      original,
      8,
      6,
      [
        {
          id: "a",
          rect: { x: 4, y: 2, width: 3, height: 2 },
          background: { x: 4, y: 0, width: 3, height: 2 },
        },
      ],
      "light",
    )[0];
    expect(measurePreparedBands(prepared, [band], "light")[0]).toEqual({
      ...expected,
      sourceArea: 6,
      backgroundSourceArea: 6,
    });
    expect(source.gray).toEqual(original);
  });

  it("straightens two-point slopes and reverses combined rotation, curve and crop coordinates", () => {
    const source = image(120, 80);
    const config = {
      straighten: [
        { x: 10, y: 20 },
        { x: 110, y: 40 },
      ] as [Point, Point],
      curve: [
        { x: 10, y: 20 },
        { x: 60, y: 40 },
        { x: 110, y: 40 },
      ],
    };
    const straight = prepareRaster(source, { straighten: config.straighten });
    expect(sourceToFull(straight, config.straighten[0]).y).toBeCloseTo(
      sourceToFull(straight, config.straighten[1]).y,
      9,
    );
    const full = prepareRaster(source, config);
    const flatY = config.curve.map((p) => sourceToFull(full, p).y);
    expect(flatY[0]).toBeCloseTo(flatY[1], 9);
    expect(flatY[1]).toBeCloseTo(flatY[2], 9);
    const cropped = prepareRaster(source, {
      ...config,
      crop: { x: 4, y: 5, width: full.width - 8, height: full.height - 10 },
    });
    for (const point of [
      { x: 0, y: 0 },
      { x: 120, y: 80 },
      { x: 14.5, y: 7.5 },
      { x: 65.5, y: 36.5 },
    ]) {
      expectPoint(inverse(cropped, forward(cropped, point)), point);
      expectPoint(fullToSource(cropped, sourceToFull(cropped, point)), point);
      const fullPoint = forward(full, point);
      expectPoint(forward(cropped, point), {
        x: fullPoint.x - 4,
        y: fullPoint.y - 5,
      });
    }
    for (let y = 0; y < cropped.height; y++)
      for (let x = 0; x < cropped.width; x++) {
        expect(cropped.gray[y * cropped.width + x]).toBe(
          full.gray[(y + 5) * full.width + x + 4],
        );
        expect(cropped.valid[y * cropped.width + x]).toBe(
          full.valid[(y + 5) * full.width + x + 4],
        );
      }
    expect(JSON.parse(JSON.stringify(cropped.metadata))).toEqual(
      cropped.metadata,
    );
    expect(config.curve).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 40 },
      { x: 110, y: 40 },
    ]);
  });

  it("integrates original pixel centers for a 45-degree ROI, independently of nearest-neighbor display samples", () => {
    const source = image(8, 8);
    const band: QuickBand = {
      id: "a",
      rect: { x: 4, y: 4, width: 3, height: 3 },
      background: { x: 4, y: 7, width: 3, height: 2 },
    };
    // Independent closed-form rotation: x'=(x+y)/sqrt(2), y'=(y-x+8)/sqrt(2).
    const map = (x: number, y: number) => ({
      x: (x + y) / Math.SQRT2,
      y: (y - x + 8) / Math.SQRT2,
    });
    let area = 0,
      bgArea = 0;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const p = map(x + 0.5, y + 0.5);
        if (contains(band.rect, p)) {
          area++;
          source.gray[y * 8 + x] = 100;
        }
        if (contains(band.background!, p)) bgArea++;
      }
    const original = source.gray.slice();
    const prepared = prepareRaster(source, {
      straighten: [
        { x: 0, y: 0 },
        { x: 8, y: 8 },
      ],
    });
    const [measurement] = measurePreparedBands(prepared, [band], "dark");
    expect(measurement.warning).toBeUndefined();
    expect(measurement.sourceArea).toBe(area);
    expect(measurement.backgroundSourceArea).toBe(bgArea);
    expect(measurement.raw).toBe(area * 155);
    expect(measurement.background).toBe(area * 35);
    expect(measurement.net).toBe(area * 120);
    expect(area).not.toBe(band.rect.width * band.rect.height);
    // Destroy the detection preview: quantitative output must still be identical.
    prepared.gray.fill(0);
    expect(measurePreparedBands(prepared, [band], "dark")).toEqual([
      measurement,
    ]);
    expect(source.gray).toEqual(original);
  });

  it("measures a bent row with the independently derived piecewise vertical mapping", () => {
    const source = image(8, 6);
    const curve = [
      { x: 0, y: 2 },
      { x: 4, y: 0 },
      { x: 8, y: 2 },
    ];
    const band: QuickBand = {
      id: "a",
      rect: { x: 1, y: 4, width: 6, height: 2 },
      background: { x: 1, y: 2, width: 6, height: 1 },
    };
    let area = 0,
      backgroundArea = 0;
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 8; x++) {
        const sx = x + 0.5;
        const p = { x: sx, y: y + 0.5 + (sx <= 4 ? sx / 2 : 4 - sx / 2) };
        if (contains(band.rect, p)) {
          area++;
          source.gray[y * 8 + x] = 100;
        }
        if (contains(band.background!, p)) backgroundArea++;
      }
    const original = source.gray.slice();
    const prepared = prepareRaster(source, { curve });
    expect(prepared.fullHeight).toBe(8);
    const [measurement] = measurePreparedBands(prepared, [band], "dark");
    expect(measurement.warning).toBeUndefined();
    expect(measurement.sourceArea).toBe(area);
    expect(measurement.backgroundSourceArea).toBe(backgroundArea);
    expect(measurement.net).toBe(area * 120);
    for (const point of curve)
      expect(sourceToFull(prepared, point).y).toBeCloseTo(2, 9);
    expect(source.gray).toEqual(original);
  });

  it("rejects padding-covered band or background rectangles instead of integrating the filled preview", () => {
    const source = image(12, 12, 20);
    const prepared = prepareRaster(source, {
      straighten: [
        { x: 0, y: 0 },
        { x: 12, y: 12 },
      ],
    });
    expect(prepared.polarity).toBe("light");
    expect(prepared.valid[0]).toBe(0);
    expect(prepared.gray[0]).toBe(20);
    const outside = { x: 0, y: 0, width: 3, height: 3 };
    const inside = { x: 7, y: 7, width: 3, height: 3 };
    const [badBand] = measurePreparedBands(
      prepared,
      [{ id: "a", rect: outside, background: inside }],
      "light",
    );
    expect(badBand.net).toBeNull();
    expect(badBand.warning).toContain("取样框包含校直后空白");
    const [badBackground] = measurePreparedBands(
      prepared,
      [{ id: "a", rect: inside, background: outside }],
      "light",
    );
    expect(badBackground.net).toBeNull();
    expect(badBackground.warning).toContain("背景框包含校直后空白");
  });

  it("expanded rotated and curved bounds retain every original pixel exactly once", () => {
    const source = image(31, 23);
    for (let i = 0; i < source.gray.length; i++)
      source.gray[i] = (i * 17) % 256;
    const expectedRaw = Array.from(source.gray).reduce(
      (sum, value) => sum + value,
      0,
    );
    for (const straighten of [
      [
        { x: 1, y: 2 },
        { x: 30, y: 12 },
      ],
      [
        { x: 1, y: 22 },
        { x: 30, y: 3 },
      ],
    ] as [Point, Point][]) {
      for (const curve of [
        undefined,
        [
          { x: 2, y: 16 },
          { x: 12, y: 2 },
          { x: 29, y: 20 },
        ],
      ]) {
        const prepared = prepareRaster(source, { straighten, curve });
        const [measurement] = measurePreparedBands(
          prepared,
          [
            {
              id: "all",
              rect: {
                x: 0,
                y: 0,
                width: prepared.width,
                height: prepared.height,
              },
              background: null,
            },
          ],
          "light",
        );
        expect(measurement.sourceArea).toBe(source.gray.length);
        expect(measurement.raw).toBe(expectedRaw);
        expect(measurement.net).toBeNull();
      }
    }
  });

  it("rejects a curve knot crossing inside a rectangle even when its four corners are supported", () => {
    const source = image(8, 6);
    const prepared = prepareRaster(source, {
      curve: [
        { x: 0, y: 2 },
        { x: 4, y: 0 },
        { x: 8, y: 2 },
      ],
    });
    const [result] = measurePreparedBands(
      prepared,
      [
        {
          id: "a",
          rect: { x: 0, y: 1, width: 8, height: 2 },
          background: { x: 1, y: 4, width: 6, height: 1 },
        },
      ],
      "dark",
    );
    expect(result.net).toBeNull();
    expect(result.warning).toContain("取样框包含校直后空白");
  });

  it("preserves overlap and invalid-background safeguards in transformed measurements", () => {
    const source = image(8, 8);
    const prepared = prepareRaster(source, {
      straighten: [
        { x: 4, y: 0 },
        { x: 4, y: 8 },
      ],
    });
    const rect = { x: 2, y: 2, width: 3, height: 3 };
    const background = { x: 2, y: 6, width: 3, height: 2 };
    const overlapped = measurePreparedBands(
      prepared,
      [
        { id: "a", rect, background },
        { id: "b", rect: { ...rect }, background },
      ],
      "dark",
    );
    expect(
      overlapped.every(
        (m) => m.net === null && m.warning?.includes("取样框重叠"),
      ),
    ).toBe(true);
    expect(
      measurePreparedBands(
        prepared,
        [{ id: "a", rect, background: { ...background, y: 8 } }],
        "dark",
      )[0].warning,
    ).toContain("缺少有效背景");
    expect(
      measurePreparedBands(
        prepared,
        [{ id: "a", rect, background: { ...rect } }],
        "dark",
      )[0].warning,
    ).toContain("背景框与条带重叠");
    expect(measurePreparedBands(prepared, [], "dark")).toEqual([]);
  });

  it("validates geometry, crops, image budgets and lane identities before allocating transformed buffers", () => {
    const source = image();
    expect(() =>
      prepareRaster(source, {
        straighten: [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow("两个不同");
    expect(() =>
      prepareRaster(source, {
        curve: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow("3–8");
    expect(() =>
      prepareRaster(source, {
        curve: [
          { x: 1, y: 0 },
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      }),
    ).toThrow("同一列");
    expect(() =>
      prepareRaster(source, {
        curve: [
          { x: -1, y: 0 },
          { x: 2, y: 2 },
          { x: 3, y: 4 },
        ],
      }),
    ).toThrow("原图范围");
    expect(() =>
      prepareRaster(source, {
        straighten: [
          { x: NaN, y: 1 },
          { x: 4, y: 2 },
        ],
      }),
    ).toThrow("原图范围");
    expect(() =>
      prepareRaster(source, { crop: { x: 0.5, y: 0, width: 5, height: 5 } }),
    ).toThrow("坐标为整数");
    expect(() =>
      prepareRaster(source, { crop: { x: 0, y: 0, width: 13, height: 5 } }),
    ).toThrow("完整图片内");
    expect(() =>
      prepareRaster(image(16000, 16), {
        straighten: [
          { x: 0, y: 0 },
          { x: 16, y: 16 },
        ],
      }),
    ).toThrow("图片过大");
    const prepared = prepareRaster(source);
    const band = {
      id: "a",
      rect: { x: 2, y: 3, width: 2, height: 2 },
      background: null,
    };
    expect(() => measurePreparedBands(prepared, [band, band], "dark")).toThrow(
      "ID 重复",
    );
    expect(() =>
      measurePreparedBands(
        prepared,
        [{ ...band, rect: { ...band.rect, x: 100 } }],
        "dark",
      ),
    ).toThrow("越界");
  });
});

describe("original-depth preparation", () => {
  it("preserves 16-bit sub-preview differences after a 90 degree correction and crop", () => {
    const source: QuickImage = {
      name: "source.tif",
      dataUrl: "",
      width: 8,
      height: 6,
      bitDepth: 16,
      gray: new Float64Array(48).fill(60003),
    };
    for (let y = 2; y < 4; y++)
      for (let x = 2; x < 4; x++) source.gray[y * 8 + x] = 60002;
    const prepared = prepareRaster(source, {
      straighten: [
        { x: 4, y: 0 },
        { x: 4, y: 6 },
      ],
      crop: { x: 0, y: 2, width: 6, height: 6 },
    });
    expect(prepared.gray).toBeInstanceOf(Float64Array);
    expect(prepared.metadata.measurement).toBe("original-16-bit-pixel-centers");
    expect(prepared.polarity).toBe("dark");
    const measured = measurePreparedBands(
      prepared,
      [
        {
          id: "low-contrast",
          rect: { x: 2, y: 2, width: 2, height: 2 },
          background: { x: 0, y: 2, width: 2, height: 2 },
        },
      ],
      "dark",
    );
    expect(measured[0].sourceArea).toBe(4);
    expect(measured[0].net).toBe(4);
    expect(measured[0].raw).toBe(4 * (65535 - 60002));
  });
});
