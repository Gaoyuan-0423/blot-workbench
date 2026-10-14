import { decode as decodePng, encode as encodePng } from "fast-png";
import { unzlibSync } from "fflate";
import { decode as decodeTiff } from "tiff";

export type Rect = { x: number; y: number; width: number; height: number };
export type Signal = "dark" | "light";
export interface Raster {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  /** Original channel count. pixels contains one arithmetic-mean intensity per pixel. */
  channels: number;
  pixels: Float64Array;
  max: number;
  format: "TIFF" | "PNG";
  warnings: string[];
}
export interface LaneRegion {
  lane: number;
  band: Rect;
  background: Rect;
  source: "automatic" | "manual";
  /** Persisted proposal diagnostics, independent of immutable decoder metadata. */
  warnings?: string[];
}
export interface LaneMeasurement {
  lane: number;
  area: number;
  bandSum: number;
  backgroundMean: number;
  net: number;
  clippedFraction: number;
  warnings: string[];
}

// Bounds are checked before invoking a decoder or allocating pixel buffers.
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 8 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
type Header = {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  channels: number;
  warnings: string[];
  safeBytes?: Uint8Array;
};

function fail(message: string): never {
  throw new Error(message);
}
function checkDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  ) {
    fail(
      "Image dimensions exceed the supported limit (16384 per side, 8388608 pixels).",
    );
  }
}
function inBounds(offset: number, length: number, total: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > total
  )
    fail("Truncated or invalid image container.");
}

