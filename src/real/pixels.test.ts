import { describe, expect, it } from "vitest";
import { encode, decode } from "fast-png";
import { zlibSync } from "fflate";
import {
  decodeRaster,
  inspectRasterDimensions,
  measureRegion,
  proposeRegions,
  rasterPreview,
  type Raster,
  type LaneRegion,
} from "./pixels";

// Independent minimal fixture writer: classic TIFF, one IFD, integer chunky strips.
function tiff(
  options: {
    width?: number;
    height?: number;
    depth?: 8 | 16;
    channels?: number;
    samples?: number[];
    little?: boolean;
    compression?: 1 | 5 | 8 | 32946;
    predictor?: number;
    rows?: number;
    photo?: number;
    orientation?: number;
    sampleFormat?: number;
    alpha?: number;
    next?: number;
    truncatePixels?: boolean;
    metadataPointers?: {
      tag: number;
      value: number;
      type?: number;
      count?: number;
    }[];
  } = {},
) {
  const width = options.width ?? 3,
    height = options.height ?? 2,
    depth = options.depth ?? 8,
    channels = options.channels ?? 1,
    little = options.little ?? true;
  const sampleValues =
    options.samples ??
    Array.from(
      { length: width * height * channels },
      (_, i) => (i * 17 + 3) % 2 ** depth,
    );
  const rows = options.rows ?? height,
    compression = options.compression ?? 1;
  const strips: Uint8Array[] = [];
  for (let row = 0; row < height; row += rows) {
    const samples = sampleValues.slice(
      row * width * channels,
      Math.min(row + rows, height) * width * channels,
    );
    if (options.predictor === 2)
      for (let y = 0; y < Math.min(rows, height - row); y++)
        for (let x = width * channels - 1; x >= channels; x--)
          samples[y * width * channels + x] =
            (samples[y * width * channels + x] -
              samples[y * width * channels + x - channels] +
              2 ** depth) %
            2 ** depth;
    let raw = new Uint8Array((samples.length * depth) / 8);
    const view = new DataView(raw.buffer);
    samples.forEach((value, i) =>
      depth === 8
        ? view.setUint8(i, value)
        : view.setUint16(i * 2, value, little),
    );
    if (options.truncatePixels) raw = raw.slice(0, -1);
    strips.push(
      compression === 5
        ? literalLzw(raw)
        : compression === 8 || compression === 32946
          ? zlibSync(raw)
          : raw,
    );
  }
  const fields: { tag: number; type: number; values: number[] }[] = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: Array(channels).fill(depth) },
    { tag: 259, type: 3, values: [compression] },
    { tag: 262, type: 3, values: [options.photo ?? (channels >= 3 ? 2 : 1)] },
    { tag: 273, type: 4, values: Array(strips.length).fill(0) },
    { tag: 274, type: 3, values: [options.orientation ?? 1] },
    { tag: 277, type: 3, values: [channels] },
    { tag: 278, type: 4, values: [rows] },
    { tag: 279, type: 4, values: strips.map((s) => s.length) },
    { tag: 284, type: 3, values: [1] },
    { tag: 317, type: 3, values: [options.predictor ?? 1] },
    { tag: 339, type: 3, values: [options.sampleFormat ?? 1] },
  ];
  if (channels === 2 || channels === 4)
    fields.push({ tag: 338, type: 3, values: [options.alpha ?? 2] });
  for (const entry of options.metadataPointers ?? [])
    fields.push({
      tag: entry.tag,
      type: entry.type ?? 4,
      values: Array(entry.count ?? 1).fill(entry.value),
    });
  let length = 8 + 2 + fields.length * 12 + 4;
  for (const field of fields)
    if (field.values.length * (field.type === 3 ? 2 : 4) > 4)
      length += field.values.length * (field.type === 3 ? 2 : 4);
  let stripAt = length;
  fields.find((f) => f.tag === 273)!.values = strips.map((strip) => {
    const at = stripAt;
    stripAt += strip.length;
    return at;
  });
  const data = new Uint8Array(stripAt),
    view = new DataView(data.buffer);
  data[0] = data[1] = little ? 73 : 77;
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, fields.length, little);
  let extra = 8 + 2 + fields.length * 12 + 4;
  fields.forEach((field, index) => {
    const at = 10 + index * 12,
      stride = field.type === 3 ? 2 : 4;
    view.setUint16(at, field.tag, little);
    view.setUint16(at + 2, field.type, little);
    view.setUint32(at + 4, field.values.length, little);
    let valueAt = at + 8;
    if (field.values.length * stride > 4) {
      valueAt = extra;
      view.setUint32(at + 8, extra, little);
      extra += field.values.length * stride;
    }
    field.values.forEach((value, j) =>
      stride === 2
        ? view.setUint16(valueAt + stride * j, value, little)
        : view.setUint32(valueAt + stride * j, value, little),
    );
  });
  view.setUint32(10 + fields.length * 12, options.next ?? 0, little);
  for (const strip of strips) {
    data.set(strip, length);
    length += strip.length;
  }
  return data;
}
function literalLzw(bytes: Uint8Array) {
  const codes: number[] = [];
  for (let i = 0; i < bytes.length; i += 200)
    codes.push(256, ...bytes.subarray(i, i + 200));
  codes.push(257);
  const output = new Uint8Array(Math.ceil((codes.length * 9) / 8));
  let bit = 0;
  for (const code of codes)
    for (let k = 8; k >= 0; k--, bit++)
      output[bit >> 3] |= ((code >> k) & 1) << (7 - (bit & 7));
  return output;
}
function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const value of bytes) {
    c ^= value;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    Array.from(type, (c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  view.setUint32(data.length + 8, crc(out.subarray(4, data.length + 8)));
  return out;
}
function modifyPng(
  bytes: Uint8Array,
  type: string,
  change: (data: Uint8Array) => Uint8Array,
) {
  const parts = [bytes.subarray(0, 8)],
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at),
      name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    parts.push(
      name === type
        ? pngChunk(name, change(bytes.slice(at + 8, at + 8 + length)))
        : bytes.subarray(at, at + length + 12),
    );
    at += length + 12;
  }
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
}
function raster(
  width = 80,
  height = 40,
  fill = 200,
  depth: 8 | 16 = 8,
): Raster {
  return {
    width,
    height,
    bitDepth: depth,
    channels: 1,
    pixels: new Float64Array(width * height).fill(fill),
    max: 2 ** depth - 1,
    format: "PNG",
    warnings: [],
  };
}
function paint(
  image: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
) {
  for (let row = y; row < y + h; row++)
    for (let col = x; col < x + w; col++)
      image.pixels[row * image.width + col] = value;
}
const region: LaneRegion = {
  lane: 1,
  band: { x: 2, y: 2, width: 2, height: 2 },
  background: { x: 2, y: 5, width: 2, height: 2 },
  source: "manual",
};

