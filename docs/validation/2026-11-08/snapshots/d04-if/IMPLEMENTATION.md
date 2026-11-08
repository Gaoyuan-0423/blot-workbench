# D04-IF：IF 独立单位、选区汇总与统计

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `d04-if-implementation/IMPLEMENTATION.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

日期：2026-11-08。本轮接续 D07，把专用 IF 结果库接入明确的来源—视野—切片—实验单位层级。实现位于本地 `pathology-workbench`；未提交、推送或部署。D04 现覆盖已声明的独立组设计，配对/重复测量、原始通道/高位深及科学适用性不在完成主张内。

## 实现与估计目标

- `ifExperimentalDesign` 保存指标、整图/所选 ROI 模式、对照组、映射和确认状态；`ifSamples` 保留原始结果与排除标志。没有将 IF 伪装成染色记录，也没有使用历史 RoiMetrics 占位值。
- `ifSampleStatistics` 为界面、API、CSV、Excel、顾问和中英文 Methods 的共同入口。四个指标分别为全像素 Pearson、掩膜 Pearson、Manders M1/M2。
- 整图模式每视野取整图系数；ROI 模式必须显式选择同图内互不重叠的区域，对区域系数取算术等权均值，再去重视野、切片内视野等权、单位内切片等权。大小 ROI 等权；这是系数的层级均值，不是合并像素系数，也不做 Fisher z 变换。
- 同来源、同视野、实际区域几何、各选定系数及预处理相同的重复记录只计一次；改 ROI ID/显示名不会增 n。相同均值但选区或区域值不相同仍阻断。边界相接的半开 ROI 不算重叠。
- 所选区域缺值则整个视野和单位的当前指标为空，不补零或重分配权重。有效零值保留。nRecords、nImages、nRegions、nFields、nSections、nBio 分开记录。
- 来源/视野/单位跨组冲突、无效选区、不同配置、未知身份、未确认或暂不支持的设计不能取得推断资格。配置检查允许自动阈值的实际值随图不同；手动模式比较有效阈值。相同配置不证明采集条件、生物学独立性或科学适用性。
- 指标、选区、映射、分组、纳排或记录集合变化撤销确认。合法但冲突的归档设计保留并继续 invalid；旧项目不会凭空获得确认。
- 界面提供 IF 单位汇总和统计表、IF 单位 CSV；Excel 增加 IF 设计、视野/区域、切片、单位、分组描述及合格时的检验表。原始 IF CSV 仍保留区域数值。仅有历史 IF 记录而无当前图像时也能导出 Excel/Methods。
- 统计复用既有比较函数。两组 Welch/Mann–Whitney、多组 ANOVA/Dunnett 与 Kruskal–Wallis/Holm；检出多组异方差不计算普通 ANOVA/Dunnett。最少单位数只是软件门槛，不保证功效或近似分布适用。

应用使用说明和数值定义见 `pathology-workbench/docs/if-experimental-units.md`。

## 独立数值验证

固定参考先由 Python/NumPy/SciPy 独立计算，再调用 TypeScript 统计入口。输入为声明的合成系数，不是图像或生物学实验。参考脚本不导入应用算术。

| 项目 | 实际结果 |
|---|---|
| IF 固定场景 | 24 个场景，45 个固定记录定义；2,767/2,767 检查通过 |
| 手算锚点 | 13/13 通过 |
| 层级值最大绝对误差 | 5.551115123125783e-17；预定容差 1e-12 |
| Welch 数值最大绝对误差 | 8.881784197001252e-16；预定容差 1e-9 |
| ANOVA 数值最大绝对误差 | 0；预定容差 1e-9 |
| Mann–Whitney / Holm 最大绝对误差 | 分别约 1.152e-7 / 1.300e-7；预定容差 5e-7 |
| Dunnett 最大绝对误差 | 约 3.299e-5；预定容差 5e-4，五个固定种子 SciPy 积分均值 |
| 既有染色统计回归 | 4 个固定场景，205/205 检查通过 |

报告：[IF 完整数值记录](../../evidence/if-statistics-summary.json)、[既有染色统计记录](../../evidence/stain-regression-summary.json)。未将开发目标测试与完整套件分母相加，也未把检查项数当作实验数。

首版独立 fixture 的整图场景误带了 ROI 选择，应用正确拒绝，但参考未覆盖该规则；首次比较因此在缺少单位输出处终止。保留原 fixture、生成/比较脚本副本、首版 reference 和 `engine-development-probe.json`。修正后的 v2 明确清空正向整图案例的 ROI，并另加“整图带 ROI 必须拒绝”的负向场景，比较器也保留结构不匹配为失败记录。未放宽应用规则或数值容差。最终结论仅对应 v2 文件。

实际参考环境：Python 3.12.14、NumPy 2.5.4、SciPy 1.18.1；引擎 Node/源码 SHA-256 详见 JSON。临时 uv Python 路径可能在运行后消失，复跑命令不应直接使用该临时路径：

```sh
local-only/home/.local/bin/uv run --no-project \
  --python 'local-only/home/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python' \
  --with scipy==1.18.1 --with numpy==2.5.4 \
  python compare-if-statistics-scipy.py --output independent-if-statistics-rerun.json
