import { detectBands, type Polarity, type QuickBand } from "../quick/analysis";
import type { QuickImage } from "../quick/image";

export type SinglePolarity = "auto" | "dark" | "light";

/** The image border estimates the background; source pixels are never inverted. */
function inferPolarity(image: QuickImage): Polarity {
  const { gray, width, height } = image;
  const border: number[] = [];
  for (let x = 0; x < width; x++) {
    border.push(gray[x]);
    if (height > 1) border.push(gray[(height - 1) * width + x]);
  }
  for (let y = 1; y < height - 1; y++) {
    border.push(gray[y * width]);
    if (width > 1) border.push(gray[y * width + width - 1]);
  }
  border.sort((a, b) => a - b);
  const middle = Math.floor(border.length / 2);
  const median =
    border.length % 2
      ? border[middle]
      : (border[middle - 1] + border[middle]) / 2;
  return median >= 127.5 ? "dark" : "light";
}

/** This entry point handles one strip only; multirow images are never split. */
export function recognizeSingle(
  image: QuickImage,
  mode: SinglePolarity = "auto",
  count?: number,
): { bands: QuickBand[]; warnings: string[]; polarity: Polarity } {
  if (!["auto", "dark", "light"].includes(mode))
    throw new Error("请选择自动、深色条带或浅色条带。");
  const polarity = mode === "auto" ? inferPolarity(image) : mode;
  const result = detectBands(
    image.gray,
    image.width,
    image.height,
    polarity,
    count,
  );
  return {
    ...result,
    polarity,
    warnings: result.warnings.map((warning) =>
      warning === "检测到多排信号，请启用多排自动分行，或裁剪到单排条带。"
        ? "检测到多排条带，请先裁成单排条带后导入。"
        : warning,
    ),
  };
}
