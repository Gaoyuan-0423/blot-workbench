import { describe, expect, it } from "vitest";
import {
  detectBands,
  detectRows,
  measureBands,
  type QuickBand,
  type Rect,
} from "./analysis";

function paint(gray: Uint8Array, width: number, rect: Rect, value: number) {
  for (let y = rect.y; y < rect.y + rect.height; y++)
    for (let x = rect.x; x < rect.x + rect.width; x++)
      gray[y * width + x] = value;
}

function strip() {
  const width = 120,
    height = 40;
  const gray = new Uint8Array(width * height).fill(220);
  [20, 55, 90].forEach((x, i) =>
    paint(gray, width, { x, y: 16, width: 12, height: 8 }, 180 - 50 * i),
  );
  return { gray, width, height };
}

describe("quick measurements use original pixel sums", () => {
  const band: QuickBand = {
    id: "one",
    rect: { x: 1, y: 3, width: 4, height: 2 },
    background: { x: 1, y: 0, width: 4, height: 2 },
  };

  it("subtracts background scaled to band area, for both polarities", () => {
    const gray = new Uint8Array(48).fill(220);
    paint(gray, 6, band.rect, 120);
    const dark = measureBands(gray, 6, 8, [band], "dark")[0];
    expect(dark).toEqual({
      id: "one",
      raw: 8 * 135,
      background: 8 * 35,
      net: 800,
    });
    expect(
      measureBands(
        gray.map((value) => 255 - value),
        6,
        8,
        [band],
        "light",
      ),
    ).toEqual([dark]);
    const smallerBackground = {
      ...band,
      background: { ...band.background!, height: 1 },
    };
    expect(measureBands(gray, 6, 8, [smallerBackground], "dark")[0].net).toBe(
      800,
    );
  });

  it("does not manufacture zero or positive results for empty/reversed signal", () => {
    const gray = new Uint8Array(48).fill(220);
    expect(measureBands(gray, 6, 8, [band], "dark")[0]).toMatchObject({
      raw: 280,
      background: 280,
      net: null,
    });
    paint(gray, 6, band.rect, 240);
    expect(measureBands(gray, 6, 8, [band], "dark")[0]).toMatchObject({
      raw: 120,
      background: 280,
      net: null,
    });
  });

  it("fails missing, contaminated, overlapping, and undersized background", () => {
    const gray = new Uint8Array(48).fill(220);
    paint(gray, 6, band.rect, 120);
    for (const background of [
      null,
      band.rect,
      { x: 0, y: 0, width: 1, height: 1 },
    ]) {
      expect(
        measureBands(gray, 6, 8, [{ ...band, background }], "dark")[0].net,
      ).toBeNull();
    }
    paint(gray, 6, { x: 1, y: 0, width: 2, height: 2 }, 10);
    expect(measureBands(gray, 6, 8, [band], "dark")[0].warning).toContain(
      "背景变化较大",
    );
    const second: QuickBand = {
      id: "two",
      rect: band.background!,
      background: null,
    };
    expect(measureBands(gray, 6, 8, [band, second], "dark")[0].net).toBeNull();
  });

  it("rejects invalid pixel data and ROI geometry instead of silently clamping", () => {
    expect(() =>
      measureBands(new Uint8Array(47), 6, 8, [band], "dark"),
    ).toThrow();
    expect(() => measureBands([NaN], 1, 1, [], "dark")).toThrow();
    expect(() =>
      measureBands(
        new Uint8Array(48),
        6,
        8,
        [{ ...band, rect: { ...band.rect, x: -1 } }],
        "dark",
      ),
    ).toThrow();
  });
});

describe("quick projection detection", () => {
  it("finds unequal-intensity bands with common area and correct pixel integration", () => {
    const { gray, width, height } = strip();
    const detected = detectBands(gray, width, height, "dark");
    expect(detected.bands).toHaveLength(3);
    expect(
      new Set(
        detected.bands.map((band) => `${band.rect.width}x${band.rect.height}`),
      ).size,
    ).toBe(1);
    expect(detected.bands.every((band) => band.background !== null)).toBe(true);
    expect(
      measureBands(gray, width, height, detected.bands, "dark").map(
        (row) => row.net,
      ),
    ).toEqual([40 * 96, 90 * 96, 140 * 96]);
    const light = gray.map((value) => 255 - value);
    expect(detectBands(light, width, height, "light")).toEqual(detected);
    expect(measureBands(light, width, height, detected.bands, "light")).toEqual(
      measureBands(gray, width, height, detected.bands, "dark"),
    );
  });

  it("does not quantify blank images, edge-clipped bands, or multirow images as a single row", () => {
    const { gray, width, height } = strip();
    expect(
      detectBands(
        new Uint8Array(width * height).fill(220),
        width,
        height,
        "dark",
      ).bands,
    ).toEqual([]);
    const clipped = new Uint8Array(width * height).fill(220);
    paint(clipped, width, { x: 0, y: 16, width: 12, height: 8 }, 80);
    expect(
      detectBands(clipped, width, height, "dark").warnings.join(),
    ).toContain("左右边缘");
    const verticalClipped = new Uint8Array(width * height).fill(220);
    paint(verticalClipped, width, { x: 20, y: 0, width: 12, height: 8 }, 80);
    expect(
      detectBands(verticalClipped, width, height, "dark").warnings.join(),
    ).toContain("上下边缘");
    paint(gray, width, { x: 20, y: 2, width: 12, height: 4 }, 80);
    expect(detectBands(gray, width, height, "dark").warnings.join()).toContain(
      "多排",
    );
  });

  it("keeps an explicitly requested empty lane unavailable", () => {
    const width = 120,
      height = 40,
      gray = new Uint8Array(width * height).fill(220);
    paint(gray, width, { x: 14, y: 16, width: 12, height: 8 }, 100);
    paint(gray, width, { x: 94, y: 16, width: 12, height: 8 }, 160);
    const detected = detectBands(gray, width, height, "dark", 3);
    expect(detected.bands).toHaveLength(3);
    expect(detected.bands.map((band) => band.rect.width)).toEqual([40, 40, 40]);
    expect(
      measureBands(gray, width, height, detected.bands, "dark").map(
        (row) => row.net,
      ),
    ).toEqual([120 * 96, null, 60 * 96]);
    expect(() => detectBands(gray, width, height, "dark", 0)).toThrow();
  });

  it("preserves background margins when separating membrane rows", () => {
    const width = 120,
      height = 100,
      gray = new Uint8Array(width * height).fill(220);
    for (const y of [16, 66])
      for (const x of [20, 55, 90])
        paint(gray, width, { x, y, width: 12, height: 8 }, 100);
    const { rows } = detectRows(gray, width, height, "dark");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const crop = gray.slice(row.y * width, (row.y + row.height) * width);
      const detected = detectBands(crop, width, row.height, "dark");
      expect(detected.bands).toHaveLength(3);
      expect(
        measureBands(crop, width, row.height, detected.bands, "dark").every(
          (value) => value.net === 120 * 96,
        ),
      ).toBe(true);
    }
    expect(
      detectRows(
        new Uint8Array(width * height).fill(220),
        width,
        height,
        "dark",
      ),
    ).toMatchObject({ rows: [{ x: 0, y: 0, width, height }] });
  });
});
