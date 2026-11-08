# D07 sidecar verification runners

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `d07-implementation/README-RUNNERS.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

Prepared and executed 2026-11-08. **The captured measurement-core run passed:** 35/35 images, 1,226 exact historical-field checks and 1,224 independent IF checks. See `MEASUREMENT-RESULTS.md` and `engine-and-if-reference-2026-11-08-core/run-report.json`. These sidecars are outside the application repository; reruns require a frozen measurement core and a new output directory.

`if_reference.py` is an independently written Python standard-library reference from fixed RGB integer arrays. It does not import application algorithms. It uses centered deviations for Pearson, separately calculated histogram/Otsu thresholds, and explicit region intensity sums for Manders. This tests agreement with the declared RGB computation specification, not whether that specification answers a biological question.

`if-fixed-fixtures.json` contains 16 cases: 12 valid cases and 4 rejection cases. They exercise asymmetric two-dimensional rectangles, manual and automatic thresholds, global preprocessing reused in ROIs, R/G and R/B selections, channel swapping, values equal to the threshold, constant and empty channels, clipped/outside/one-pixel rectangles, and invalid/duplicate ROI definitions. Seventeen hand-calculated anchors validate simple reference values before the application is compared. No fixture is a biological replicate or independent holdout.

`run_d07_validation.py` takes an exclusive new output path, snapshots the actual current application sources, and runs `d07_harness.mjs` in headless installed Chrome against a separate Vite server. The probe uses the unchanged official engine and browser decoder through an explicit minimal Vite configuration; it is not an application UI test. Existing dependencies are reused and no installs occur. Images and derived overlays are not saved to the evidence output.

From this directory, after core freeze:

```sh
python3 run_d07_validation.py \
  --repo pathology-workbench \
  --ihc-root 'local-only/ihc-inputs' \
  --browser-channel chrome \
  --suite all \
  --output ./engine-and-if-reference-2026-11-08-final
```

The final component of `--output` must not already exist. Reruns need a different directory. `--suite corpus` and `--suite if` are available for a justified targeted rerun; they do not imply the omitted suite passed.

The 35-image corpus is selected from the historical source manifest and each original file must match its recorded SHA-256. Legacy measurements are compared against the 2026-10-18 pinned browser outputs: **every old field must match exactly**, with additional D07 fields named separately and ignored only for this legacy comparison. A numeric discrepancy is a failure requiring investigation; the script never silently rewrites a baseline or changes its tolerance. The corpus is 12 DAB / 17 IF / 4 H&E / 2 trichrome and remains development regression data.

For the independent IF comparison, counts, geometry, background and threshold values must match exactly. The four finite Pearson/Manders metrics use absolute tolerance `1e-12`, specified in the fixture before execution. Undefined values must be `null` with matching reason identifiers. The legacy `coloc` output is retained separately from the new dedicated `ifAnalysis`, whose undefined Manders values are `null` rather than legacy compatibility zeroes.

The run report retains command, package/browser/runtime versions, actual source-file hashes, source snapshot digest, Git HEAD/status/diff hash, input hashes, baseline hashes and output hashes. It checks source and protected evidence again after the run. The live measurement dependency graph is recorded from browser module requests (plus types and package manifests). A change to a measured dependency, or any change inside the captured source snapshot, fails the overall status. Other live UI/API changes are recorded but do not invalidate this explicitly core-scoped run. UI/API integration may still be active; the final application source snapshot and software suite are separate evidence.

Preparation checks actually executed:

```sh
python3 if_reference.py --self-check
node --check d07_harness.mjs
python3 run_d07_validation.py --help
```

Both Python scripts were additionally parsed with `ast.parse`. The independent self-check reported 16 cases, 12 valid cases and 17 passed hand-calculated anchors. **No application engine was called by these preparation checks.**

Optional additional DAB reference after a successful 35-image run (this historical script is only read/executed, not edited):

```sh
python3 ../../../reproducibility/scripts/ihc_reference_aligned.py \
  --ihc-root 'local-only/ihc-inputs' \
  --app-results ./engine-and-if-reference-2026-11-08-final/results_m3 \
  --output ./dab-aligned-reference-2026-11-08-final
```

This optional comparison validates only its selected 8 H-DAB images / 10 ROIs. It cannot substitute for IF, nuclei, H-score, raw-channel/high-bit-depth or biological truth validation.
