import { zlibSync } from "fflate";

/** Independent synthetic classic-TIFF encoder; fixtures contain no experimental data. */
export function quickTiff(
  options: {
    width?: number;
    height?: number;
    depth?: 8 | 16;
    channels?: 1 | 3;
    pixels?: ArrayLike<number>;
    little?: boolean;
    deflate?: boolean;
    next?: number;
  } = {},
): Uint8Array {
  const width = options.width ?? 3,
    height = options.height ?? 2,
    depth = options.depth ?? 16,
    channels = options.channels ?? 1,
    little = options.little ?? true;
  const raw = new Uint8Array((width * height * channels * depth) / 8);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < width * height * channels; i++) {
    const value = options.pixels?.[i] ?? (i * 37 + 1001) % 2 ** depth;
    if (depth === 16) view.setUint16(i * 2, value, little);
    else view.setUint8(i, value);
  }
  const payload = options.deflate ? zlibSync(raw) : raw;
  const fields: [number, number, number[]][] = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, Array(channels).fill(depth)],
    [259, 3, [options.deflate ? 8 : 1]],
    [262, 3, [channels === 3 ? 2 : 1]],
    [273, 4, [0]],
    [274, 3, [1]],
    [277, 3, [channels]],
    [278, 4, [height]],
    [279, 4, [payload.length]],
    [284, 3, [1]],
    [339, 3, [1]],
  ];
  const extraStart = 8 + 2 + fields.length * 12 + 4;
  const pixelOffset = extraStart + (channels === 3 ? 6 : 0);
  fields.find(([tag]) => tag === 273)![2][0] = pixelOffset;
  const bytes = new Uint8Array(pixelOffset + payload.length),
    out = new DataView(bytes.buffer);
  bytes[0] = bytes[1] = little ? 73 : 77;
  out.setUint16(2, 42, little);
  out.setUint32(4, 8, little);
  out.setUint16(8, fields.length, little);
  fields.forEach(([tag, type, values], i) => {
    const entry = 10 + i * 12;
    out.setUint16(entry, tag, little);
    out.setUint16(entry + 2, type, little);
    out.setUint32(entry + 4, values.length, little);
    let offset = entry + 8;
    if (values.length > 2) {
      out.setUint32(offset, extraStart, little);
      offset = extraStart;
    }
    values.forEach((value, n) => {
      if (type === 3) out.setUint16(offset + n * 2, value, little);
      else out.setUint32(offset + n * 4, value, little);
    });
  });
  out.setUint32(10 + fields.length * 12, options.next ?? 0, little);
  bytes.set(payload, pixelOffset);
  return bytes;
}

export function quickBandsTiff(depth: 8 | 16 = 16, invert = false): Uint8Array {
  const width = 360,
    height = 112,
    max = 2 ** depth - 1;
  const background = depth === 16 ? 60003 : 240;
  const pixels = new Uint16Array(width * height).fill(background);
  for (let lane = 0; lane < 6; lane++) {
    const difference = depth === 16 ? 10001 + lane * 5000 : 40 + lane * 20;
    for (let y = 48; y < 64; y++)
      for (let x = 18 + lane * 60; x < 42 + lane * 60; x++)
        pixels[y * width + x] = background - difference;
  }
  if (invert)
    for (let i = 0; i < pixels.length; i++) pixels[i] = max - pixels[i];
  return quickTiff({ width, height, depth, pixels, deflate: true });
}
