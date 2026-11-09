# D07 measurement-core results

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `d07-implementation/MEASUREMENT-RESULTS.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

Actual run: 2026-11-08 12:24:38–12:24:42 UTC. Status: **passed for the captured measurement core**. The UI/API was still being integrated and is not covered by this pass claim.

## Results

| Evidence | Actual result | Interpretation |
| --- | --- | --- |
| Existing image corpus | 35/35 completed, 0 failed: 12 DAB, 17 IF, 4 H&E, 2 trichrome | Functional and legacy numerical regression on development inputs |
| Historical field comparison | 1,226/1,226 exactly equal, 0 differences | Every pre-existing JSON field, including old IF coloc values, matched the 2026-10-18 pinned baseline; 17 additional ifAnalysis fields are explicitly listed separately |
| Independent Python IF reference | 16 fixed cases: 12 valid, 4 rejected; 1,224/1,224 checks passed | Specified RGB and rectangular-ROI arithmetic agrees with separately written Python formulas |
| Finite Pearson/Manders error | Maximum absolute difference 6.661338147750939e-16 | Below the predeclared 1e-12 absolute tolerance; geometry, counts, background and thresholds required exact equality |
| Hand-calculated anchors | 17/17 passed before engine comparison | Simple analytic values check the independent reference itself |
| Input and old-evidence integrity | All 35 inputs matched their historical SHA-256; all inputs unchanged afterward; 76 protected historical files unchanged | No original image, old output or historical script was rewritten |
| Measured source integrity | 11 captured measurement/package files unchanged; snapshot unchanged | Reproducible source scope is recorded in measurement-source-summary.json |

The fixed cases include asymmetric 2D rectangular ROIs, reuse of whole-image background and thresholds, manual/automatic thresholds, threshold equality (strict greater-than), R/G and R/B selections, channel swapping, constant/zero signals, empty positive union, clipped and one-pixel regions, empty intersections, and four rejected ROI definitions. Undefined correlations and zero-denominator Manders values in dedicated ifAnalysis match null plus explicit reason identifiers. Legacy coloc conventions are retained separately.

No new independent DAB reference was run in this stage: the DAB result above is an unchanged-engine regression against historical outputs. No new biological experiment, acquisition-channel ground truth, raw high-bit-depth IF benchmark, independent external holdout, clinical classification or real-image IF truth comparison was added. The checks are software assertions, not independent experimental samples. The 17 IF corpus images are vendor RGB JPEG examples.

## Files and command

- `engine-and-if-reference-2026-11-08-core/run-report.json`: actual command, timestamps, runtime/browser versions, source and input hashes, protected-evidence checks.
- `engine-and-if-reference-2026-11-08-core/corpus-comparison.json`: all 1,226 historical-field checks and the list of 17 additional fields ignored for the legacy comparison.
- `engine-and-if-reference-2026-11-08-core/if-independent-comparison.json`: independent expected values, actual values, all checks, tolerances and analytic anchors.
- `engine-and-if-reference-2026-11-08-core/if-app-results.json`: actual new dedicated and legacy IF output, plus overlay hashes for the synthetic cases.
- `engine-and-if-reference-2026-11-08-core/results_m3/`: fresh numerical outputs for all 35 images; no source images or vendor overlays.
- `engine-and-if-reference-2026-11-08-core/source-snapshot/`: actual captured source; ephemeral node_modules symlink removed after running.
- `measurement-source-summary.json`: compact source scope and exact hashes for a later final-integration match check.

Executed from this directory:

```sh
python3 run_d07_validation.py --suite all --output engine-and-if-reference-2026-11-08-core
```

Runtime: Python 3.9.6, Node v24.14.1, macOS 27.0.1 arm64, Chrome 156.0.8078.81, Playwright 1.64.0, Vite 8.3.4, TypeScript 6.0.3. Browser phase: 3.752 seconds. Existing dependencies reused; no package installation or network image retrieval. Isolated Vite probe imported the official source engine and browser decoder.

`src/project-io.ts` changed in the live application while the run was executing. It was not loaded by this engine probe. That live change is retained explicitly in the run report and does not invalidate the unchanged measurement snapshot. This result does not claim that the whole application tree was frozen. Final UI/API/project roundtrip checks and a final application source snapshot remain separate work.
