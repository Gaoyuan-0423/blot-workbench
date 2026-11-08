# WispLab 验证记录入口 / Validation evidence — 2026-11-08

**这是 2026-11-08 原验证分支的公共文本快照。WB 本次只增加文档，不改变应用代码。** 各轮记录中的“当前”“未提交”和基线 HEAD 描述当时本机工作区，不代表后续 GitHub 主线、发布版本或跨仓库集成已通过检查。PCR 与 CLI 已另行提交基于更晚主线的移植 PR，其最终集成结果必须另外记录，不能用这里的旧检查替代。

**This is a public text snapshot of the original validation branch on 2026-11-08. This WB change is documentation only.** Historical references to a current or uncommitted working tree describe the original run, not a later GitHub revision or release. PCR and CLI changes are submitted in separate PRs against newer upstream branches. Their final integration checks must be recorded separately; these earlier checks do not certify those integrations.

代码跑通只代表流程执行完毕，结论有效性依然要实验者确认。这里没有新增独立实验数据、外部留出、盲评、用户收益研究或真实模型质量评价。

Successful execution does not establish the validity of an experimental conclusion. This export adds no independent experimental data, external holdout, blinded evaluation, user-benefit study or evaluation of real model interpretation quality.

## 阅读入口 / Reading order

| 资料 / Material | 范围 / Scope |
|---|---|
| [交接清单 / Handoff checklist](handoff/01-checklist.md) | WB、IF、IHC、H&E、Masson、qPCR 的已做事项与后续问题；按历史时点阅读 / Cross-module scope and next questions at the historical checkpoint |
| [研究方案 / Research plan](PLAN.md) | 研究问题、预定比较与终点；方案不等于已取得研究结果 / Proposed questions, comparisons and outcomes, not completed research |
| [开发待办 / Development backlog](development-backlog.csv) | 以 `status` 和 `implementation_note` 判断当时状态；`verified_gap/source` 保留开发前快照 / Status fields govern the checkpoint; gap and source columns retain the earlier audit |
| [挑战案例 / Challenge register](challenge-cases.csv) | 软件回归和独立真值裁定分开登记 / Software regression and independent adjudication are separate |
| [模板说明 / Template guide](TEMPLATE-GUIDE.md) | [单位映射](templates/experimental-units.csv)、[任务登记](templates/task-register.csv)、[执行记录](templates/evaluation-log.csv) 都只有表头 / All three templates are empty |
| [原框架说明 / Framework snapshot](FRAMEWORK-SNAPSHOT.md) | 本机材料编目、检查范围和已知缺失 / Inventory scope and known missing materials |
| [开发前源码审计 / Earlier source audit](SOURCE-AUDIT.md) | 历史缺口与路径索引，不是最新功能审计 / An earlier audit, not the current feature state |

## 分轮实现与证据 / Implementation stages and evidence

开发顺序为 P0 → D04 染色统计 → D07 IF 区域与归档 → D04-IF 独立单位统计。旧记录中的“尚未实现”只表示当时状态。测试项、数值检查项和不同轮次的分母不能相加为独立实验数。

The implementation order was P0, D04 stain statistics, D07 IF regions and archives, then D04-IF unit statistics. Statements about unfinished work belong to their recorded stage. Test counts and numeric checks from different stages must not be added together as independent experiments.

| 阶段 / Stage | 记录与摘要 / Records and summaries |
|---|---|
| P0：qPCR 单位、身份及病理结果有效性 | [实现](snapshots/p0/IMPLEMENTATION.md) · [qPCR 数值摘要](evidence/qpcr-numerics-summary.json) · [病理有效性记录](snapshots/p0/pathology-validation.md) · [源码身份](evidence/p0-source-state.json) |
| D04：IHC/H&E/Masson 单位层级 | [实现](snapshots/d04/IMPLEMENTATION.md) · [独立数值摘要](evidence/stain-d04-numerics-summary.json) · [原轮最终软件检查](checks/d04/results.json) |
| D07：IF 规范区域结果与项目复算 | [实现](snapshots/d07/IMPLEMENTATION.md) · [测量结果](snapshots/d07/MEASUREMENT-RESULTS.md) · [测量摘要](evidence/if-measurement-summary.json) · [原轮复核后检查](checks/d07/results.json) |
| D04-IF：专用系数与独立单位统计 | [实现](snapshots/d04-if/IMPLEMENTATION.md) · [IF 数值摘要 v2](evidence/if-statistics-summary.json) · [染色统计回归](evidence/stain-regression-summary.json) · [原轮复核后检查](checks/d04-if/results.json) · [最终源码身份](evidence/d04-if-source-state.json) |
| 材料完整性 | [最终清单摘要](evidence/inventory-summary.json) · [原轮一致性审计](evidence/final-consistency-audit.json) |

