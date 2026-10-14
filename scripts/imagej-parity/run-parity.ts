/**
 * Full rolling-ball parity sweep: N membrane fixtures × radii against local
 * ImageJ. Prints a markdown table for docs/validation-real-images.md.
 *
 * Usage: npx tsx scripts/imagej-parity/run-parity.ts [fileLimit]
 * Requires the private membrane corpus (~/Downloads/WB测试膜) and ImageJ;
 * images never leave the machine and outputs are temporary.
 */
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildParitySamples,
  compareSample,
  parityImageDirectory,
  runImageJBatch,
} from "../../src/real/rolling-ball.parity";

const limit = Number(process.argv[2] ?? 10);
const directory = parityImageDirectory();
if (!directory) {
  console.error(
    "Local membrane corpus not found (~/Downloads/WB测试膜/images or WB_PARITY_DIR).",
  );
  process.exit(1);
}
const samples = buildParitySamples(directory, limit);
console.log(`Running ${samples.length} ImageJ parity comparisons…`);
const started = Date.now();
runImageJBatch(samples);
const rows = samples.map(compareSample);
for (const sample of samples)
  rmSync(dirname(sample.input8), { recursive: true, force: true });

console.log("\n| fixture (staged id) | radius | pixels | exact | max |Δ| | mean |Δ| | IntDen rel. Δ |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const row of rows) {
  const label = row.sample.staged.split("/").pop()!.replace(/\.[^.]+$/, "");
  console.log(
    `| ${label} | ${row.sample.radius} | ${row.pixels} | ${(row.exactFraction * 100).toFixed(4)}% | ${row.maxDiff} | ${row.meanAbsDiff.toFixed(4)} | ${(row.intDenRelativeDiff * 100).toFixed(5)}% |`,
  );
}
console.log(
  `\nTotal: ${rows.length} comparisons in ${((Date.now() - started) / 1000).toFixed(1)}s; ` +
    `worst exact = ${(Math.min(...rows.map((r) => r.exactFraction)) * 100).toFixed(4)}%, ` +
    `worst maxDiff = ${Math.max(...rows.map((r) => r.maxDiff))}, ` +
    `worst IntDen rel. Δ = ${(Math.max(...rows.map((r) => r.intDenRelativeDiff)) * 100).toFixed(5)}%.`,
);
