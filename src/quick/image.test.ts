import { afterEach, describe, expect, it, vi } from "vitest";
import { unzlibSync } from "fflate";
import { decode as decodePng } from "fast-png";
import { quickTiff } from "../../tests/fixtures/quick-tiff";
import {
  createQuickExample,
  createQuickReferenceExample,
  inspectQuickImage,
  loadQuickImage,
  QUICK_IMAGE_LIMITS,
  imageMaximum,
} from "./image";

const png = () =>
  Uint8Array.from(atob(createQuickExample().dataUrl.split(",")[1]), (byte) =>
    byte.charCodeAt(0),
  );

function jpeg(orientation?: number, little = true): Uint8Array {
  const exif = new Uint8Array(32);
  exif.set([69, 120, 105, 102, 0, 0]);
  const tiff = new DataView(exif.buffer, 6);
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, 8, little);
  tiff.setUint16(8, 1, little);
  tiff.setUint16(10, 0x0112, little);
  tiff.setUint16(12, 3, little);
  tiff.setUint32(14, 1, little);
  tiff.setUint16(18, orientation ?? 1, little);
  return new Uint8Array([
    0xff,
    0xd8,
    ...(orientation === undefined
      ? []
      : [0xff, 0xe1, 0, exif.length + 2, ...exif]),
    0xff,
    0xc0,
    0,
    11,
    8,
    0,
    20,
    0,
    40,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    0,
    0xff,
    0xd9,
  ]);
}

afterEach(() => vi.unstubAllGlobals());

