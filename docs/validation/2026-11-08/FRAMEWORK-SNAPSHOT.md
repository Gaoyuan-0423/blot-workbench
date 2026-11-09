# WispLab 验证准备包

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `README.md`; 原件与导出件 SHA-256 见 [export-map.json](export-map.json). 未分发材料见 [说明 / omissions](NOT-DISTRIBUTED.md).

2026-11-08：现有数据编目、完整性检查、研究方案与开发验收清单。用户当前没有新的独立原始数据。本目录为新增准备材料，正式提交稿及历史验证结果保留原位。

研究方案先看 `PLAN.md`；最新开发结果先看 [D04-IF 独立单位统计实现记录](snapshots/d04-if/IMPLEMENTATION.md)，前轮结果见 [D07 IF 区域与归档记录](snapshots/d07/IMPLEMENTATION.md)、 [D04 实验单位记录](snapshots/d04/IMPLEMENTATION.md) 和 [P0 实现记录](snapshots/p0/IMPLEMENTATION.md)。`SOURCE-AUDIT.md` 和各轮记录保留当时的源码与执行快照，行号及缺口描述不代表后续修改后的状态。

现有数据清单：52 个输入条目中，48 个现存文件均与历史记录哈希一致；4 个历史转换后 WB TIFF 快照在指定保存位置缺失。42 份证据文件均存在，已建立本次编目哈希。检查报告为 0 errors、5 warnings（4 个缺失快照及 1 组重复合成图）；历次结果分别保存，不覆盖。两张合成 WB TIFF 属于同一个设计。以上是文件条目计数，不是独立实验数。

现有全部输入保留为 development_regression，独立外部留出为 0。12 项增量开发中，D01/D02/D03/D04/D07 已实现并通过软件回归；D04 现覆盖 IHC/H&E/Masson 整图与 IF 专用系数的独立单位层级，D09 仍部分实现，另外 6 项仍为 planned。C01–C04、C09、C12、C15–C22 共 14 个案例有对应软件回归记录（software_regression_only），其他 8 个仍为 not_run；所有案例真值标签尚待独立裁定。3 个记录模板只有表头。检查器的临时故障测试覆盖篡改、缺失、开发暴露、相同字节或已知来源跨分区及报告拒绝覆盖；这些软件检查不计入应用科学验证。

| 文件 | 用途 |
|---|---|
| `PLAN.md` | 研究主问题、阶段、对照、终点、重复单位、未来用户研究与判断边界 |
| `catalog.json` / `inventory.csv` | 现有输入及证据位置、哈希、角色和已知开发暴露；CSV 方便查看 |
| `check_framework.py` | 只读检查输入/证据文件的存在性、字节哈希和已知数据分区冲突 |
| `inventory-audit-final.json` | 本次最终清单检查结果；不代表应用或科学验证结果；初版检查另存于 `inventory-audit.json` |
| `inventory-audit-after-d04.json` / `inventory-audit-after-d07.json` / `inventory-audit-after-d04-if.json` | 各轮开发后的原始材料复核：均为 90 个哈希匹配、0 errors、5 个既有 warnings |
| `development-backlog.csv` | 按优先级列出的增量开发与验收要求；状态随实际执行更新 |
| `challenge-cases.csv` | 故障、合法变化和无故障对照设计；软件回归与独立裁定分开登记 |
| `p0-implementation/` | 本轮实现、执行结果、独立 SciPy 对照和源码哈希 |
| `d04-implementation/` | 病理单位层级、视野去重、切片等权汇总、独立 SciPy 对照及本轮源码状态；不替代前轮报告 |
| `d07-implementation/` | IF 规范区域结果、专用记录/项目复算、35 图回归、独立 Python 固定数组对照及完整软件检查 |
| `templates/experimental-units.csv` | 原始来源、实验单位与技术测量关系；空模板 |
| `templates/task-register.csv` | 未来任务材料、分区、对照、容差和裁定规则；空模板 |
| `templates/evaluation-log.csv` | 每次任务执行的结局、时间、版本和证据；空模板 |
| `TEMPLATE-GUIDE.md` | 字段含义与填写规则 |

在任意目录执行现有清单核对（仅使用 Python 标准库）：

```sh
python3 'validation-evidence/check_framework.py'
```

需要保存新报告时传 `--output` 和新的文件名，已有报告不覆盖：

```sh
python3 'validation-evidence/check_framework.py' --output 'validation-evidence/inventory-audit-next.json'
```

`catalog.json` 引用本机绝对路径，因此它是本机准备清单。迁移机器时需显式映射根目录并保留原有预期哈希；不能自动以新文件哈希覆盖基线。源数据仍在原位，本目录不包含其完整快照或可直接移交的全部复现环境。

输入 `hash_basis` 指向历史 manifest/run report 时，匹配说明当前字节与历史记录一致。证据文件的 `inventory_snapshot_2026-11-08` 哈希只说明从本次编目起可检查变化，不证明文件历史上未被修改。清单本身没有签名；整体重写清单可绕过这类检查，不声称防篡改证明。

`expected_present=false` 的有效输入快照缺失项是显式缺口，不属于“通过复现”；检查器以 warning 列出。任何本应存在的文件丢失、哈希不符或已知开发输入被标成外部留出均报 error。重复字节只提示内容重复，不能发现所有裁剪/缩放同源泄漏，也不能推断不同字节代表独立生物来源。

检查器同时拒绝已知 `source_cluster` 跨开发/外部留出分区，即使文件字节不同；`unknown` 不参与来源推断。仅支持 `development_regression` 和 `external_holdout` 两个分区值，避免拼写错误绕过检查。新数据进入 external_holdout 需要明确未暴露声明及真实来源依据，清单检查不能替代来源核实。

应用数值复跑继续使用原有 `manuscript/reproducibility/REPRODUCIBILITY.md` 和其脚本。清单检查本身不会重新计算 WB、IF、IHC 或 qPCR 指标；新增代码检查与构造数据数值复跑按轮次分别记在 `p0-implementation/`、`d04-implementation/` 、`d07-implementation/` 和 `d04-if-implementation/`。D07 使用新旁路运行器读取历史输入，在新目录保存结果，未覆盖旧基准。