describe("raw integer decoding", () => {
  it.each([8, 16] as const)(
    "preserves %s-bit PNG grayscale values and separate display preview",
    (depth) => {
      const values =
        depth === 8
          ? [0, 1, 2, 127, 254, 255]
          : [0, 1, 257, 32769, 65534, 65535];
      const data =
        depth === 8 ? Uint8Array.from(values) : Uint16Array.from(values);
      const image = decodeRaster(
        encode({ width: 3, height: 2, depth, channels: 1, data }),
        "test.png",
      );
      expect([...image.pixels]).toEqual(values);
      expect(image.bitDepth).toBe(depth);
      const preview = decode(rasterPreview(image));
      expect(preview.depth).toBe(8);
      expect([...preview.data]).toEqual(
        values.map((v) => Math.round((v / image.max) * 255)),
      );
      expect([...image.pixels]).toEqual(values);
    },
  );
  it.each([true, false])(
    "decodes TIFF in little-endian=%s, including 16-bit RGB and strip predictor",
    (little) => {
      const values = [
        1, 257, 65535, 1001, 3002, 5003, 11, 22, 33, 500, 700, 900,
      ];
      const image = decodeRaster(
        tiff({
          width: 2,
          height: 2,
          channels: 3,
          depth: 16,
          samples: values,
          little,
          rows: 1,
          compression: 8,
          predictor: 2,
        }),
        "test.tiff",
      );
      expect([...image.pixels]).toEqual([21931, 3002, 22, 700]);
      expect(image.bitDepth).toBe(16);
      expect(image.channels).toBe(3);
      expect(image.warnings).toContain("RGB_MEAN_INTENSITY");
    },
  );
  it.each([1, 5, 8, 32946] as const)(
    "supports TIFF compression %s with known pixel values",
    (compression) => {
      const image = decodeRaster(
        tiff({ width: 30, height: 15, compression, rows: 5 }),
        "test.tif",
      );
      expect([...image.pixels]).toEqual(
        Array.from({ length: 450 }, (_, i) => (i * 17 + 3) % 256),
      );
    },
  );
  it("handles WhiteIsZero explicitly without discarding original depth", () => {
    const image = decodeRaster(
      tiff({ depth: 16, photo: 0, samples: [0, 1, 257, 32769, 65534, 65535] }),
      "test.tif",
    );
    expect([...image.pixels]).toEqual([65535, 65534, 65278, 32766, 1, 0]);
    expect(image.warnings).toContain("WHITE_IS_ZERO_INVERTED");
  });
  it("uses arithmetic RGB mean and accepts only fully opaque alpha", () => {
    for (const format of ["png", "tif"]) {
      const bytes =
        format === "png"
          ? encode({
              width: 1,
              height: 1,
              channels: 4,
              data: Uint8Array.of(2, 5, 11, 255),
            })
          : tiff({
              width: 1,
              height: 1,
              channels: 4,
              alpha: 1,
              samples: [2, 5, 11, 255],
            });
      const image = decodeRaster(bytes, `test.${format}`);
      expect(image.pixels[0]).toBe(6);
      expect(image.warnings).toContain("OPAQUE_ALPHA_IGNORED");
      const transparent =
        format === "png"
          ? encode({
              width: 1,
              height: 1,
              channels: 4,
              data: Uint8Array.of(2, 5, 11, 128),
            })
          : tiff({
              width: 1,
              height: 1,
              channels: 4,
              samples: [2, 5, 11, 128],
            });
      expect(() => decodeRaster(transparent, `test.${format}`)).toThrow(
        /transparent/i,
      );
    }
  });
  it("rejects multipage, orientation, signed data and truncated TIFF before quantification", () => {
    for (const options of [
      { next: 8 },
      { orientation: 6 },
      { sampleFormat: 2 },
      { truncatePixels: true },
    ])
      expect(() => decodeRaster(tiff(options), "test.tif")).toThrow();
    expect(() => decodeRaster(tiff(), "test.png")).toThrow(/extension/);
    expect(() => decodeRaster(new Uint8Array(20), "test.tif")).toThrow(
      /contents/,
    );
  });
  it("rejects truncated compressed TIFF payloads with otherwise valid directories", () => {
    for (const compression of [5, 8, 32946] as const) {
      expect(() =>
        decodeRaster(tiff({ compression, truncatePixels: true }), "test.tif"),
      ).toThrow(/length|dimensions/);
    }
  });
  it("ignores EXIF/GPS pointers without traversing or changing original bytes", () => {
    for (const little of [true, false])
      for (const pointer of [8, 0xffffffff]) {
        const bytes = tiff({
          little,
          metadataPointers: [
            { tag: 34665, value: pointer },
            { tag: 34853, value: pointer },
          ],
        });
        const original = bytes.slice();
        const image = decodeRaster(bytes, "with-exif.tif");
        expect([...image.pixels]).toEqual([3, 20, 37, 54, 71, 88]);
        expect(image.warnings).toContain("METADATA_SUBDIRECTORIES_IGNORED");
        expect(bytes).toEqual(original);
      }
    expect(() =>
      decodeRaster(
        tiff({ metadataPointers: [{ tag: 34665, value: 8, count: 2 }] }),
        "bad.tif",
      ),
    ).toThrow(/directory pointer/);
    expect(() =>
      decodeRaster(
        tiff({ metadataPointers: [{ tag: 330, value: 8 }] }),
        "subimage.tif",
      ),
    ).toThrow(/image subdirectories/);
  });
  it("inspects header dimensions without decoding or following metadata", () => {
    const bytes = tiff({
      width: 23,
      height: 17,
      metadataPointers: [{ tag: 34665, value: 0xffffffff }],
    });
    expect(inspectRasterDimensions(bytes, "test.tif")).toEqual({
      width: 23,
      height: 17,
    });
    expect(
      inspectRasterDimensions(
        encode({ width: 2, height: 1, channels: 1, data: Uint8Array.of(1, 2) }),
        "test.png",
      ),
    ).toEqual({ width: 2, height: 1 });
    expect(() =>
      inspectRasterDimensions(bytes.subarray(0, 11), "test.tif"),
    ).toThrow(/Truncated/);
  });
  it("rejects dimension bombs without allocating declared pixel storage", () => {
    const bytes = tiff();
    new DataView(bytes.buffer).setUint32(18, 0xffffffff, true);
    expect(() => decodeRaster(bytes, "test.tif")).toThrow(/dimensions/);
    const png = encode({
      width: 1,
      height: 1,
      channels: 1,
      data: Uint8Array.of(20),
    });
    const huge = modifyPng(png, "IHDR", (data) => {
      new DataView(data.buffer).setUint32(0, 0xffffffff);
      return data;
    });
    expect(() => decodeRaster(huge, "test.png")).toThrow(/dimensions/);
  });
  it("checks PNG CRC, decompressed length, and rejects animation/interlacing", () => {
    const png = encode({
      width: 2,
      height: 1,
      channels: 1,
      data: Uint8Array.of(20, 30),
    });
    const corrupt = png.slice();
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => decodeRaster(corrupt, "test.png")).toThrow(/checksum/);
    expect(() =>
      decodeRaster(
        modifyPng(png, "IDAT", () => zlibSync(new Uint8Array(2000))),
        "test.png",
      ),
    ).toThrow(/length/);
    expect(() =>
      decodeRaster(
        modifyPng(png, "IHDR", (data) => {
          data[12] = 1;
          return data;
        }),
        "test.png",
      ),
    ).toThrow(/interlac/);
    const animation = pngChunk("acTL", Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0));
    const animated = new Uint8Array(png.length + animation.length);
    animated.set(png.subarray(0, 33));
    animated.set(animation, 33);
    animated.set(png.subarray(33), 33 + animation.length);
    expect(() => decodeRaster(animated, "test.png")).toThrow(/Animated/);
  });
});