在最终原验证时点，D01/D02/D03/D04/D07 为 `implemented_software_validated`，D09 为 `partially_implemented`，另外六项为 `planned`。D04 已包含 IF 独立单位统计；D07 的“仅描述测量”是该轮验收范围，不表示后续 D04-IF 没有统计功能。配对/重复测量和原始多通道/高位深 IF 不在完成主张内。

At the final original checkpoint, five tasks were software validated, one partially implemented and six planned. D04 includes IF unit statistics. D07's descriptive-measurement scope must not be mistaken for the later D04-IF feature scope. Paired/repeated designs and original multichannel/high-bit-depth IF are outside the completion claim.

关键边界：

- 最新原验证软件检查为 288 单元测试、28 Chrome 用例；构建通过，lint exit 0 但有 9 条警告。这些不是当前移植 PR 的检查结果。
- IF 统计 v2 为 24 个场景、45 个声明的合成系数记录定义、2,767 项检查；它没有从新图像测得系数。
- IF 选区模式对不重叠 ROI 的系数取算术等权均值，再按视野、切片和单位汇总；不是合并像素系数，也不做 Fisher z。缺失值不补零、不重分配权重。
- D07 的 35 图测量回归属于既有开发语料。D04-IF 未重跑它，只核对了 8 个测量文件未改变。
- 52 个输入条目中 48 个存在，42 份证据存在，90 个哈希匹配；4 个缺失 WB 快照和 1 组重复合成图提示仍保留。`external_holdout=0`。
- 22 个挑战中 14 个只有软件回归、8 个未运行，所有真值仍待独立裁定。确认设计或配置一致不能证明来源独立、采集可比或科学结论有效。

Key limits: the 288 unit tests and 28 browser cases belong to the original working-tree validation. IF statistical checks use declared synthetic coefficients, not new images. ROI coefficients are averaged equally before field/section/unit aggregation, without pixel pooling or Fisher transformation. D04-IF did not rerun the 35-image D07 corpus. Four expected WB snapshots remain missing, one synthetic input group is duplicated, and external holdout remains zero. All challenge truth labels still require independent adjudication.

## 代码仓库与集成状态 / Code repositories and integration status

| 仓库 / Repository | 本入口与代码的关系 / Relationship |
|---|---|
| [blot-workbench](https://github.com/Gaoyuan-0423/blot-workbench) | 此 PR 仅公开验证文档；WB 应用代码未改变 / This PR only publishes evidence documentation |
| [pathology-workbench PR #6](https://github.com/Gaoyuan-0423/pathology-workbench/pull/6) | 病理与 IF 应用实现单独提交；按对应 PR 的代码与检查判断 / Application implementation and its own checks are separate |
| [pcr-workbench PR #12](https://github.com/Gaoyuan-0423/pcr-workbench/pull/12) | 移植到更晚主线的实现；原验证摘要不是最终集成证明 / Implementation ported to newer main; earlier evidence does not certify the integration |
| [wisplab-cli PR #34](https://github.com/Gaoyuan-0423/wisplab-cli/pull/34) | 桥接实现单独提交并重新验收 / Bridge implementation and integration validation are separate |

历史源码身份应同时看记录中的基线、未提交文件哈希及归档哈希，不能只引用基线 HEAD。这个公共入口不是发布或部署，也不是完整独立仓库快照。

Historical source identity combines the baseline, modified-file hashes and recorded archive hashes. A baseline HEAD alone does not identify the tested implementation. This public entry point is not a release, deployment or complete independent source archive.

## 导出与未分发内容 / Export and omitted materials

[export-map.json](export-map.json) 记录每个原件的相对位置、原件 SHA-256、公开副本 SHA-256 和变换方式。原件未改动；副本添加历史说明、替换作者本机路径，并将未分发的链接指向明确说明。源文件哈希是字节对应记录，不是签名或科学有效性证明。

[NOT-DISTRIBUTED.md](NOT-DISTRIBUTED.md) 列出不随此仓库分发的材料，包括原图、第三方厂商材料、源码 ZIP、二进制补丁、模型、截图、凭据、软著资料和完整逐例数值报告。文本中的 `local-only/...` 是解释性别名，不是可访问路径。这里保留检查日志及摘要，但不声称仅凭本目录就能复跑全部结果。

The export map records original and exported hashes and transformations. Original files are unchanged. Local filesystem paths are replaced by readable logical names. Images, vendor materials, source archives, binary patches, models, screenshots, credentials, software-copyright materials and complete per-case reports are not distributed. Logical aliases are not accessible paths, and this directory alone is not a complete reproducibility environment.