/** Fixed output capacity prevents a forged compressed stream from expanding decoder memory. */
function checkZlib(data: Uint8Array, expected: number) {
  const decoded = unzlibSync(data, { out: new Uint8Array(expected + 1) });
  if (decoded.length !== expected)
    fail("Compressed image data length does not match its dimensions.");
  // fflate intentionally does not validate Adler-32; verify it before the downstream decoder.
  if (data.length < 6) fail("Invalid compressed image data.");
  let a = 1,
    b = 0;
  for (let start = 0; start < decoded.length; start += 5552) {
    const end = Math.min(start + 5552, decoded.length);
    for (let i = start; i < end; i++) {
      a += decoded[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  const checksum = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getUint32(data.length - 4);
  if (((b << 16) | a) >>> 0 !== checksum)
    fail("Compressed image checksum mismatch.");
}

/** Validate LZW codes and decoded length without constructing the unbounded string table. */
function checkLzw(data: Uint8Array, expected: number) {
  const lengths = new Uint16Array(4096);
  lengths.fill(1, 0, 256);
  let bits = 9,
    position = 0,
    next = 258,
    previous = -1,
    produced = 0,
    cleared = false;
  while (position + bits <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < bits; i++, position++)
      code = (code << 1) | ((data[position >> 3] >> (7 - (position & 7))) & 1);
    if (code === 256) {
      bits = 9;
      next = 258;
      previous = -1;
      cleared = true;
      continue;
    }
    if (!cleared) fail("Invalid TIFF LZW stream (missing clear code).");
    if (code === 257) {
      if (produced !== expected)
        fail("TIFF LZW length does not match its dimensions.");
      return;
    }
    const length =
      code < next
        ? lengths[code]
        : code === next && previous >= 0
          ? lengths[previous] + 1
          : 0;
    if (!length || (previous < 0 && code > 255)) fail("Invalid TIFF LZW code.");
    produced += length;
    if (produced > expected)
      fail("TIFF LZW output exceeds its declared dimensions.");
    if (previous >= 0) {
      if (next >= 4096) fail("TIFF LZW table requires a clear code.");
      lengths[next++] = lengths[previous] + 1;
      if (next === (1 << bits) - 1 && bits < 12) bits++;
    }
    previous = code;
  }
  fail("Truncated TIFF LZW stream.");
}

function preflightTiff(bytes: Uint8Array): Header {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  inBounds(0, 8, bytes.length);
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77))
    fail("Invalid TIFF byte order.");
  if (view.getUint16(2, little) !== 42)
    fail("Only classic TIFF is supported; BigTIFF is not supported.");
  const ifd = view.getUint32(4, little);
  if (ifd < 8) fail("Invalid TIFF directory.");
  inBounds(ifd, 2, bytes.length);
  const count = view.getUint16(ifd, little);
  if (count > 1024) fail("TIFF metadata exceeds the supported limit.");
  inBounds(ifd, 2 + 12 * count + 4, bytes.length);
  if (view.getUint32(ifd + 2 + 12 * count, little) !== 0)
    fail("Multi-page TIFF is not supported.");
  const tags = new Map<number, number[]>();
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  let metadataSize = 0;
  const retainedEntries: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = ifd + 2 + i * 12;
    const tag = view.getUint16(offset, little),
      type = view.getUint16(offset + 2, little),
      n = view.getUint32(offset + 4, little);
    if (tags.has(tag)) fail("Duplicate TIFF tag.");
    if (type < 1 || type > 12 || n < 1) fail("Unsupported TIFF metadata type.");
    const size = sizes[type] * n;
    metadataSize += size;
    if (metadataSize > MAX_METADATA_BYTES)
      fail("TIFF metadata exceeds the supported limit.");
    const at = size <= 4 ? offset + 8 : view.getUint32(offset + 8, little);
    inBounds(at, size, bytes.length);
    // Image subdirectories are unsupported. EXIF/GPS are metadata only and are
    // removed from a private decoder copy, never dereferenced or removed from originals.
    if (tag === 330) fail("TIFF image subdirectories are not supported.");
    if (tag === 34665 || tag === 34853) {
      if (type !== 4 || n !== 1)
        fail("Invalid TIFF metadata directory pointer.");
    } else retainedEntries.push(offset);
    if (size > 4 && at < ifd + 2 + 12 * count + 4 && at + size > ifd)
      fail("TIFF metadata overlaps its main directory.");
    if ([322, 323, 324, 325].includes(tag))
      fail("Tiled TIFF is not supported.");
    const values: number[] = [];
    if ([1, 3, 4].includes(type)) {
      if (n > 65536) fail("TIFF metadata array exceeds the supported limit.");
      for (let j = 0; j < n; j++)
        values.push(
          type === 1
            ? bytes[at + j]
            : type === 3
              ? view.getUint16(at + 2 * j, little)
              : view.getUint32(at + 4 * j, little),
        );
    }
    tags.set(tag, values);
  }
  const scalar = (tag: number, fallback?: number) => {
    const value = tags.get(tag);
    if (!value) {
      if (fallback !== undefined) return fallback;
      return fail("Missing required TIFF tag.");
    }
    if (value.length !== 1) fail("Invalid TIFF scalar tag.");
    return value[0];
  };
  const width = scalar(256),
    height = scalar(257),
    channels = scalar(277, 1);
  checkDimensions(width, height);
  const depths = tags.get(258);
  const bitDepth = depths?.[0];
  if (
    (bitDepth !== 8 && bitDepth !== 16) ||
    depths?.length !== channels ||
    depths.some((d) => d !== bitDepth)
  )
    fail("Only uniform 8/16-bit unsigned TIFF samples are supported.");
  const formats = tags.get(339);
  if (
    formats &&
    ((formats.length !== 1 && formats.length !== channels) ||
      formats.some((f) => f !== 1))
  )
    fail("Only unsigned integer TIFF samples are supported.");
  const photometric = scalar(262);
  if (![0, 1, 2].includes(photometric))
    fail("Only grayscale and RGB TIFF images are supported.");
  const colorChannels = photometric === 2 ? 3 : 1;
  if (channels !== colorChannels && channels !== colorChannels + 1)
    fail("Unsupported TIFF channel layout.");
  if (scalar(274, 1) !== 1)
    fail("TIFF orientation must be top-left; rotation is not supported.");
  if (scalar(284, 1) !== 1 || scalar(266, 1) !== 1)
    fail("Only chunky TIFF samples with standard fill order are supported.");
  if (![1, 2].includes(scalar(317, 1))) fail("Unsupported TIFF predictor.");
  if (photometric === 0 && channels === 2)
    fail("WhiteIsZero TIFF with alpha is not supported.");
  if (tags.has(281) && scalar(281) !== 2 ** bitDepth - 1)
    fail("Custom TIFF sample ranges are not supported.");
  const extra = tags.get(338);
  if (
    channels > colorChannels &&
    (!extra || extra.length !== 1 || ![1, 2].includes(extra[0]))
  )
    fail("TIFF alpha channel must be explicitly identified.");
  if (channels === colorChannels && extra)
    fail("Unexpected TIFF extra samples.");
  const compression = scalar(259, 1);
  if (![1, 5, 8, 32946].includes(compression))
    fail("Unsupported TIFF compression; use uncompressed, LZW, or Deflate.");
  const rows = scalar(278, 0xffffffff);
  const offsets = tags.get(273),
    counts = tags.get(279);
  if (
    rows < 1 ||
    !offsets ||
    !counts ||
    offsets.length !== Math.ceil(height / rows) ||
    counts.length !== offsets.length
  )
    fail("Invalid TIFF strip layout.");
  for (let i = 0; i < offsets.length; i++) {
    inBounds(offsets[i], counts[i], bytes.length);
    if (
      offsets[i] < 8 ||
      (offsets[i] < ifd + 2 + 12 * count + 4 && offsets[i] + counts[i] > ifd)
    )
      fail("TIFF pixel data overlaps its header or directory.");
    const expected =
      Math.min(rows, height - i * rows) * width * channels * (bitDepth / 8);
    const data = bytes.subarray(offsets[i], offsets[i] + counts[i]);
    if (compression === 1 && counts[i] !== expected)
      fail("TIFF strip size does not match its dimensions.");
    if (compression === 5) checkLzw(data, expected);
    if (compression === 8 || compression === 32946) checkZlib(data, expected);
  }
  const warnings: string[] = [];
  if (photometric === 0) warnings.push("WHITE_IS_ZERO_INVERTED");
  if (tags.has(34675)) warnings.push("ENCODED_INTENSITY_NO_COLOR_CORRECTION");
  let safeBytes: Uint8Array | undefined;
  if (retainedEntries.length !== count) {
    warnings.push("METADATA_SUBDIRECTORIES_IGNORED");
    safeBytes = new Uint8Array(bytes);
    const safeView = new DataView(safeBytes.buffer);
    safeView.setUint16(ifd, retainedEntries.length, little);
    retainedEntries.forEach((offset, i) =>
      safeBytes!.set(bytes.subarray(offset, offset + 12), ifd + 2 + i * 12),
    );
    safeView.setUint32(ifd + 2 + retainedEntries.length * 12, 0, little);
  }
  return { width, height, channels, bitDepth, warnings, safeBytes };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function preflightPng(bytes: Uint8Array): Header & { safeBytes: Uint8Array } {
  inBounds(0, 33, bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    header: Header | undefined,
    end = false,
    imageData = false,
    dataEnded = false;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)],
    idat: Uint8Array[] = [];
  let metadataSize = 0;
  while (offset < bytes.length) {
    inBounds(offset, 12, bytes.length);
    const length = view.getUint32(offset);
    inBounds(offset, length + 12, bytes.length);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      view.getUint32(offset + 8 + length)
    )
      fail("PNG checksum mismatch.");
    if (!header && name !== "IHDR") fail("PNG header must be first.");
    if (name === "IHDR") {
      if (header || length !== 13) fail("Invalid PNG header.");
      const width = view.getUint32(offset + 8),
        height = view.getUint32(offset + 12);
      checkDimensions(width, height);
      const bitDepth = bytes[offset + 16],
        color = bytes[offset + 17];
      if (bitDepth !== 8 && bitDepth !== 16)
        fail("Only 8/16-bit PNG images are supported.");
      const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[
        color
      ];
      if (!channels) fail("Indexed/palette PNG images are not supported.");
      if (
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        fail("Unsupported PNG compression, filtering, or interlacing.");
      header = { width, height, bitDepth, channels, warnings: [] };
    } else if (name === "IDAT") {
      if (dataEnded) fail("PNG data chunks must be contiguous.");
      imageData = true;
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else {
      if (imageData) dataEnded = true;
      if (["acTL", "fcTL", "fdAT"].includes(name))
        fail("Animated PNG is not supported.");
      if (name === "tRNS") fail("PNG transparency keys are not supported.");
      if (name === "eXIf")
        fail("PNG EXIF/orientation metadata is not supported.");
      if (name === "IEND") {
        if (length !== 0 || !imageData) fail("Invalid PNG end chunk.");
        end = true;
      } else {
        if (name[0] === name[0].toUpperCase() && name !== "PLTE")
          fail("Unsupported critical PNG chunk.");
        metadataSize += length;
        if (metadataSize > MAX_METADATA_BYTES)
          fail("PNG metadata exceeds the supported limit.");
        if (
          ["iCCP", "gAMA", "sRGB", "cHRM"].includes(name) &&
          !header!.warnings.includes("ENCODED_INTENSITY_NO_COLOR_CORRECTION")
        )
          header!.warnings.push("ENCODED_INTENSITY_NO_COLOR_CORRECTION");
      }
    }
    // Do not pass compressed profiles, text or other ancillary chunks to the decoder.
    if (["IHDR", "IDAT", "IEND"].includes(name))
      parts.push(bytes.subarray(offset, offset + 12 + length));
    offset += 12 + length;
    if (end) break;
  }
  if (!header || !end || offset !== bytes.length)
    fail("Incomplete PNG or trailing data.");
  const compressed = new Uint8Array(
    idat.reduce((sum, part) => sum + part.length, 0),
  );
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  checkZlib(
    compressed,
    header.height *
      (1 + header.width * header.channels * (header.bitDepth / 8)),
  );
  const safeBytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  at = 0;
  for (const part of parts) {
    safeBytes.set(part, at);
    at += part.length;
  }
  return { ...header, safeBytes };
}