describe("pixel-based local background quantification", () => {
  it("matches hand calculations for both polarities and preserves negative net", () => {
    const image = raster(10, 10, 30, 16);
    paint(image, 2, 2, 2, 2, 10);
    image.pixels[2 * 10 + 2] = 14;
    const dark = measureRegion(image, region, "dark");
    expect(dark).toMatchObject({
      area: 4,
      bandSum: 44,
      backgroundMean: 30,
      net: 76,
      clippedFraction: 0,
    });
    expect(measureRegion(image, region, "light").net).toBe(-76);
    expect(measureRegion(image, region, "light").warnings).toContain(
      "NON_POSITIVE_NET",
    );
  });
  it("reports encoded boundary values, background clipping, and a possibly cropped band", () => {
    const image = raster(10, 10, 20);
    image.pixels[22] = 0;
    expect(measureRegion(image, region, "dark").clippedFraction).toBe(0.25);
    expect(measureRegion(image, region, "dark").warnings).toContain(
      "CLIPPED_PIXELS",
    );
    image.pixels[52] = 0;
    expect(measureRegion(image, region, "dark").warnings).toContain(
      "BACKGROUND_CLIPPED",
    );
    expect(
      measureRegion(
        image,
        { ...region, band: { x: 0, y: 0, width: 2, height: 2 } },
        "dark",
      ).warnings,
    ).toContain("BAND_TOUCHES_EDGE");
    image.pixels[22] = 255;
    expect(measureRegion(image, region, "light").clippedFraction).toBe(0.25);
  });
  it("rejects fractional, empty, out-of-bounds, overlapping and non-finite regions", () => {
    const image = raster(10, 10);
    for (const band of [
      { x: 2.5, y: 2, width: 2, height: 2 },
      { x: 2, y: 2, width: 0, height: 2 },
      { x: 9, y: 2, width: 2, height: 2 },
      region.background,
    ])
      expect(() => measureRegion(image, { ...region, band }, "dark")).toThrow(
        /ROI|overlap/,
      );
    image.pixels[22] = NaN;
    expect(() => measureRegion(image, region, "dark")).toThrow(
      /invalid intensity/,
    );
  });
});

