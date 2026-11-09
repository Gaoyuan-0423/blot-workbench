# 当前实现核查与开发边界

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `SOURCE-AUDIT.md`; 原件与导出件 SHA-256 见 [export-map.json](export-map.json). 未分发材料见 [说明 / omissions](NOT-DISTRIBUTED.md).

核查日期 2026-11-08；依据当前源码静态阅读。未在本次执行应用测试或复跑科学分析。四个仓库核查时 `git status --porcelain` 均为空。

| 组件 | 正规源目录 | HEAD |
|---|---|---|
| WB | `blot-workbench` | `fd867d89fab3602ad24a2d5cb973e54577595b4e` |
| 病理/IF | `pathology-workbench` | `bb9c45c0fc81fe7ea0c449d209e9d63e6eb66a2e` |
| qPCR | `pcr-workbench` | `a0642a7b5eee6f576e3257f5c61efaabae1741ed` |
| CLI/MCP | `wisplab-cli` | `714197daae7a99eac20c68871e9928f837e4ab66` |

`historical-protected-wb-checkout` 是旧主工作区，本次未在此修改产品源码。后续 WB 修改遵守正规源的 AGENTS.md。

## qPCR

`src/core/analysis.ts:209` 将同 sample×target 的各技术孔 Cq 减参考均值后保存为 `deltaCtValues`；约 246 行展开对照孔，约 325 行 Welch 使用这些孔值，约 339 行的 n 对应孔。`group` 和 `pairId` 的存在不等于实现了以独立单位为基础的组间/配对推断；约 377 行的多组输入也需要随设计模型共同检查。旧说明中“按生物学重复统计”的概括与代码不一致。

首轮应显式确认实验单位，再技术聚合、组内汇总独立单位。对照归一化避免由每个体技术孔数决定权重。当前数值结果由 `src/App.tsx:405` 附近的 `useMemo([rows, config])` 重算，不能概括为整个 PCR 不刷新；需要另处理导入时保存的报告和 `src/ui/AiInterpretCard.tsx:25` 附近的旧解读/迟到请求。

已有 `src/project-io.ts:59` 的原始仪器文件、表格、熔解数据和配置归档，继续复用。

## 病理与 IF

`src/ui/SamplesPanel.tsx:57` 附近按样本库图像条目进行组间统计，没有完整的实验单位→切片→视野层级。组间推断前需要确认独立单位和汇总目标。

`src/App.tsx:126` 附近已有自动重算和过期异步任务处理，但重算期间旧 `analysis` 可继续存在；导出/Methods/API 需要共用有效结果判断，避免当前参数配旧结果。这是静态代码定位的风险，后续应以 `challenge-cases.csv` 中快速修改后导出案例复现。

IF 当前提供整图 RGB 共定位，`src/core/analysis.worker.ts:51` 返回空 `perRoi`，`src/App.tsx:649` 附近禁止 IF 批量/加入样本。下一步扩展 IF 专用结果、ROI 与现有项目包；原始多通道和高位深另做明确的输入规格与验证，不能用 RGB 合成图替代。

病理已通过 `src/project-io.ts:4` 等保存原图、对照、设置、结果与模型信息。原图归档无需重建。

## WB 与 CLI/MCP

WB 的 `src/real/model.ts` 已有 `unitId` 配对、原图哈希、项目归档、复核失效和图像修订历史。局部背景与 rolling-ball 通路已有支持范围内的 8/16-bit 原始数组计算；不能把“新增16-bit支持”当作待从零实现的工作。

CLI 的 `runners/wb-run.ts:8` 只接部分像素测量/背景函数，约 23 行重新提议 ROI，没有复用 GUI 固定项目的完整计算路径；约 54 行对 ratio 使用 `toFixed(6)` 后转数值。首轮应接现有项目导入及 `model.results/realPairedTests`，将格式化限制移至展示层。

项目级背景、归一化和配对配置还需与图像历史一起形成完整分析身份。复用 `src/real/model.ts:309,735` 已有失效机制，区分测量配置和语言/配色等展示设置。

CLI `docs/provenance.md` 已记录输入/源码指纹、运行时间、配置与环境，`tests/integration/engines.test.mjs` 已有集成回归。该记录不是原始文件快照；本次新增框架只组织证据和缺口，不另建重复的 provenance 系统。
