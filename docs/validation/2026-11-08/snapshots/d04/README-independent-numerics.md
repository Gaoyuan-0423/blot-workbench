# D04 病理实验单位：独立数值对照

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `d04-implementation/README-independent-numerics.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

这是固定合成元数据和视野指标的软件验证，没有真实图像像素，没有调用图像测量引擎，不构成外部生物学验证。205 项是软件断言，不是独立样本数量。`source_id` 是明确标注的合成来源标签，不是实际原图的哈希。

**最终实际结果：4 个场景，205/205 项检查通过。** 最终报告为 `independent-pathology-numerics-2026-11-08-final.json`，在补充 `metrics.roiId !== null` 时阻止整图单位推断的范围检查后重新运行。此前 `independent-pathology-numerics-2026-11-08.json` 原样留存，代表补充该检查前的源码状态，不能代替最终版本的摘要记录。两次使用相同的四个整图合成场景，数值检查结果一致；新增 ROI 拒绝边界另有核心单元测试。

| 场景 | 原始视野记录 | 组级有效 n | 验证内容 |
|---|---:|---:|---|
| 平衡两组 | 每组 15，共 30 | 每组 3 | 每单位 5 视野先汇总，Welch 输入为单位值 |
| 平衡三组 | 每组 15，共 45 | 每组 3 | 对照纳入 ANOVA，Dunnett raw p 使用相同合并方差和自由度 |
| 不均衡切片 | 共 7 | 每组 2 | 单位 C1：切片 1 为 `[10,20,30]`，切片 2 为 `[90]`，单位值为 `(20+90)/2=55`，不是视野直接均值 `37.5` |
| 复制视野 | 共 8，唯一视野仍为 7 | 每组仍为 2 | 复制同来源/单位/切片/视野不增加权重或 n，单位值与 Welch p 不变 |

平衡场景的单位值为 Control `[60,70,90]`、Treatment `[30,40,50]`、Treatment2 `[20,30,40]`。Python 参考从固定原始视野值独立去重并计算切片均值、单位均值与组汇总，没有导入应用代码。切片、单位和组级描述数值的预定绝对容差为 `1e-10`，本批实际最大误差为 0。

| 统计量 | 当前引擎 | SciPy 参考 | 绝对误差 |
|---|---:|---:|---:|
| 平衡两组 Welch p | 0.04191451747145414 | 0.04191451747145410 | 3.47×10⁻¹⁷ |
| 三组 ANOVA p | 0.010518015685796134 | 0.010518015685796110 | 2.43×10⁻¹⁷ |
| 不均衡切片 Welch p | 0.019419324309079890 | 0.019419324309079843 | 4.51×10⁻¹⁷ |
| Treatment 的 Dunnett raw p | 0.014552611854980801 | 0.014552611854980878 | 7.63×10⁻¹⁷ |
| Treatment2 的 Dunnett raw p | 0.004490816635907224 | 0.004490816635907124 | 1.01×10⁻¹⁶ |
| Treatment 的 Dunnett adjusted p | 0.025635397191496100 | 0.025706472448554440 | 7.11×10⁻⁵ |
| Treatment2 的 Dunnett adjusted p | 0.007990253587635499 | 0.008077042837422454 | 8.68×10⁻⁵ |

Welch、ANOVA、Brown–Forsythe 及 Dunnett raw p 的预定绝对容差为 `1e-9`。三组 ANOVA F 为应用 `10.69230769230769`、SciPy `10.692307692307693`，自由度 2/6；Brown–Forsythe p 双方均为 `0.823974609375`，因此这个固定场景不会触发已检出异方差时的普通 ANOVA 禁用边界。

Dunnett adjusted p 的参考是 SciPy 五个固定种子 `20261108`–`20261112` 的随机积分均值，预定绝对容差 `5e-4`。完整结果记录了每次估计及范围。本次仅说明中等 p 值场景在该容差内一致，不声称确定性逐位相等，也没有验证极深尾部精度。

## 文件和复跑

- `independent-pathology-fixture.json`：固定视野指标、来源身份、单位/切片/视野映射及四个场景。
- `run-pathology-engine.mts`：调用当前应用的 `aggregateExperimentalUnits` 和 `compareGroups`，不调用图像测量代码。
- `compare-pathology-scipy.py`：独立 NumPy 汇总及 SciPy 数值参考。
- `independent-pathology-numerics-2026-11-08-final.json`：最终完整报告，包含检查、参考值、引擎输出、容差、版本、命令、当前源码 SHA-256 和 Git 状态。
- `independent-pathology-numerics-2026-11-08.json`：保留的前一版运行报告。
- `core-i18n-keys.json`：本轮核心新增文案的 42 条静态译文建议及 2 条模板，供界面对接；它不是数值验证的一部分。

本次实际环境为 Python 3.12.14、NumPy 2.5.4、SciPy 1.18.1、Node v22.22.0、tsx 4.23.15。命令使用已有 qPCR 仓库的 tsx 作为 TypeScript 启动器，实际被测模块来自 pathology-workbench。

```sh
local-only/home/.local/bin/uv run --no-project \
  --python 'local-only/home/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python' \
  --with scipy==1.18.1 --with numpy==2.5.4 \
  python 'validation-evidence/d04-implementation/compare-pathology-scipy.py' \
  --output 'validation-evidence/d04-implementation/independent-pathology-numerics-rerun.json'
```

可用 `--engine`、`--tsx` 和 `--fixture` 指定其他位置。省略 `--output` 时 JSON 写入标准输出，指定输出时独占创建、不覆盖既有报告；比较失败退出 1。依赖或执行错误、运行期间源码变动均会终止。

报告针对运行时记录摘要的当前工作树，不自动覆盖后续源码修订。此验证不确认用户对生物学独立性的声明，不评价真实图像的测量准确性，也不覆盖 GUI 行为；已有原始数据和 P0 历史报告未改动。