/** Allocation-free dimensions for aggregate project budgeting. Full decode still validates the container. */
export function inspectRasterDimensions(
  bytes: Uint8Array,
  name: string,
): { width: number; height: number } {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 8 ||
    bytes.length > MAX_FILE_BYTES
  )
    fail("Image file must be 8 bytes to 64 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (PNG_SIGNATURE.every((value, i) => bytes[i] === value)) {
    inBounds(8, 25, bytes.length);
    if (
      !/\.png$/i.test(name) ||
      view.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
    )
      fail("Invalid PNG header or extension.");
    const width = view.getUint32(16),
      height = view.getUint32(20);
    checkDimensions(width, height);
    return { width, height };
  }
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (
    (!little && !(bytes[0] === 77 && bytes[1] === 77)) ||
    view.getUint16(2, little) !== 42 ||
    !/\.tiff?$/i.test(name)
  )
    fail("Invalid TIFF header or extension.");
  const ifd = view.getUint32(4, little);
  if (ifd < 8) fail("Invalid TIFF directory.");
  inBounds(ifd, 2, bytes.length);
  const count = view.getUint16(ifd, little);
  if (count > 1024) fail("TIFF metadata exceeds the supported limit.");
  inBounds(ifd, 2 + count * 12 + 4, bytes.length);
  let width = 0,
    height = 0;
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12,
      tag = view.getUint16(at, little);
    if (tag !== 256 && tag !== 257) continue;
    const type = view.getUint16(at + 2, little);
    if (view.getUint32(at + 4, little) !== 1 || (type !== 3 && type !== 4))
      fail("Invalid TIFF dimension tag.");
    const value =
      type === 3
        ? view.getUint16(at + 8, little)
        : view.getUint32(at + 8, little);
    if (tag === 256) {
      if (width) fail("Duplicate TIFF dimension tag.");
      width = value;
    } else {
      if (height) fail("Duplicate TIFF dimension tag.");
      height = value;
    }
  }
  checkDimensions(width, height);
  return { width, height };
}