describe("reviewable lane proposals", () => {
  it.each(["dark", "light"] as const)(
    "locates %s bands and leaves a right-hand marker out of the first N",
    (signal) => {
      const image = raster(140, 90, signal === "dark" ? 220 : 30);
      const value = signal === "dark" ? 40 : 210;
      paint(image, 12, 20, 18, 8, value);
      paint(image, 45, 20, 18, 8, value);
      paint(image, 100, 20, 10, 8, value);
      const found = proposeRegions(image, 2, signal);
      expect(found).toHaveLength(2);
      expect(found[0].band.x).toBeLessThanOrEqual(12);
      expect(found[1].band.x + found[1].band.width).toBeLessThan(100);
      expect(found[0].band.x + found[0].band.width).toBeLessThanOrEqual(
        found[1].band.x,
      );
      expect(found[0].warnings).toContain("EXTRA_LANES_IGNORED");
      expect(image.warnings).toEqual([]);
      for (const lane of found) {
        expect(lane.source).toBe("automatic");
        expect(measureRegion(image, lane, signal).net).toBeGreaterThan(0);
      }
    },
  );
  it("rejects a flat image, a connected plateau, and competing band rows rather than inventing lanes", () => {
    expect(() => proposeRegions(raster(), 2, "dark")).toThrow(/contrast/);
    const connected = raster();
    paint(connected, 10, 15, 50, 8, 10);
    expect(() => proposeRegions(connected, 2, "dark")).toThrow(
      /resolved lanes/,
    );
    const twoRows = raster(80, 80);
    paint(twoRows, 10, 10, 15, 8, 10);
    paint(twoRows, 40, 10, 15, 8, 10);
    paint(twoRows, 10, 50, 15, 8, 10);
    paint(twoRows, 40, 50, 15, 8, 10);
    expect(() => proposeRegions(twoRows, 2, "dark")).toThrow(/ambiguous/);
  });
  it("requires manual review for bands separated only at a higher threshold", () => {
    const image = raster(100, 70, 220);
    paint(image, 10, 25, 55, 8, 40);
    paint(image, 31, 25, 10, 8, 110);
    const found = proposeRegions(image, 2, "dark");
    expect(found).toHaveLength(2);
    expect(found[0].warnings).toContain("LOW_LANE_SEPARATION");
  });
});
