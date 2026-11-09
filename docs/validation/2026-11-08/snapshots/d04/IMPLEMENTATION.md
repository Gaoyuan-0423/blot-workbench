# D04：病理实验单位与视野汇总

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `d04-implementation/IMPLEMENTATION.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

日期：2026-11-08。本轮在 `pathology-workbench` 继续实现已授权的验证开发，范围为 IHC/H&E/Masson 整图记录的来源、独立单位、切片、视野关系及组间统计。IF 尚缺专用样本指标，D04 的跨模块总任务记为 `partially_implemented`，其 IF 部分依赖 D07。

这些是软件行为和固定合成指标验证，没有新增真实实验数据、独立外部留出或用户研究。正式提交稿、原始图像与历史数值基准保留原位；P0 报告保留当时的结果和源码状态。

## 已实现

- 样本库增加设计类型、对照组、单位/切片/视野身份和确认步骤。修改映射、组别、纳入状态或加入记录即撤销确认。实验者确认独立性，程序不从名称猜测。
- 新图像保存原文件 SHA-256 和实际分析预设；字节相同的改名副本可识别。旧记录可从保留原图及历史设置补全来源和预设；没有附件时不补造已知事实。
- 统计顺序为同来源同视野去重 → 切片内视野均值 → 单位内切片等权均值。每单位向所在组贡献一个值；分别报告 nRecords、nImages、nFields、nSections 和所选指标有效 nBio。
- 复制同一视野不增加权重或 nBio。相同来源映射到不同视野、同视野不同来源、同单位跨独立组、重复记录值冲突、混合/未知预设均阻止推断；可排除旧记录或其他染色，同时保留原值。
- 预声明视野缺指标时，整个单位的组级值留空，不重新分配剩余测量的权重；有效零值保留。空组或不足两个有效单位的组不会被静默剔除；nBio=0 不画成零柱，nBio=1 不绘制 SD。
- 未确认、无效、配对和重复测量设计仅提供描述。IF 占位 RoiMetrics 及非整图 ROI 记录不能进入这条组间推断路径。
- 样本库、诊断 API、图表、Excel、CSV 和中英文 Methods 共用 `sampleStatistics`。图表标明 nBio；原始记录与单位汇总分开导出。项目包保存设计、排除状态和来源，核验已有原图哈希及历史预设。
- 两组使用 Welch；多组 ANOVA/Dunnett 包含明确对照组。Dunnett raw p 与 adjusted p 使用相同合并方差和自由度，修正旧 raw p 使用 Welch 的不一致。检出多组异方差时不计算普通 ANOVA/Dunnett；Welch ANOVA 尚未实现。
- n<8 或无法计算正态性时明确显示未知，不当作偏离正态。参数及秩检验结果需按预声明方案解释，不能按显著性择优报告。

## IF 报告边界修复

现有 IF 引擎的兼容字段把 Manders M1 存在 `positiveFraction`，另有 IOD 等占位零值。本轮没有修改其测量算法，但修复了报告层的误标：IF 记录的染色指标在描述统计、CSV、Excel 和 API 中留空并注明不支持，不把 M1 命名为阳性面积，也不把未测量值写成真实零。真实共定位结果保留在 `colocalization`。原始项目记录不被改写。

## 验证证据与复跑

软件检查由 `run-software-checks.py` 调用仓库原命令，逐项保存输出和退出码。每次输出目录须为新目录；不能覆盖先前结果。

首轮完整软件检查见 `software-checks/`：23 文件、206 单元测试通过；构建及 lint 退出 0；浏览器 19/20。唯一失败为旧有效性测试点击加入样本后同步断言，而新流程须等待原文件异步哈希；修改测试为等待样本实际保存，保留原有效性断言。随后补齐英文 JSON 的嵌套统计提示翻译，并重跑最终全套，最终结果另存 `software-checks-final/`。

| 最终检查 | 结果 |
|---|---|
| `npm test` | 24 文件、207/207 tests 通过 |
| `npm run build` | TypeScript 和 Vite 生产构建通过 |
| `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=5197 npx playwright test --workers=1 --reporter=line` | 全部 20/20 通过，48.7 秒 |
| `npm run lint` | exit 0；仍有 9 条 React refs/effect/memoization warnings |
| `git diff --check` | 通过 |

各命令原始输出及退出码见 `software-checks-final/results.json` 和同目录日志。构建仍提示部分分块超过 500 kB，未进行性能优化或性能基准。原有截图测试会生成 README 图像；本轮运行器把新图像保存在证据目录，再恢复运行前图像字节，避免无关改图。

独立数值报告见 [README-independent-numerics.md](README-independent-numerics.md) 和 `independent-pathology-numerics-2026-11-08-final.json`：四个固定合成场景、205/205 项检查通过。这些是软件断言，不是 205 个实验。Python 从原始视野指标独立汇总，不导入应用聚合代码。

| 示例 | 实际行为 |
|---|---|
| 每组 3 单位 × 每单位 5 视野 | 每组 nBio=3、nImages=15；检验输入为 3 个单位值 |
| 两切片视野分别为 `[10,20,30]`、`[90]` | 单位值为 `(20+90)/2=55`，不是直接视野均值 37.5 |
| 复制一条相同来源视野 | 原始记录从 7 增至 8，唯一视野仍为 7，单位值、nBio 与 Welch p 不变 |
| 平衡两组 Welch p | 引擎 0.04191451747145414，SciPy 0.04191451747145410 |
| 三组 ANOVA p | 引擎 0.010518015685796134，SciPy 0.010518015685796110 |

Dunnett adjusted p 对照为五个固定种子的 SciPy 随机积分均值，本批最大绝对误差约 `8.68e-5`，小于预定 `5e-4`。它只覆盖本批中等 p 值，不声称极深尾部准确性。原始数值报告与补充 ROI 范围保护后的 final 报告均保留，不能混用其源码摘要。

浏览器覆盖层级输入、图表/Excel/SVG、归档恢复、确认失效、来源和分组冲突、排除、缺失指标，以及哈希等待期间切换 AI/取消批处理。真实 Worker 的 IF 报告检查使用合成 RGB 图，仅检验报告契约。受控 Worker、固定样本指标和合成图像均不作为真实实验准确性证据。

截图 `screenshots/*-review.png` 为固定合成数据的 UI 审阅证据，已标注非真实实验。窄侧栏内表格支持横向滚动；汇总截图滚动到 nBio 列。

原始材料复核见 `../inventory-audit-after-d04.json`：90 个文件哈希匹配、0 errors、5 个既有 warnings（4 个缺失历史转换快照和 1 组相同合成图）。没有将缺失项当作复现通过。C15–C17 新增对应回归记录，独立裁定状态保持 `proposed_not_adjudicated`。

## 版本与限制

本轮仍在本地 `codex/validation-p0-20261108`，基线 HEAD 为 `bb9c45c0fc81fe7ea0c449d209e9d63e6eb66a2e`。基线不代表本轮代码版本；以本目录 `source-state.json` 的工作树文件哈希为准。`pre-d04-working-changes.zip` 保留本轮之前的 P0 变更；`working-tree-source.zip` 保存最终变更文件与 tracked patch，包含仍未提交的 P0 部分，清单逐文件区分本轮是否改变。不覆盖旧证据。尚未提交、推送或部署。

本轮未改变图像解码、分色、阈值、分割或共定位测量公式，未重跑历史 35 图精度基准；不能将统计层检查算作各染色指标的新增准确性证据。qPCR/CLI 未在本轮修改或重复执行测试。

相同预设和明确单位身份仍不能证明染色批次、采样、标定或设置可比。原文件哈希仅能识别完全相同字节，不能发现所有裁剪/重编码同源关系。切片等权均值是一个明确估计目标，不等于合并像素的总体面积比例；真实实验是否适用、单位是否独立、缺失是否引入偏倚，仍需实验者审查。

下一阶段是 D07：IF 专用指标与矩形 ROI、通道/背景/阈值/掩膜归档及往返；再接入单位层级。原始多通道/高位深格式和 C/Z/T 轴处理属于 D11，尚未实现。现有输入全部仍是 development_regression，external_holdout=0；当前结果不能证明生物学结论有效或预测 Nature Methods 的录用。