/** Decode integer samples without display transforms. RGB becomes (R+G+B)/3, at original depth. */
export function decodeRaster(bytes: Uint8Array, name: string): Raster {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length > MAX_FILE_BYTES ||
    bytes.length < 8
  )
    fail("Image file must be 8 bytes to 64 MiB.");
  const isPng = PNG_SIGNATURE.every((v, i) => bytes[i] === v);
  const isTiff =
    (bytes[0] === 73 && bytes[1] === 73) ||
    (bytes[0] === 77 && bytes[1] === 77);
  if (!isPng && !isTiff)
    fail("Only TIFF and PNG image contents are supported.");
  if ((isPng && !/\.png$/i.test(name)) || (isTiff && !/\.tiff?$/i.test(name)))
    fail("Image extension does not match TIFF/PNG contents.");
  const header = isPng ? preflightPng(bytes) : preflightTiff(bytes);
  const data = isPng
    ? decodePng((header as Header & { safeBytes: Uint8Array }).safeBytes, {
        checkCrc: true,
      }).data
    : decodeTiff(header.safeBytes ?? bytes, { pages: [0] })[0].data;
  const { width, height, bitDepth, channels } = header;
  if (data.length !== width * height * channels)
    fail("Decoded samples do not match the image dimensions.");
  const max = 2 ** bitDepth - 1;
  const alpha = channels === 2 || channels === 4;
  if (alpha) {
    for (let i = channels - 1; i < data.length; i += channels)
      if (data[i] !== max)
        fail("Transparent or partially transparent pixels are not supported.");
    header.warnings.push("OPAQUE_ALPHA_IGNORED");
  }
  const colorChannels = alpha ? channels - 1 : channels;
  if (colorChannels === 3) header.warnings.push("RGB_MEAN_INTENSITY");
  const pixels = new Float64Array(width * height);
  for (let p = 0, i = 0; p < pixels.length; p++, i += channels)
    pixels[p] =
      colorChannels === 3 ? (data[i] + data[i + 1] + data[i + 2]) / 3 : data[i];
  return {
    width,
    height,
    bitDepth,
    channels,
    pixels,
    max,
    format: isPng ? "PNG" : "TIFF",
    warnings: header.warnings,
  };
}

