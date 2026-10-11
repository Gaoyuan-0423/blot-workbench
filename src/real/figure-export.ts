/** Uncompressed RGB TIFF for rendered figures, never used as measurement input. */
export function encodeFigureTiff(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  dpi = 300,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 24_000_000 ||
    rgba.length !== width * height * 4 ||
    !Number.isInteger(dpi) ||
    dpi < 1 ||
    dpi > 2400
  )
    throw new Error("Invalid figure dimensions / 图像尺寸无效");
  const count = 12,
    bitsOffset = 8 + 2 + count * 12 + 4;
  const xRes = bitsOffset + 6,
    yRes = xRes + 8,
    dataOffset = yRes + 8;
  const bytes = new Uint8Array(dataOffset + width * height * 3);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) =>
    view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) =>
    view.setUint32(offset, value, true);
  bytes.set([73, 73]);
  u16(2, 42);
  u32(4, 8);
  u16(8, count);
  const entries = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 3, bitsOffset],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, dataOffset],
    [277, 3, 1, 3],
    [278, 4, 1, height],
    [279, 4, 1, width * height * 3],
    [282, 5, 1, xRes],
    [283, 5, 1, yRes],
    [296, 3, 1, 2],
  ];
  entries.forEach(([tag, type, n, value], i) => {
    const at = 10 + i * 12;
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, n);
    u32(at + 8, value);
  });
  for (let i = 0; i < 3; i++) u16(bitsOffset + i * 2, 8);
  u32(xRes, dpi);
  u32(xRes + 4, 1);
  u32(yRes, dpi);
  u32(yRes + 4, 1);
  for (let p = 0; p < width * height; p++) {
    const alpha = rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++)
      bytes[dataOffset + p * 3 + c] = Math.round(
        rgba[p * 4 + c] * alpha + 255 * (1 - alpha),
      );
  }
  return bytes;
}

export async function renderFigure(
  svg: string,
  format: "png" | "tiff",
  scale = 3,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("Unable to render figure / 图形渲染失败"));
      img.src = url;
    });
    const width = Math.round(img.naturalWidth * scale),
      height = Math.round(img.naturalHeight * scale);
    if (!width || !height || width * height > 24_000_000)
      throw new Error("Figure too large / 图形过大");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable / 无法导出图像");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    if (format === "tiff")
      return new Blob(
        [
          encodeFigureTiff(
            width,
            height,
            ctx.getImageData(0, 0, width, height).data,
          ).slice().buffer,
        ],
        { type: "image/tiff" },
      );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("PNG export failed / PNG 导出失败")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