describe("quick image source validation", () => {
  it("reads dimensions from an 8-bit PNG and accepts Uint8Array subviews", () => {
    const bytes = png();
    const padded = new Uint8Array(bytes.length + 9);
    padded.set(bytes, 9);
    expect(inspectQuickImage(padded.subarray(9))).toEqual({
      mime: "image/png",
      width: 720,
      height: 168,
    });
  });

  it("rejects high-bit-depth PNG before a browser can silently quantize it", async () => {
    const bytes = png();
    bytes[24] = 16;
    expect(() => inspectQuickImage(bytes)).toThrow("当前为 16-bit");
    const imageConstructor = vi.fn();
    vi.stubGlobal("Image", imageConstructor);
    await expect(
      loadQuickImage(new File([bytes], "original.png", { type: "image/png" })),
    ).rejects.toThrow("16-bit");
    expect(imageConstructor).not.toHaveBeenCalled();
  });

  it("rejects truncated TIFF, forged MIME/extensions and malformed chunk lengths", () => {
    expect(() => inspectQuickImage(new Uint8Array([73, 73, 42, 0]))).toThrow(
      "TIFF",
    );
    expect(() => inspectQuickImage(new Uint8Array([77, 77, 0, 43]))).toThrow(
      "TIFF",
    );
    expect(() =>
      inspectQuickImage(new TextEncoder().encode("not actually a png")),
    ).toThrow("有效");
    expect(() => inspectQuickImage(png().subarray(0, 28))).toThrow(
      "文件头不完整",
    );
    const invalid = png();
    new DataView(invalid.buffer).setUint32(33, 0xffffffff);
    expect(() => inspectQuickImage(invalid)).toThrow("文件不完整");
  });

  it("rejects zero dimensions, oversized images, animated PNG and unsupported PNG encoding", () => {
    for (const [width, height] of [
      [0, 10],
      [16001, 1],
      [5000, 5000],
    ]) {
      const bytes = png();
      const view = new DataView(bytes.buffer);
      view.setUint32(16, width);
      view.setUint32(20, height);
      expect(() => inspectQuickImage(bytes)).toThrow(/尺寸无效|图片过大/);
    }
    const animation = png();
    animation.set(new TextEncoder().encode("acTL"), 37);
    expect(() => inspectQuickImage(animation)).toThrow("动画");
    const invalid = png();
    invalid[25] = 7;
    expect(() => inspectQuickImage(invalid)).toThrow("编码格式");
  });

  it("accepts normal 8-bit JPEG or EXIF orientation 1 in either byte order", () => {
    for (const bytes of [jpeg(), jpeg(1), jpeg(1, false)])
      expect(inspectQuickImage(bytes)).toEqual({
        mime: "image/jpeg",
        width: 40,
        height: 20,
      });
  });

  it("rejects all rotated or mirrored JPEG orientations and invalid EXIF offsets", () => {
    for (const little of [true, false]) {
      for (let orientation = 2; orientation <= 8; orientation++)
        expect(() => inspectQuickImage(jpeg(orientation, little))).toThrow(
          "旋转或翻转",
        );
    }
    for (const orientation of [0, 9])
      expect(() => inspectQuickImage(jpeg(orientation))).toThrow(
        "EXIF 方向信息无效",
      );
    const bytes = jpeg(1);
    new DataView(bytes.buffer).setUint32(16, 0xffffffff, true);
    expect(() => inspectQuickImage(bytes)).toThrow("EXIF 方向信息无效");
  });

  it("checks all JPEG metadata before the first scan, including metadata after the frame", () => {
    const original = jpeg(6);
    const reordered = new Uint8Array([
      ...original.subarray(0, 2),
      ...original.subarray(38, 51),
      ...original.subarray(2, 38),
      ...original.subarray(51),
    ]);
    expect(() => inspectQuickImage(reordered)).toThrow("旋转或翻转");
    const highDepth = jpeg();
    highDepth[6] = 12;
    expect(() => inspectQuickImage(highDepth)).toThrow("8-bit JPEG");
    expect(() => inspectQuickImage(jpeg().subarray(0, 8))).toThrow(
      "段长度无效",
    );
  });

  it("limits bytes before reading or decoding a large File", async () => {
    const arrayBuffer = vi.fn();
    await expect(
      loadQuickImage({
        size: QUICK_IMAGE_LIMITS.maxBytes + 1,
        arrayBuffer,
      } as unknown as File),
    ).rejects.toThrow("15 MB");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe("browser-local decoding", () => {
  function stubBrowser(
    options: { fail?: boolean; width?: number; height?: number } = {},
  ) {
    const calls: string[] = [];
    const drawImage = vi.fn(() => calls.push("draw"));
    const fillRect = vi.fn(() => calls.push("white"));
    const context = {
      fillStyle: "",
      fillRect,
      drawImage,
      getImageData: () => ({
        data: new Uint8ClampedArray([
          255, 255, 255, 255, 100, 100, 100, 255, 255, 0, 0, 255,
        ]),
      }),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => "data:image/png;base64,dGVzdA==",
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = options.width ?? 3;
        naturalHeight = options.height ?? 1;
        onload?: () => void;
        onerror?: () => void;
        set src(_value: string) {
          queueMicrotask(() =>
            options.fail ? this.onerror?.() : this.onload?.(),
          );
        }
      },
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:local-image"),
      revokeObjectURL,
    });
    const bytes = png();
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 3);
    view.setUint32(20, 1);
    return {
      file: new File([bytes], "local.png", {
        type: "application/octet-stream",
      }),
      context,
      canvas,
      calls,
      revokeObjectURL,
    };
  }

  it("uses verified bytes, white backing and unchanged pixel dimensions", async () => {
    const browser = stubBrowser();
    const image = await loadQuickImage(browser.file);
    expect(image).toMatchObject({ name: "local.png", width: 3, height: 1 });
    expect([...image.gray]).toEqual([255, 100, 76]);
    expect(browser.context.fillStyle).toBe("#ffffff");
    expect(browser.context.fillRect).toHaveBeenCalledWith(0, 0, 3, 1);
    expect(browser.calls).toEqual(["white", "draw"]);
    expect(browser.context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
    );
    expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:local-image");
  });

  it("reports decode failures and releases object URLs", async () => {
    const browser = stubBrowser({ fail: true });
    await expect(loadQuickImage(browser.file)).rejects.toThrow("图片解码失败");
    expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:local-image");
    expect(browser.context.drawImage).not.toHaveBeenCalled();
  });

  it("rejects browser resizing or orientation changes instead of measuring altered dimensions", async () => {
    const browser = stubBrowser({ width: 1, height: 3 });
    await expect(loadQuickImage(browser.file)).rejects.toThrow(
      "解码尺寸与原图不符",
    );
    expect(browser.context.drawImage).not.toHaveBeenCalled();
    expect(browser.revokeObjectURL).toHaveBeenCalledOnce();
  });
});

describe("synthetic quick examples", () => {
  it("labels the six-lane example and encodes exactly the supplied grayscale values", () => {
    const image = createQuickExample();
    expect(image.name).toContain("非实验数据");
    expect(createQuickReferenceExample().name).toContain("内参");
    const bytes = png();
    const view = new DataView(bytes.buffer);
    const idatLength = view.getUint32(33);
    const raw = unzlibSync(bytes.subarray(41, 41 + idatLength));
    for (let y = 0; y < image.height; y++) {
      expect(raw[y * (image.width + 1)]).toBe(0);
      expect(
        raw.subarray(y * (image.width + 1) + 1, (y + 1) * (image.width + 1)),
      ).toEqual(image.gray.subarray(y * image.width, (y + 1) * image.width));
    }
    const centers = [90, 198, 306, 414, 522, 630].map(
      (x) => image.gray[84 * image.width + x],
    );
    expect(Math.max(...centers.slice(3))).toBeLessThan(
      Math.min(...centers.slice(0, 3)),
    );
  });
});

describe("original-depth TIFF in simple mode", () => {
  for (const depth of [8, 16] as const) {
    for (const little of [true, false]) {
      it(`decodes ${depth}-bit ${little ? "little" : "big"}-endian TIFF without browser quantization`, async () => {
        const pixels =
          depth === 16
            ? [1000, 1001, 1002, 32767, 32768, 65535]
            : [0, 1, 20, 127, 128, 255];
        const bytes = quickTiff({ depth, little, pixels, deflate: true });
        const imageConstructor = vi.fn();
        vi.stubGlobal("Image", imageConstructor);
        const image = await loadQuickImage(
          new File([Uint8Array.from(bytes).buffer], "source.TIF", {
            type: "application/octet-stream",
          }),
        );
        expect([...image.gray]).toEqual(pixels);
        expect(image.bitDepth).toBe(depth);
        expect(imageMaximum(image)).toBe(2 ** depth - 1);
        expect(image.original).toEqual({ mime: "image/tiff", bytes });
        expect(imageConstructor).not.toHaveBeenCalled();
        const png = decodePng(
          Uint8Array.from(atob(image.dataUrl.split(",")[1]), (c) =>
            c.charCodeAt(0),
          ),
        );
        expect(png.depth).toBe(8);
        expect([...png.data]).toEqual(
          pixels.map((value) => Math.round((value * 255) / (2 ** depth - 1))),
        );
      });
    }
  }
  it("preserves arithmetic RGB means including sub-unit differences", async () => {
    const bytes = quickTiff({
      width: 2,
      height: 1,
      channels: 3,
      depth: 16,
      pixels: [1000, 1001, 1001, 60000, 61000, 62001],
    });
    const image = await loadQuickImage(
      new File([bytes.buffer as ArrayBuffer], "rgb.tiff"),
    );
    expect([...image.gray]).toEqual([3002 / 3, 183001 / 3]);
    expect(inspectQuickImage(bytes)).toEqual({
      mime: "image/tiff",
      width: 2,
      height: 1,
      bitDepth: 16,
    });
  });
  it("rejects multi-page TIFF, BigTIFF, damage and mismatched extensions", async () => {
    const multipage = quickTiff({ next: 8 });
    await expect(
      loadQuickImage(
        new File([multipage.buffer as ArrayBuffer], "multiple.tif"),
      ),
    ).rejects.toThrow(/多页|Multi-page/);
    const big = quickTiff();
    new DataView(big.buffer).setUint16(2, 43, true);
    await expect(
      loadQuickImage(new File([big.buffer as ArrayBuffer], "big.tif")),
    ).rejects.toThrow("BigTIFF");
    const truncated = quickTiff().slice(0, -2);
    await expect(
      loadQuickImage(new File([truncated.buffer], "truncated.tif")),
    ).rejects.toThrow();
    const bytes = quickTiff();
    await expect(
      loadQuickImage(new File([bytes.buffer as ArrayBuffer], "wrong.png")),
    ).rejects.toThrow(/扩展名|extension/);
    await expect(
      loadQuickImage(new File([Uint8Array.from(png()).buffer], "wrong.tif")),
    ).rejects.toThrow(/扩展名|extension/);
  });
});
