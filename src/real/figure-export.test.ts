import { describe, it, expect } from "vitest";
import { encodeFigureTiff } from "./figure-export";
import { decodeRaster } from "./pixels";

describe("figure export", () => {
  it("round-trips an opaque rendered RGB TIFF through the independent decoder", () => {
    const bytes = encodeFigureTiff(
      2,
      2,
      new Uint8Array([
        20, 20, 20, 255, 255, 255, 255, 255, 0, 0, 0, 255, 120, 120, 120, 255,
      ]),
    );
    const image = decodeRaster(bytes, "figure.tif");
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(image.bitDepth).toBe(8);
    expect(Array.from(image.pixels)).toEqual([20, 255, 0, 120]);
  });
  it("composites transparent figure pixels on white and rejects invalid dimensions", () => {
    const image = decodeRaster(
      encodeFigureTiff(1, 1, new Uint8Array([0, 0, 0, 0])),
      "figure.tif",
    );
    expect(image.pixels[0]).toBe(255);
    expect(() => encodeFigureTiff(2, 1, new Uint8Array(4))).toThrow();
  });
});
