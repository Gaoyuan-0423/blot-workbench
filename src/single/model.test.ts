import { describe, expect, it } from "vitest";
import { measureBands } from "../quick/analysis";
import type { QuickImage } from "../quick/image";
import { recognizeSingle } from "./model";

function makeStrip(background = 230, bands = [190, 150, 110]): QuickImage {
  const width = 120,
    height = 48;
  const gray = new Uint8Array(width * height).fill(background);
  bands.forEach((value, i) => {
    for (let y = 20; y < 28; y++)
      for (let x = 14 + i * 40; x < 26 + i * 40; x++)
        gray[y * width + x] = value;
  });
  return { name: "test.png", dataUrl: "", width, height, gray };
}

describe("single strip recognition", () => {
  it("infers dark or light bands without modifying original pixels", () => {
    const dark = makeStrip();
    const original = dark.gray.slice();
    const recognized = recognizeSingle(dark);
    expect(recognized.polarity).toBe("dark");
    expect(recognized.bands).toHaveLength(3);
    expect(dark.gray).toEqual(original);
    const light = { ...dark, gray: dark.gray.map((pixel) => 255 - pixel) };
    const inverted = recognizeSingle(light);
    expect(inverted.polarity).toBe("light");
    expect(inverted.bands).toEqual(recognized.bands);
    const measurements = (image: QuickImage, result: typeof recognized) =>
      measureBands(
        image.gray,
        image.width,
        image.height,
        result.bands,
        result.polarity,
      );
    expect(measurements(dark, recognized).map((row) => row.net)).toEqual([
      3840, 7680, 11520,
    ]);
    expect(measurements(light, inverted)).toEqual(
      measurements(dark, recognized),
    );
  });

  it("uses the median border and honors an explicit polarity override", () => {
    const image = makeStrip();
    image.gray[0] = 0;
    image.gray[image.width - 1] = 0;
    expect(recognizeSingle(image).polarity).toBe("dark");
    expect(recognizeSingle(image, "light").polarity).toBe("light");
    expect(
      recognizeSingle(makeStrip(80, [60, 40, 20]), "dark").bands,
    ).toHaveLength(3);
  });

  it("rejects a membrane with multiple rows even with a requested lane count", () => {
    const image = makeStrip();
    for (let y = 5; y < 11; y++)
      for (let x = 14; x < 26; x++) image.gray[y * image.width + x] = 100;
    for (const count of [undefined, 3]) {
      const result = recognizeSingle(image, "auto", count);
      expect(result.bands).toEqual([]);
      expect(result.warnings).toEqual([
        "检测到多排条带，请先裁成单排条带后导入。",
      ]);
    }
  });

  it("does not generate measurements from blank or unreliable edge-clipped images", () => {
    const blank = makeStrip(230, []);
    const result = recognizeSingle(blank);
    expect(result.bands).toEqual([]);
    expect(result.warnings.join()).toContain("未找到明确条带");
    expect(
      measureBands(
        blank.gray,
        blank.width,
        blank.height,
        result.bands,
        result.polarity,
      ),
    ).toEqual([]);
    const clipped = makeStrip(230, []);
    for (let y = 20; y < 28; y++)
      for (let x = 0; x < 12; x++) clipped.gray[y * clipped.width + x] = 100;
    expect(recognizeSingle(clipped).warnings.join()).toContain("左右边缘");
  });

  it("propagates invalid-count errors so the interface can explain them", () => {
    expect(() => recognizeSingle(makeStrip(), "auto", 0)).toThrow("泳道数量");
    expect(() => recognizeSingle(makeStrip(), "auto", 33)).toThrow("泳道数量");
  });
});
