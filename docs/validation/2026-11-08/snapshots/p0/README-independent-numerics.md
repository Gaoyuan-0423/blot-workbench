# qPCR P0：独立数值对照

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `p0-implementation/README-independent-numerics.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

本目录的固定合成数据用来检查当前 qPCR 引擎的软件计算。它不是外部真实数据验证，不是生物学重复实验，也不证明用户的科学结论。这里的 306 项是数值与边界断言，不是 306 个独立样本。

## 文件与方法

- `independent-qpcr-fixture.json`：固定 Cq 数组、原始板/样本身份、明确的单位映射与三个合成场景。对照组单位 C1/C2/C3 分别有 3/2/5 个目标技术孔；C3 的目标与内参测量分布在两块板，仍明确映射为同一单位。
- `run-pcr-engine.mts`：直接导入指定工作目录中的当前 `src/core/analysis.ts`，生成孔级输入并执行引擎，不修改应用源码。
- `compare-qpcr-scipy.py`：独立从固定 Cq 数组计算单位内各基因均值、多个内参的等权均值、每单位 ΔCt、等权对照基线、ΔΔCt 和 FC。统计分别调用 SciPy `ttest_ind(equal_var=False)`、`f_oneway` 和 `dunnett`。Python 参考计算不导入应用实现。
- `independent-qpcr-numerics-2026-11-08.json`：实际运行报告，包含全部检查值、容差、引擎输出、参考计算、软件版本、命令、源码 SHA-256 与运行时 Git 状态。

三个场景为：两个独立组；包含对照的三个独立组；复制 C1 的全部技术测量后重新计算两个独立组。原始单位 ΔCt 为 Control `[4,5,7]`、Treatment `[1,2,3]`、Treatment2 `[0,1,2]`（浮点运算存在约机器精度的表示差异）。第三个场景检查复制技术孔是否改变生物学样本量或单位权重。

## 本次实际结果

2026-11-08 运行完成，3 个合成场景、306/306 项检查通过。

| 检查 | 当前引擎 | 独立参考 | 绝对误差 | 预先设定的绝对容差 |
|---|---:|---:|---:|---:|
| 两组 Welch p | 0.04191451747145414 | 0.04191451747145410 | 3.47×10⁻¹⁷ | 1×10⁻⁹ |
| 含对照的三组 ANOVA p | 0.010518015685796134 | 0.010518015685796127 | 6.94×10⁻¹⁸ | 1×10⁻⁹ |
| Treatment vs Control Dunnett p | 0.02565875282681297 | 0.02570647244855444 | 4.77×10⁻⁵ | 5×10⁻⁴ |
| Treatment2 vs Control Dunnett p | 0.008023978341160433 | 0.008077042837422454 | 5.31×10⁻⁵ | 5×10⁻⁴ |

SciPy Welch 统计量为 −3.162277660168378，自由度为 3.448275862068965。ANOVA F 为 10.692307692307686，自由度为 2/6；对照明确包含在总体检验及组内方差中。应用结构化输出只暴露 p 值，以上未把应用显示字符串中四舍五入的 t/F 当作全精度统计量比较。

单位聚合、ΔCt/ΔΔCt/FC 与组级汇总采用绝对容差 `1e-10`，这批比较的最大实际误差为 0。对照等权 ΔCt 为 **5.333333333333332**；按目标孔数错误加权会得到 **5.7**。复制 C1 的技术测量后，对照技术孔数由 **10 增至 13**，生物学单位数仍为 **3**；等权对照基线与 Welch p 均保持不变。每个样本级结果的 p 值为空。

Dunnett 参考采用 SciPy 随机数值积分，固定种子为 `20261108` 至 `20261112`，表中参考为五次 p 估计的均值。Treatment 的五次估计范围为 `[0.025517502212178522, 0.025817982360041514]`，Treatment2 为 `[0.007933090433417722, 0.008303296248251213]`。这个对照仅支持给定中等 p 值场景在声明容差内一致，不应表述为确定性逐位一致，也没有新增极深尾部精度证据。

## 复跑

本次实际使用 Python 3.12.14、NumPy 2.5.4、SciPy 1.18.1、Node v22.22.0、tsx 4.23.15；版本由实际执行进程记录，源码摘要也在 JSON 中。通过独立的 uv 依赖环境运行，没有安装或修改应用依赖，也没有更改历史参考脚本。

在已安装 NumPy/SciPy 的 Python 环境中：

```sh
python compare-qpcr-scipy.py \
  --engine 'pcr-workbench' \
  --output independent-qpcr-numerics-rerun.json
```

本机复现本次依赖版本的完整命令（在任意目录执行）：

```sh
local-only/home/.local/bin/uv run --no-project \
  --python 'local-only/home/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python' \
  --with scipy==1.18.1 --with numpy==2.5.4 \
  python 'validation-evidence/p0-implementation/compare-qpcr-scipy.py' \
  --output 'validation-evidence/p0-implementation/independent-qpcr-numerics-rerun.json'
```

不指定 `--output` 时 JSON 写入标准输出；指定路径时采用独占创建，已有报告不会覆盖。所有检查通过退出 0，比较失败退出 1。依赖缺失、引擎执行失败或运行期间引擎源码发生变化会终止，不能当作通过。

复跑时应检查报告中的源码摘要：报告针对带有未提交 P0 修改的当前工作树，不是仅针对 Git HEAD。后续修改源码需要生成另一个报告，不能把本报告直接归属于后续版本。