```

运行器独占创建新输出。`--reference-only` 仅生成参考；默认 fixture 为 v2。保留旧结果，不覆盖。Dunnett 深尾部、极端分布、小样本近似的科学适用性不由本批案例确认。

## 软件与界面验证

完整运行器并行执行原仓库单元测试、构建、lint 和全套 Chrome 浏览器检查，保存日志和退出码，并在截图测试后按字节恢复 README 图片。

首轮 `software-checks-final/`：28 文件、288 单元测试及 28 浏览器测试全部通过。人工审阅截图后发现较长的缺附件列表挤占桌面工作区，因此改为可展开且有高度限制的滚动列表，保留所有缺失项与总数，并增加浏览器布局断言。最终结果另存 `software-checks-final-reviewed/`，不覆盖首轮记录。

开发定向检查还修正了两个具体问题：新 CSV 检查应断言实际展示的“掩膜 Pearson”标签，而非内部字段名；仅有保存 IF 记录时，旧导出入口条件未考虑 IF 库，已补齐。第二项是实际界面修复；不是降低测试要求。

最终检查表与源码快照核对结果见下文。截图均明确标记为合成系数或合成 RGB 数据；合成系数案例无原图附件，因此完整性列表如实报缺失，不视为原图可复算的证据。

## 版本与证据边界

分支 `codex/validation-p0-20261108`，基线 HEAD `bb9c45c0fc81fe7ea0c449d209e9d63e6eb66a2e`。HEAD 不代表未提交实现。`pre-d04-if-working-tree-source.zip` 与对应状态文件逐字节保留上一轮 D07 源码快照，来源哈希见 `baseline-provenance.json`。最终快照相对于 Git 基线保存累积改动，并区分本轮变化；不是完整独立仓库或签名发行包。

本轮只改变统计、类型、界面与报告/归档层，没有修改图像解码、去卷积、分割、阈值或共定位测量函数。独立报告核对这 8 个测量文件与 D07 完全一致；`types.ts` 因增加设计字段改变，统计层使用本轮新的源码摘要。未重新运行 35 图测量基准，也未将 D07 的完整源码哈希冒用为本轮状态。

原始材料复核见 `../inventory-audit-after-d04-if.json`：90 项哈希匹配、0 错误，保留 4 个已知缺失 WB 转换快照和 1 组重复合成输入提示。全部现有输入仍为 development_regression，external_holdout=0。本轮未增加真实 IF/IHC 数据、外部盲评或用户收益研究。

本轮支持的结论是：给定声明的设计和系数，软件按规定权重生成单位值并复算既有统计。它不证明实验单位真正独立、选区无偏、原始采集适用或生物学结论有效。


## 最终检查与快照

最终运行完成时间：2026-11-08T13:28:03.440210+00:00。见 [完整命令、退出码与日志索引](../../checks/d04-if/results.json)。

| 检查 | 最终实际结果 |
|---|---|
| 单元测试 | 28/28 文件，288/288 测试通过 |
| TypeScript + Vite 构建 | 通过；保留分块超过 500 kB 的提示 |
| 静态检查 | exit 0；9 条 React 编译器/Hook 相关警告 |
| Chrome 浏览器全套 | 28/28 通过，单 worker，约 78 秒 |
| diff 空白/冲突检查 | `git diff --check` 通过 |
| README 图片保护 | 两张原有图片测试后按字节恢复，哈希一致 |
| 源码快照 | 65 个累积文件条目，其中本轮改变 30 个；归档、清单、当前文件和二进制补丁一致 |
| 数值源码一致性 | IF 和既有染色对照的统计源码哈希均匹配；8 个图像测量文件及包清单相对 D07 未改变 |

最终桌面截图人工复核确认完整性提示不再挤占工作区，nBio 列可见；英文 390 px 截图确认无页面横向溢出。横向较宽的统计表保留内部滚动，不删除字段。本轮未运行加载/吞吐性能基准。

最终源码归档 SHA-256：`6c07add68e0f7c54581ed62868de8130ee1f2c16d1a18892b5a26548a5064637`。机器可读一致性检查见 [final-consistency-audit.json](../../evidence/final-consistency-audit.json)。D04 已更新为 implemented_software_validated；待办表共 5 项软件实现验证、1 项部分实现、6 项计划中。挑战清单 14 项 software_regression_only、8 项 not_run，所有真值状态仍为 proposed_not_adjudicated。