function validateRaster(raster: Raster) {
  checkDimensions(raster.width, raster.height);
  if (
    raster.pixels.length !== raster.width * raster.height ||
    ![8, 16].includes(raster.bitDepth) ||
    raster.max !== 2 ** raster.bitDepth - 1
  )
    fail("Invalid raster data.");
}
function validateRect(rect: Rect, raster: Raster) {
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
function overlaps(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Intensities remain signed after background subtraction; clipping is an encoded-value warning. */
export function measureRegion(
  raster: Raster,
  region: LaneRegion,
  signal: Signal,
): LaneMeasurement {
  validateRaster(raster);
  if (signal !== "dark" && signal !== "light") fail("Unknown signal polarity.");
  if (!Number.isSafeInteger(region.lane) || region.lane < 1)
    fail("Lane numbers must be positive integers.");
  validateRect(region.band, raster);
  validateRect(region.background, raster);
  if (overlaps(region.band, region.background))
    fail("Band and background ROIs must not overlap.");
  const clippedValue = signal === "dark" ? 0 : raster.max;
  const sample = (rect: Rect) => {
    let sum = 0,
      clipped = 0;
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const value = raster.pixels[y * raster.width + x];
        if (!Number.isFinite(value) || value < 0 || value > raster.max)
          fail("Raster contains invalid intensity values.");
        sum += value;
        if (value === clippedValue) clipped++;
      }
    return { sum, clipped };
  };
  const band = sample(region.band),
    background = sample(region.background);
  const area = region.band.width * region.band.height;
  const backgroundMean =
    background.sum / (region.background.width * region.background.height);
  const net =
    signal === "dark"
      ? area * backgroundMean - band.sum
      : band.sum - area * backgroundMean;
  const warnings: string[] = [...new Set(region.warnings ?? [])];
  if (band.clipped) warnings.push("CLIPPED_PIXELS");
  if (background.clipped) warnings.push("BACKGROUND_CLIPPED");
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
    bandSum: band.sum,
    backgroundMean,
    net,
    clippedFraction: band.clipped / area,
    warnings,
  };
}

