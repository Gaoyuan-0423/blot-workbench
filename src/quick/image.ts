import { zlibSync } from "fflate";

export interface QuickImage {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  gray: Uint8Array;
}

export const QUICK_IMAGE_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxSide: 16_000,
} as const;

interface ImageHeader {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function checkDimensions(width: number, height: number): void {
  if (width < 1 || height < 1)
    throw new Error("图片尺寸无效，请重新导出图片。");
  if (
    width > QUICK_IMAGE_LIMITS.maxSide ||
    height > QUICK_IMAGE_LIMITS.maxSide ||
    width * height > QUICK_IMAGE_LIMITS.maxPixels
  )
    throw new Error(
      "图片过大：最多 2000 万像素、单边 16000 像素，请先裁出需要分析的条带。",
    );
}

function invalidExif(): never {
  throw new Error("JPEG EXIF 方向信息无效，请按需要的方向另存为 PNG 后导入。");
}

/** EXIF offsets are confined to this APP1 segment, not the full file. */
function checkExif(bytes: Uint8Array, start: number, end: number): void {
  const length = end - start;
  if (length < 8) invalidExif();
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, length);
  const little = view.getUint8(0) === 0x49 && view.getUint8(1) === 0x49;
  const big = view.getUint8(0) === 0x4d && view.getUint8(1) === 0x4d;
  if ((!little && !big) || view.getUint16(2, little) !== 42) invalidExif();
  const offset = view.getUint32(4, little);
  if (offset === 0) return;
  if (offset < 8 || offset > length - 2) invalidExif();
  const count = view.getUint16(offset, little);
  if (offset + 2 + count * 12 + 4 > length) invalidExif();
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    if (
      view.getUint16(entry + 2, little) !== 3 ||
      view.getUint32(entry + 4, little) !== 1
    )
      invalidExif();
    const orientation = view.getUint16(entry + 8, little);
    if (orientation >= 2 && orientation <= 8)
      throw new Error(
        "JPEG 含旋转或翻转方向信息，请按需要的方向另存为 PNG 后导入。",
      );
    if (orientation !== 1) invalidExif();
  }
}

function inspectPng(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 33) throw new Error("PNG 文件头不完整。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
  )
    throw new Error("PNG 文件头无效。");
  const width = view.getUint32(16),
    height = view.getUint32(20);
  checkDimensions(width, height);
  if (bytes[24] !== 8)
    throw new Error(
      `此简易模式仅支持 8-bit PNG；当前为 ${bytes[24]}-bit。请使用 8-bit 副本，保留高位深原图。`,
    );
  if (
    ![0, 2, 3, 4, 6].includes(bytes[25]) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] > 1
  )
    throw new Error("PNG 编码格式无效或不受支持。");
  let offset = 33;
  let hasPixels = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12)
      throw new Error("PNG 文件不完整。");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") throw new Error("请导入静态 PNG，暂不支持动画 PNG。");
    if (type === "IDAT") hasPixels = true;
    if (type === "IEND") {
      if (length !== 0 || !hasPixels)
        throw new Error("PNG 缺少有效的像素数据。");
      return { mime: "image/png", width, height };
    }
    offset += length + 12;
  }
  throw new Error("PNG 文件不完整。");
}

function inspectJpeg(bytes: Uint8Array): ImageHeader {
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("JPEG 段结构无效。");
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) throw new Error("JPEG 文件不完整。");
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("JPEG 文件不完整。");
    const length = bytes[offset] * 256 + bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) throw new Error("JPEG 段长度无效。");
    if (marker === 0xda) {
      if (!dimensions) break;
      return { mime: "image/jpeg", ...dimensions };
    }
    const payload = offset + 2;
    if (
      marker === 0xe1 &&
      end - payload >= 6 &&
      String.fromCharCode(...bytes.subarray(payload, payload + 6)) ===
        "Exif\0\0"
    )
      checkExif(bytes, payload + 6, end);
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (length < 8) throw new Error("JPEG 尺寸信息无效。");
      if (bytes[payload] !== 8)
        throw new Error(
          "此简易模式仅支持 8-bit JPEG，请使用 8-bit 副本并保留原图。",
        );
      if (![0xc0, 0xc1, 0xc2].includes(marker))
        throw new Error("此 JPEG 编码暂不支持，请另存为 8-bit PNG 后导入。");
      const height = bytes[payload + 1] * 256 + bytes[payload + 2];
      const width = bytes[payload + 3] * 256 + bytes[payload + 4];
      checkDimensions(width, height);
      const components = bytes[payload + 5];
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components)
        throw new Error("JPEG 颜色通道信息无效。");
      dimensions = { width, height };
    }
    offset = end;
  }
  throw new Error("JPEG 缺少完整的尺寸或像素信息。");
}

