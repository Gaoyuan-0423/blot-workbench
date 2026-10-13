import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildParitySamples,
  compareSample,
  parityImageDirectory,
  runImageJBatch,
} from "./rolling-ball.parity";

/**
 * Numeric parity against a real ImageJ installation. Skips silently on CI and
 * on machines without the private membrane corpus — never a public-repo gate.
 * Fixture pixels stay in a temporary directory and are deleted afterwards.
 */
describe("rolling-ball ImageJ parity", () => {
  it(
    "reproduces ImageJ Subtract Background on local membrane fixtures",
    () => {
      const directory = parityImageDirectory();
      if (!directory) {
        console.warn(
          "Skipped: local membrane corpus not found (set WB_PARITY_DIR to enable).",
        );
        return;
      }
      const jar = process.env.WB_PARITY_IJJAR;
      if (jar !== undefined && !existsSync(jar)) {
        console.warn("Skipped: WB_PARITY_IJJAR points to a missing ImageJ.");
        return;
      }
      const samples = buildParitySamples(directory, 3);
      if (!samples.length) {
        console.warn("Skipped: corpus directory has no usable images.");
        return;
      }
      try {
        runImageJBatch(samples);
        for (const sample of samples) {
          const outcome = compareSample(sample);
          expect(outcome.exactFraction).toBeGreaterThan(0.999);
          expect(outcome.maxDiff).toBeLessThanOrEqual(2);
          expect(outcome.intDenRelativeDiff).toBeLessThan(0.005);
        }
      } finally {
        for (const sample of samples)
          rmSync(dirname(sample.input8), { recursive: true, force: true });
      }
    },
    300_000,
  );
});
