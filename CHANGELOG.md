# Changelog

## 0.2.0-dev.1 — 开发中 / Unreleased

- 可选本机视觉 API 配置：Base URL、模型 ID、仅内存密钥、显式清除。
- 使用固定内置合成 PNG 检查 Chat Completions 图像输入与候选矩形 JSON 响应；不发送项目图像或样本数据，不计算模型灰度。
- 更换服务来源清除旧密钥；取消/超时、来源检查、配置版本与错误脱敏。
- 继续保留现有手动演示流程；批量真实图像分析与自动出图是独立后续阶段。
- 未发布新 Release，未替换线上演示；具体运行证据见 `docs/vision-api.md`。


The [public repository](https://github.com/Gaoyuan-0423/blot-workbench) and [live demo](https://gaoyuan-0423.github.io/blot-workbench/) are available. See [the prerelease record](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1) for the version archive and final build evidence, and [the validation record](docs/validation.md) for test scope and limitations.

## 0.1.0-alpha.1 — 2026-10-10 (alpha)

Initial synthetic-data browser workflow demonstration.

### Added

- A multi-batch Western blot project example with 8 synthetic images and 6 shared experimental units.
- Sample and lane context, band/background ROI review, reference pairing, and review states.
- Analysis-time template snapshots and stale-state handling for changed configurations.
- Preset illustrative normalization values, project recovery, and export workflows.
- Chinese/English interface and introductory documentation.
- MIT license, citation metadata, contribution guidance, and explicit validation boundaries.

### Workflow safeguards

- Commit notes, sample names, and project names after a typing pause, without requiring focus to leave the input.
- Show pending input/storage work as **Saving** and request a browser confirmation before leaving with unsaved work.
- Restore the previous valid value when a required field is left blank and loses focus.
- Validate project archives before showing an explicit workspace-replacement confirmation, with options to export the current project or cancel.

The [M1 main-branch CI run](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38060883807) passed 18 core tests, 12 script tests, and 7 end-to-end tests in each Windows/macOS × Chrome/Edge combination. Evidence is tied to each recorded source commit; see [the validation record](docs/validation.md) for the tested behavior and environments.

### Limitations

- No real TIFF/PNG import or scientific image quantification.
- No inferential statistics, publication figure builder, IF analysis, desktop installer, or Wisp plugin.
- Quality labels and numerical outputs are fixtures, not algorithmic findings.
- Recorded platform coverage applies to the tested workflow and environments, not all browser/system versions or scientific quantification.