function smooth(values: Float64Array, radius: number): Float64Array {
  const result = new Float64Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length + radius; i++) {
    if (i < values.length) sum += values[i];
    if (i > 2 * radius) sum -= values[i - 2 * radius - 1];
    if (i >= radius) {
      const at = i - radius;
      result[at] =
        sum /
        (Math.min(values.length - 1, at + radius) -
          Math.max(0, at - radius) +
          1);
    }
  }
  return result;
}
function segments(
  values: Float64Array,
  threshold: number,
): { start: number; end: number; peak: number; strength: number }[] {
  const output: {
    start: number;
    end: number;
    peak: number;
    strength: number;
  }[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] <= threshold) continue;
    const start = i;
    let peak = i,
      strength = values[i];
    while (i + 1 < values.length && values[i + 1] > threshold) {
      i++;
      if (values[i] > strength) {
        peak = i;
        strength = values[i];
      }
    }
    output.push({ start, end: i + 1, peak, strength });
  }
  return output;
}

/** Otsu threshold of a normalized [0,1] profile, clamped to a sane lane/gutter range. */
function otsuThreshold(profile: Float64Array): number {
  const bins = 64;
  const histogram = new Float64Array(bins);
  for (const value of profile)
    histogram[Math.max(0, Math.min(bins - 1, Math.floor(value * bins)))]++;
  const total = profile.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * histogram[i];
  let sumBackground = 0,
    weightBackground = 0,
    best = 0,
    bestVariance = -1;
  for (let i = 0; i < bins; i++) {
    weightBackground += histogram[i];
    if (!weightBackground) continue;
    const weightForeground = total - weightBackground;
    if (!weightForeground) break;
    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = i;
    }
  }
  return Math.min(0.6, Math.max(0.08, (best + 1) / bins));
}

/**
 * Projection-based lane/band candidates. Lanes come from an Otsu-segmented
 * column profile (leftmost N runs; extra right-hand lanes such as markers are
 * reported, never silently shifted), falling back to peak relaxation with an
 * explicit separation warning. Each lane's band is then located by its OWN row
 * projection, so uneven runs (smiling) do not shift every lane to one global
 * row. Multiple comparable peaks inside a lane stay ambiguous for the
 * one-band-per-lane model and require manual ROIs.
 */
