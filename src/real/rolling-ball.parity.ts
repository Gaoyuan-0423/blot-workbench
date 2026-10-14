import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "tiff";
import { rollingBallBackground, ROLLING_BALL_RADIUS_RANGE } from "./rolling-ball";
import type { Raster } from "./pixels";

/**
 * ImageJ parity harness. Verifies the rolling-ball engine against a real
 * ImageJ installation ("Process › Subtract Background", light background).
 * Requires local membrane images and ImageJ; everything is skip-safe so CI
 * without the private fixtures stays green. Fixture images never enter the
 * repository: outputs live in a temporary directory.
 */

export const PARITY_RADII = [25, 50, 100] as const;
export const PARITY_IMAGEJ_JAR =
  "/Applications/ImageJ.app/Contents/Java/ij.jar";

export interface ParitySample {
  /** Original fixture path, for reports only. */
  source: string;
  /**
   * ASCII-safe copy handed to ImageJ. ImageJ macro strings mangle non-ASCII
   * paths read back through File.openAsString, so fixtures are staged under
   * temporary ASCII names; the copies stay in the temp dir and are deleted.
   */
  staged: string;
  input8: string;
  corrected: string;
  radius: number;
}

export function parityImageDirectory(): string | null {
  const fromEnv = process.env.WB_PARITY_DIR;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const home = process.env.HOME;
  if (!home) return null;
  const candidate = join(home, "Downloads", "WB测试膜", "images");
  return existsSync(candidate) ? candidate : null;
}

/** Deterministic, format-filtered sample of the private membrane corpus. */
export function collectParityFiles(
  directory: string,
  limit: number,
): string[] {
  const files = readFileSync(join(directory, "..", "MANIFEST.json"), "utf8");
  const manifest = JSON.parse(files) as {
    images?: { file: string; bytes: number }[];
  };
  const entries = (manifest.images ?? [])
    .map((entry) => join(directory, "..", entry.file))
    .filter((path) => /\.(?:png|jpe?g|tiff?)$/i.test(path) && existsSync(path));
  if (entries.length) return entries.slice(0, limit);
  return [];
}

const PARITY_MACRO = `
arg = getArgument();
setBatchMode(true);
content = File.openAsString(arg);
lines = split(content, "\\n");
for (i = 0; i < lines.length; i++) {
  parts = split(lines[i], "\\t");
  if (parts.length < 4) continue;
  open(parts[0]);
  run("8-bit");
  saveAs("TIFF", parts[1]);
  run("Subtract Background...", "rolling=" + parts[2] + " light");
  saveAs("TIFF", parts[3]);
  close();
}
run("Quit");
`;

/** Run one batched ImageJ invocation for every sample via a manifest file. */
export function runImageJBatch(
  samples: ParitySample[],
  jarPath: string = PARITY_IMAGEJ_JAR,
): void {
  if (!existsSync(jarPath))
    throw new Error(`ImageJ not found at ${jarPath}; set WB_PARITY_IJJAR.`);
  const work = mkdtemp("wb-parity-");
  const manifest = join(work, "manifest.txt");
  writeFileSync(
    manifest,
    samples
      .map(
        (sample) =>
          `${sample.staged}\t${sample.input8}\t${sample.radius}\t${sample.corrected}`,
      )
      .join("\n"),
  );
  const macroPath = join(work, "macro.ijm");
  writeFileSync(macroPath, PARITY_MACRO);
  const result = spawnSync(
    "java",
    ["-jar", jarPath, "-macro", macroPath, manifest],
    {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 600_000,
      encoding: "utf8",
    },
  );
  rmSync(work, { recursive: true, force: true });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `ImageJ exited with status ${result.status}: ${result.stderr?.slice(0, 400)}`,
    );
}

function readGray8(path: string): Raster {
  const page = decode(readFileSync(path), { pages: [0] })[0];
  const { width, height, data } = page;
  const channels = data.length / (width * height);
  const bitDepth: 8 | 16 = page.data.constructor === Uint16Array ? 16 : 8;
  const max = bitDepth === 16 ? 65535 : 255;
  const pixels = new Float64Array(width * height);
  for (let p = 0; p < pixels.length; p++)
    pixels[p] = channels === 1 ? data[p] : (data[p * channels] + data[p * channels + 1] + data[p * channels + 2]) / 3;
  return { width, height, bitDepth, channels: 1, pixels, max, format: "TIFF", warnings: [] };
}

export interface ParityOutcome {
  sample: ParitySample;
  pixels: number;
  exactFraction: number;
  maxDiff: number;
  meanAbsDiff: number;
  /** |TS IntDen − ImageJ IntDen| / ImageJ IntDen over the full image. */
  intDenRelativeDiff: number;
}

export function compareSample(sample: ParitySample): ParityOutcome {
  const input = readGray8(sample.input8);
  const expected = readGray8(sample.corrected);
  if (input.width !== expected.width || input.height !== expected.height)
    throw new Error(`Dimension mismatch for ${sample.source}`);
  const background = rollingBallBackground(input, sample.radius, {
    lightBackground: true,
  });
  const offset = input.max + 0.5;
  let exact = 0,
    maxDiff = 0,
    sumAbs = 0,
    tsIntDen = 0,
    ijIntDen = 0;
  for (let i = 0; i < input.pixels.length; i++) {
    const corrected = Math.max(
      0,
      Math.min(input.max, Math.trunc(input.pixels[i] - background[i] + offset)),
    );
    const diff = Math.abs(corrected - expected.pixels[i]);
    exact += diff === 0 ? 1 : 0;
    if (diff > maxDiff) maxDiff = diff;
    sumAbs += diff;
    tsIntDen += corrected;
    ijIntDen += expected.pixels[i];
  }
  const count = input.pixels.length;
  return {
    sample,
    pixels: count,
    exactFraction: exact / count,
    maxDiff,
    meanAbsDiff: sumAbs / count,
    intDenRelativeDiff: Math.abs(tsIntDen - ijIntDen) / ijIntDen,
  };
}

/** Build samples for the corpus with a temporary (never-committed) output area. */
export function buildParitySamples(
  directory: string,
  fileLimit: number,
  radii: readonly number[] = PARITY_RADII,
): ParitySample[] {
  const work = mkdtemp("wb-parity-out-");
  const sources = collectParityFiles(directory, fileLimit);
  return sources.flatMap((source, index) => {
    const staged = join(work, `fixture-${index}${source.match(/\.[^.]+$/)?.[0] ?? ".png"}`);
    copyFileSync(source, staged);
    return radii.map((radius) => ({
      source,
      staged,
      input8: join(work, `fixture-${index}-r${radius}-in.tif`),
      corrected: join(work, `fixture-${index}-r${radius}-out.tif`),
      radius,
    }));
  });
}

function mkdtemp(prefix: string): string {
  const directory = join(tmpdir(), `${prefix}${process.pid}-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export { ROLLING_BALL_RADIUS_RANGE };
