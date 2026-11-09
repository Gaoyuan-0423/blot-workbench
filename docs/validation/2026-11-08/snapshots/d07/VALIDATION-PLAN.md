# D07 validation execution plan

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `d07-implementation/VALIDATION-PLAN.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

Prepared 2026-11-08. Status: planned; no D07 engine/reference run has occurred.
This directory is new evidence only. Historical scripts, images and results remain unchanged.

## Existing evidence and runner boundaries

- The original `local-only/ihc-inputs/run_m3.mjs` hardcodes `http://localhost:5173`, its own `images/`, and its own `results_m3/`. Direct execution would overwrite historical outputs. Do not run it in place.
- `manuscript/reproducibility/scripts/ihc_harness.mjs` already takes corpus, output and Vite URL arguments, emits numerical JSON only, and retains the same 35-image scene list and stain ROI geometry. A separately named D07 harness can reuse that list without modifying this historical file.
- `manuscript/reproducibility/scripts/run_ihc_pinned.py` always archives commit `dd41bae4bc27fda0b6bf1135b802e4af41ae7316`. It is suitable for reproducing that old revision, not the current uncommitted D07 implementation.
- Historical independent DAB reference: `ihc_reference_aligned.py`, 8 images / 10 ROIs, with geometry and preprocessing corrections. Original `compare_reference.py` and its README contain superseded comparisons; use the corrected 2026-10-18 evidence.
- No independent IF Python/ImageJ/QuPath metric comparison was found in the inspected corpus or manuscript reproducibility scripts. Existing IF evidence comprises 17 RGB vendor JPEG execution records and application-side small hand-calculated tests. These images are not raw acquisition channels, independent biological units, or external holdout data.

## Run A: all 35 images after core freeze

Create a new exclusive output subdirectory, e.g. `engine-regression-2026-11-08-final/`; refuse to overwrite it. Use a new sidecar runner with explicit `--repo`, `--ihc-root`, `--output`, and `--browser-channel chrome` arguments. Do not use a production or user browser session.

1. Snapshot actual current source files and build configuration into a disposable isolated directory; preserve current HEAD, dirty diff hash, per-file SHA-256, runner hash and dependency versions. A Git HEAD label alone is insufficient for uncommitted changes. Reuse existing node_modules with no install/download. Check the measured source hashes again at completion to detect mid-run drift.
2. Start Vite in the snapshot on an available loopback port with strict port binding. Launch installed Chrome headlessly with `--no-proxy-server` and import the official engine through this server. Record actual Node, Python, browser and library versions.
3. Read exactly the 35 existing manifest inputs: 12 DAB, 17 IF, 4 H&E, 2 trichrome. Verify their SHA-256 against `manuscript/reproducibility/datasets/ihc-35-input-sources.json`; use historical scene settings and ROI geometry. No image or overlay is copied into the evidence package.
4. Save fresh numerical JSON and completion/errors. Compare legacy measurement fields against `manuscript/reproducibility/ihc-engine-pinned-20261018/results_m3/`. Require 35 completed / 0 failed. For unchanged whole-image metrics aim for exact agreement, recording every field difference, nonfinite value and schema change rather than silently adjusting tolerances. IF-specific added fields are reported separately. Any decoding/runtime drift must be investigated, not presumed causal.
5. Optional strengthened DAB check: execute the existing aligned reference read-only with explicit fresh application-results and a new output path. It emits only numerical evidence. This cannot validate IF, H-score or biological classification.
6. Hash relevant original manifests, scripts and baseline result JSON before/after to demonstrate that the run did not rewrite old evidence.

## Run B: independently implemented IF RGB and rectangular-ROI arithmetic

Wait for the new core signature/result contract before wiring the application driver. Keep fixture generation and independent Python formulas outside the application repository. Python must not import or translate calls into production measurement helpers; use separately written histogram/Otsu, centered Pearson sums and Manders intensity sums from fixture RGB arrays.

Proposed cases:

- Asymmetric 2D RGB arrays with two distinct rectangles, whole-image reference and a clipped-border rectangle according to the agreed ROI rule. This exposes x/y transposition, wrong crop origin and accidental whole-image reuse.
- Manual thresholds with values exactly at threshold, nonzero background percentile and disjoint/overlapping channel signal. Confirm strict greater-than positivity and masked Pearson over the channel-positive union.
- Automatic thresholds with nontrivial whole-image histogram, while ROI histograms differ strongly. Compute background/threshold once over the whole image if that is the frozen contract, then reuse for all ROIs. This detects accidental per-ROI retuning.
- R/G and R/B selections and channel swapping: Pearson is symmetric, M1/M2 exchange, channel-specific background/threshold identities swap.
- Constant channels, empty positive union and one-pixel ROI: record undefined Pearson as null/nonfinite according to serialization contract; zero-intensity Manders handling must follow the explicit documented compatibility rule. Do not turn an undefined correlation into a valid zero.
- No-ROI request preserves old whole-image numerical results. Multiple ROI count is a measurement count, never independent n.

For integer RGB arrays with integer histogram backgrounds, require pixel counts/backgrounds/thresholds exactly equal. For finite Pearson/Manders use a predeclared absolute tolerance of 1e-12 (and record observed maximum error); nonfinite status must match. Resolve Otsu ties, percentile endpoint and rectangle rounding/clamping explicitly before running, not after observing failures.

The report must retain fixture hash, every expected and actual value, tolerances, command, environment, current source hashes and all failure details. Additional real-JPEG decoding comparisons, if performed later, must be labeled separately from exact-array arithmetic validation.

## Integration evidence to be supplied by app tests

- IF-specific sample records retain image/source identity, channel/threshold/background/mask definition, whole image versus rectangle scope, pixel geometry and actual results.
- Project export/import preserves original bytes and this configuration; recomputation agrees with saved results. Imported historical or stale results cannot be silently treated as current.
- Channel/background/threshold/ROI edits invalidate the previous result immediately, including save/export during pending work and late worker responses.
- IF records cannot enter stain-metric aggregation or fabricate positive-area, H-score or nucleus measurements. Independent-unit statistics require their own verified metric/scope contract.
- Bilingual UI, API, Methods and exports agree on RGB input, ROI scope and limitations.

These runs establish software regression and numerical consistency for specified RGB arrays and development images. They do not establish biological truth, assay validity, clinical accuracy, raw-channel/high-bit-depth support or external generalization. No new experiment or independent holdout is added.
