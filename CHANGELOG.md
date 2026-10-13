# Changelog

## 0.4.0-dev.1 — 开发中 / Unreleased

- 可选的 rolling ball 背景扣除：与 ImageJ「Subtract Background」逐像素一致（独立 TypeScript 实现其公共领域算法），与现有局部背景取样框方法共存可切换；切换会使全部复核状态失效。结果与 CSV 记录 `background_method`、`rolling_ball_radius`，10 张膜 × 半径 25/50/100 的实测对照见验证文档（最差逐像素精确率 99.9955%、IntDen 相对差 ≤0.00002%）。
  Optional rolling-ball background correction, pixel-compatible with ImageJ's Subtract Background (independent implementation of its public-domain algorithm), coexists with the existing local-background-ROI method; switching invalidates review states. Results and CSV record `background_method` and `rolling_ball_radius`; a 10-membrane × 3-radius parity table is in the validation notes (worst pixel-exact 99.9955%, worst IntDen delta 0.00002%).
- 泳道候选升级为列投影 + Otsu 分割（左侧 N 条，右侧 marker 明确报告），每条泳道用自身行投影定位条带（不均匀跑带不再整体塌缩到同一行）；泳道间浅沟与多排歧义保持显式警告或阻断。
  Lane proposals upgrade to column-projection + Otsu segmentation (leftmost N runs; trailing markers reported), with each lane's band located by its own row projection so uneven runs no longer collapse onto one row. Shallow gutters and multi-row ambiguity keep explicit warnings or blocks.
- 可选视觉 API 候选：`POST /api/vision/analyze` 把缩小预览与已声明泳道标签转发到用户配置的 OpenAI 兼容服务（密钥仅存本机进程内存），严格校验归一化的逐泳道条带矩形；结果经哈希+预览+模型+提示词绑定缓存合并进候选并全部标记待复核。像素测量仍 100% 本机；无 API Key 时完整流程不受影响。
  Optional vision-API candidates: `POST /api/vision/analyze` forwards a downscaled preview plus declared lane labels to the user-configured OpenAI-compatible provider (key only in local process memory) and strictly validates normalized per-lane band rectangles. Merged via a hash+preview+model+prompt-bounded cache, always marked for review. Pixel measurement stays fully local, and the whole flow works without any API key.
- 组合图版导出：标注 ROI 的原图 + 定量图 + 方法说明（背景方法/半径、归一化基准、版本）合成为单张 SVG/PNG/TIFF。
  Composed figure export: ROI-annotated original plus the quantification chart and a method footer (background method/radius, normalization baseline, version) assembled into one SVG/PNG/TIFF.

## 0.3.0-alpha.1 — 2026-10-13 · 预发布 / Pre-release

以 `0.3.0-dev.1`–`0.3.0-dev.3` 开发预览合并发布。公开网页仍部署 `0.1.0-alpha.1`；本版经 GitHub Release 附件分发。 / Released from development previews dev.1–dev.3. The public website still deploys `0.1.0-alpha.1`; this version ships via GitHub Release assets.

- 新建真实项目默认使用共同基准：完成设计后自动以第一个可用对照为基准；可显式确认默认值或切换回各自配对对照。与默认一致的选择会被明确记录，不再被当作无操作丢弃；绘图基准不改变配对检验输入。旧存档（无偏好字段）保持匹配对照行为，已存策略不受影响。
  New real projects default to a common baseline: after the design is set, the first available control is chosen automatically. Choices matching the default are recorded instead of being discarded, and plot baselines still never change paired-test inputs. Archives created before this preference keep matched-control behavior, and stored policies are untouched.

## 0.3.0-dev.2 — 开发中 / Unreleased

- 明确的 N/T 个体配对表：来源图组、个体编号与两条泳道分别记录，不把图数、日期或重复曝光视为独立 n。
  Explicit N/T pair tables distinguish source groups, individual IDs, and lane positions; images, dates, and repeat exposures do not define n.
- 保留匹配对照归一化，新增指定一个对照为共同基准；其他对照保留变异，跨膜/批次可比性仍需验证。
  Adds a selected common control baseline alongside matched-control scaling; other controls retain variation without establishing cross-membrane or cross-batch comparability.
- 默认柱图叠加个体点和均值 ± SD，可切换配对连线图。
  Default bars with individual points and mean ± SD, plus an optional paired-line view.
- 显式选择的双侧配对 t 检验默认关闭，使用原始目标/内参比值，报告实际 n、df、未校正 P 值、配对均值差及其 95% CI；保留质量警告与 DRAFT。新增 MIT 依赖 `jstat@1.9.6`。
  Opt-in two-sided paired t-tests use original target/reference ratios and report n, df, unadjusted P, mean paired difference, and its 95% CI while preserving quality flags and DRAFT. Adds MIT-licensed `jstat@1.9.6`.
- 网站示例、公开截图与验证素材只使用合成数据，不预载或发布用户私有图片、项目与结果。
  Website examples, public screenshots, and fixtures use synthetic data only; private images, projects, and results are neither preloaded nor published.
- 未发布新 Release，公开 alpha 保持原版本。本版验证结果须对应当前提交单独记录，不能沿用下方旧版测试结论。
  No new Release or public-alpha replacement. Validation must be recorded against the current commit rather than inherited from prior checks.

## 0.3.0-dev.1 — 开发中 / Unreleased

- 独立真实图像工作区 `#real`：保留原始 TIFF/PNG，支持有限的 8/16 位格式、本机扣背景、内参和匹配对照归一化。
  Separate real-image workspace retaining original TIFF/PNG bytes, bounded 8/16-bit decoding, local background correction and paired normalization.
- 一次描述泳道、批量候选、手动拖动/缩放、版本历史、质量警告、独立项目保存与恢复；完整中英文。
  Shared lane descriptions, batch proposals, manual adjustment, analysis history, quality flags, separate recovery, and bilingual controls.
- CSV 中间量与坐标；每蛋白配对点图、均值 ± SD、SVG/PNG/TIFF 导出。完整配对实验才进入汇总，不自动检验或生成星号。
  Auditable CSV, protein-specific paired points and mean ± SD, SVG/PNG/TIFF export. Only complete paired experiments enter summaries; no automatic inferential test.
- 仍为实验性预览，未替换公开 alpha；支持与测试范围见 [验证记录](docs/validation-real-images.md)。
  Experimental preview, not a replacement for the published alpha. See [validation](docs/validation-real-images.md).

## 0.2.0-dev.1 — 开发中 / Unreleased

- 独立「使用教程 / User guide」页面，完整中英文步骤、API 说明、恢复提示与常见问题；可直接打开 `#guide`。
  A dedicated bilingual user guide with workflow steps, API setup, recovery advice, and FAQs, available at `#guide`.
- GitHub 首页改为中英文对照，补充完整英文 API 使用指南。载入示例或新建项目保留当前界面语言。
  The repository landing page now presents Chinese and English together, with a complete English API guide. Loading an example or creating a project preserves the interface language.
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