/** Inspect original bytes before browser decoding can reduce source bit depth. */
export function inspectQuickImage(bytes: Uint8Array): ImageHeader {
  if (bytes.length > QUICK_IMAGE_LIMITS.maxBytes)
    throw new Error("图片超过 15 MB，请先裁出需要分析的条带。");
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte))
    return inspectPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  if (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      [42, 43].includes(bytes[2]) &&
      bytes[3] === 0) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0 &&
      [42, 43].includes(bytes[3]))
  )
    throw new Error(
      "此简易模式暂不支持 TIFF，请导出 8-bit PNG 副本并保留原始 TIFF。",
    );
  throw new Error("请选择有效的 8-bit PNG 或 JPEG 图片。");
}

export async function loadQuickImage(file: File): Promise<QuickImage> {
  if (file.size > QUICK_IMAGE_LIMITS.maxBytes)
    throw new Error("图片超过 15 MB，请先裁出需要分析的条带。");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error("无法读取图片文件，请重新选择。");
  }
  const header = inspectQuickImage(bytes);
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes).buffer], { type: header.mime }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error("图片解码失败，文件可能已损坏，请重新导出 PNG 或 JPEG。"),
        );
      image.src = url;
    });
    if (
      image.naturalWidth !== header.width ||
      image.naturalHeight !== header.height
    )
      throw new Error(
        "浏览器解码尺寸与原图不符，请按需要的方向另存为 PNG 后导入。",
      );
    const canvas = document.createElement("canvas");
    canvas.width = header.width;
    canvas.height = header.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法读取图片像素。");
    // White backing keeps transparent pixels from becoming artificial dark bands.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < gray.length; i++) {
      const pixel = i * 4;
      gray[i] = Math.round(
        0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2],
      );
    }
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,"))
      throw new Error("浏览器无法生成图片预览，请缩小图片后重试。");
    return {
      name: file.name || "导入条带",
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      gray,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function concatenate(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    arrays.reduce((size, array) => size + array.length, 0),
  );
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const data = concatenate(new TextEncoder().encode(type), payload);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = new Uint8Array(payload.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, payload.length);
  result.set(data, 4);
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

function makeExample(reference: boolean): QuickImage {
  const width = 720,
    height = 168;
  const gray = new Uint8Array(width * height);
  const strengths = reference
    ? [108, 116, 110, 114, 119, 111]
    : [72, 84, 78, 143, 158, 149];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 243 + ((x * 17 + y * 13) % 5) - 2;
      for (let lane = 0; lane < 6; lane++) {
        const dx = (x - (90 + lane * 108)) / 30;
        const dy = (y - 84) / 9;
        value -= strengths[lane] * Math.exp(-0.5 * (dx ** 8 + dy ** 4));
      }
      gray[y * width + x] = Math.round(value);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  const scanlines = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    scanlines.set(
      gray.subarray(y * width, (y + 1) * width),
      y * (width + 1) + 1,
    );
  const png = concatenate(
    new Uint8Array(PNG_SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  );
  let binary = "";
  for (let offset = 0; offset < png.length; offset += 0x8000)
    binary += String.fromCharCode(...png.subarray(offset, offset + 0x8000));
  return {
    name: reference
      ? "合成示例内参（非实验数据）.png"
      : "合成示例目标条带（非实验数据）.png",
    dataUrl: `data:image/png;base64,${btoa(binary)}`,
    width,
    height,
    gray,
  };
}

export function createQuickExample(): QuickImage {
  return makeExample(false);
}

export function createQuickReferenceExample(): QuickImage {
  return makeExample(true);
}