export function proposeRegions(
  raster: Raster,
  laneCount: number,
  signal: Signal,
): LaneRegion[] {
  validateRaster(raster);
  if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > 96)
    fail("Lane count must be an integer from 1 to 96.");
  if (signal !== "dark" && signal !== "light") fail("Unknown signal polarity.");
  if (raster.width < 8 || raster.height < 8)
    fail("Image is too small to propose band and background ROIs.");
  const { width, height, pixels, max } = raster;
  // A histogram estimates the broad background without sorting or copying every pixel.
  const histogram = new Uint32Array(256);
  for (const value of pixels) {
    if (!Number.isFinite(value) || value < 0 || value > max)
      fail("Raster contains invalid intensity values.");
    histogram[Math.min(255, Math.floor((value / max) * 255))]++;
  }
  const quantile = signal === "dark" ? 0.8 : 0.2;
  let seen = 0,
    baseline = 0;
  for (let i = 0; i < 256; i++) {
    seen += histogram[i];
    if (seen >= pixels.length * quantile) {
      baseline = (i / 255) * max;
      break;
    }
  }
  const contrast = (x: number, y: number) =>
    Math.max(
      0,
      signal === "dark"
        ? baseline - pixels[y * width + x]
        : pixels[y * width + x] - baseline,
    );

  // ── Lane x-segmentation on the column profile ─────────────────────────
  const columns = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) sum += contrast(x, y);
    columns[x] = sum / height;
  }
  const columnProfile = smooth(columns, Math.max(1, Math.round(width / 150)));
  let peak = 0;
  for (const value of columnProfile) peak = Math.max(peak, value);
  if (peak < max * 0.01)
    fail("No band row has sufficient contrast; select ROIs manually.");

  const warnings: string[] = [];
  const closeWidth = Math.max(3, Math.floor(width / 60));
  const minWidth = Math.max(2, Math.floor(width / 80));
  const normalized = columnProfile.map((value) => value / peak);
  const otsu = otsuThreshold(normalized);
  const binary = new Uint8Array(width);
  for (let x = 0; x < width; x++) binary[x] = normalized[x] >= otsu ? 1 : 0;
  // Close narrow within-lane dips before extracting runs.
  {
    const closed = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      if (binary[x]) {
        closed[x] = 1;
        continue;
      }
      const left = Math.max(0, x - closeWidth);
      const right = Math.min(width - 1, x + closeWidth);
      for (let i = left; i <= right && !closed[x]; i++)
        if (binary[i] && binary[left] && binary[right]) closed[x] = 1;
    }
    binary.set(closed);
  }
  const runs: { start: number; end: number }[] = [];
  for (let x = 0; x < width; x++) {
    if (!binary[x]) continue;
    const start = x;
    while (x + 1 < width && binary[x + 1]) x++;
    if (x - start + 1 >= minWidth) runs.push({ start, end: x + 1 });
  }

  let laneBounds: { start: number; end: number }[];
  if (runs.length >= laneCount) {
    // Leftmost N runs; trailing marker lanes are reported, never shifted in.
    laneBounds = runs.slice(0, laneCount);
    if (runs.length > laneCount) warnings.push("EXTRA_LANES_IGNORED");
    // A shallow gutter between resolved lanes means weak separation.
    for (let index = 1; index < laneBounds.length; index++) {
      let valley = 0;
      for (let x = laneBounds[index - 1].end; x < laneBounds[index].start; x++)
        valley = Math.max(valley, columnProfile[x]);
      if (valley > peak * 0.35) {
        warnings.push("LOW_LANE_SEPARATION");
        break;
      }
    }
  } else {
    // Fallback: relax the peak threshold until the requested count resolves.
    let threshold = 0.22;
    let found = segments(columnProfile, peak * threshold).filter(
      (part) => part.end - part.start >= 2,
    );
    for (const candidate of [0.32, 0.42, 0.52, 0.62, 0.72, 0.82]) {
      if (found.length >= laneCount) break;
      threshold = candidate;
      found = segments(columnProfile, peak * threshold).filter(
        (part) => part.end - part.start >= 2,
      );
    }
    if (found.length < laneCount)
      fail(
        "Fewer resolved lanes than requested; overlapping or weak bands need manual ROIs.",
      );
    laneBounds = found
      .slice(0, laneCount)
      .map((part) => ({ start: part.start, end: part.end }));
    warnings.push("LOW_LANE_SEPARATION");
  }

  // ── Per-lane band y-localisation ─────────────────────────────────────
  const regions: LaneRegion[] = [];
  for (let index = 0; index < laneBounds.length; index++) {
    const bound = laneBounds[index];
    const laneWidth = bound.end - bound.start;
    const rows = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = bound.start; x < bound.end; x++) sum += contrast(x, y);
      rows[y] = sum / laneWidth;
    }
    const rowProfile = smooth(rows, Math.max(1, Math.round(height / 300)));
    let lanePeak = 0,
      lanePeakY = 0;
    for (let y = 0; y < height; y++)
      if (rowProfile[y] > lanePeak) {
        lanePeak = rowProfile[y];
        lanePeakY = y;
      }
    if (lanePeak < peak * 0.1)
      fail(
        "A requested lane has no resolvable band; overlapping or empty lanes need manual ROIs.",
      );
    const rowSegments = segments(rowProfile, lanePeak * 0.35).filter(
      (part) => part.end - part.start >= 2,
    );
    const selectedRow =
      rowSegments.find(
        (part) => part.start <= lanePeakY && part.end > lanePeakY,
      ) ?? rowSegments.at(-1);
    if (!selectedRow)
      fail(
        "A requested lane has no resolvable band; overlapping or empty lanes need manual ROIs.",
      );
    if (
      rowSegments.some(
        (part) =>
          part !== selectedRow && part.strength >= selectedRow.strength * 0.8,
      )
    )
      fail(
        "Multiple comparable band rows are ambiguous; select ROIs manually.",
      );
    const bandTop = Math.max(0, selectedRow.start - 1),
      bandBottom = Math.min(height, selectedRow.end + 1);

    // Refine x-boundaries by walking at the lower edge threshold, clamped to
    // the midpoint between neighboring runs so faint lane edges (weaker than
    // the Otsu threshold but far above background) are kept, never clipped.
    const lower = index
      ? Math.floor((laneBounds[index - 1].end + bound.start) / 2)
      : 0;
    const upper =
      index + 1 < laneBounds.length
        ? Math.floor((bound.end + laneBounds[index + 1].start) / 2)
        : width;
    let start = bound.start,
      finish = bound.end;
    while (start > lower && columnProfile[start - 1] > peak * 0.22) start--;
    while (finish < upper && columnProfile[finish] > peak * 0.22) finish++;
    const left = Math.max(lower, start - 1);
    const right = Math.min(upper, finish + 1);
    const band: Rect = {
      x: left,
      y: bandTop,
      width: right - left,
      height: bandBottom - bandTop,
    };

    const gap = 2;
    const bgHeight = Math.max(2, Math.min(12, band.height));
    const choices: Rect[] = [];
    if (bandTop - gap - bgHeight >= 0)
      choices.push({
        x: left,
        y: bandTop - gap - bgHeight,
        width: band.width,
        height: bgHeight,
      });
    if (bandBottom + gap + bgHeight <= height)
      choices.push({
        x: left,
        y: bandBottom + gap,
        width: band.width,
        height: bgHeight,
      });
    if (!choices.length)
      fail(
        "Insufficient adjacent background space; select band/background ROIs manually.",
      );
    const score = (rect: Rect) => {
      let sum = 0;
      for (let yy = rect.y; yy < rect.y + rect.height; yy++)
        for (let xx = rect.x; xx < rect.x + rect.width; xx++)
          sum += contrast(xx, yy);
      return sum / (rect.width * rect.height);
    };
    choices.sort((a, b) => score(a) - score(b));
    regions.push({
      lane: index + 1,
      band,
      background: choices[0],
      source: "automatic",
      warnings: [...warnings],
    });
  }
  return regions;
}

/** Display-only 8-bit linear preview; quantification always reads the original-depth Raster. */
export function rasterPreview(raster: Raster): Uint8Array {
  validateRaster(raster);
  const data = new Uint8Array(raster.pixels.length);
  for (let i = 0; i < data.length; i++) {
    const value = raster.pixels[i];
    if (!Number.isFinite(value) || value < 0 || value > raster.max)
      fail("Raster contains invalid intensity values.");
    data[i] = Math.round((value / raster.max) * 255);
  }
  return encodePng({
    width: raster.width,
    height: raster.height,
    depth: 8,
    channels: 1,
    data,
  });
}
