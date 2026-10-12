# 配对设计与统计 / Paired design and statistics

适用 / Scope: `0.3.0-dev.2` 开发工作区 `#real`；不描述已发布 `0.1.0-alpha.1` 的模拟数值。 / Development workspace only; this does not change the released alpha's fixture behavior.

## 实验单位与纳入 / Units and inclusion

共享布局按独立实验编号配对。N/T 模式显式保存来源图组、个体编号、N 泳道和 T 泳道；来源图组用于找到对应图像，个体编号用于定义配对单位。不同图组中的同一个体应复用编号。多次曝光、重复上样和同一个体的多次测量不能增加 n；当前不会自动平均技术重复。配对歧义或不完整时，该单位同时从两组汇总排除，并保留提示。

Shared layouts pair by independent experiment ID. Explicit N/T designs record a source group, individual ID, N lane, and T lane. Source groups locate images; individual IDs define paired units and must be reused for repeated measurements across groups. Repeat exposures, loading, or measurements do not increase n. Technical replicates are not automatically averaged. Ambiguous or incomplete units are omitted from both group summaries with a warning.

## 数值尺度与图形 / Scale and figures

每个泳道先得到扣背景净信号，再得到 `ratio = targetNet / referenceNet`。匹配对照模式按单位除以自己的对照 ratio，因此各对照均为 1。共同基准模式则选择一个单位的对照 ratio，为同蛋白的所有 ratio 提供相同分母；其他对照保留计算差异。基准单位与来源保存在结果中。新建项目默认使用共同基准模式，以第一个可用对照为基准；可在工作区更改基准或切换回匹配对照，旧存档行为不变。

Each lane yields a background-corrected net signal and `ratio = targetNet / referenceNet`. Matched-control mode divides each unit by its own control ratio, so every control is 1. Common-baseline mode uses one selected unit's control ratio as the denominator for every ratio of the same protein, preserving differences between other controls. Results retain the baseline unit and source. New projects start in common-baseline mode with the first available control as the baseline; switch modes or baselines in the workspace, while archives created earlier keep their behavior.

共同基准不能恢复截断信号、校准膜/曝光差异，或证明不同批次可比；选一个基准并不等于解决批次效应。默认图形是柱图叠加单位点与均值 ± 样本 SD，可切换配对连线图。SD 描述实际纳入单位的离散程度；不是 SEM，也不是 95% CI。

A common baseline cannot recover clipped signal, calibrate membranes/exposures, or establish comparability across batches. Choosing a baseline does not remove batch effects. Default figures combine bars, unit-level points, and mean ± sample SD, with an optional paired-line view. SD describes included-unit variation; it is neither SEM nor a 95% CI.

## 可选检验 / Optional test

默认 `statisticalTest = none`。只有用户明确选择、确认独立性与配对设计、恰好两个条件且存在足够完整有效配对时，才提供双侧配对 t 检验。对每个蛋白分别计算：

Testing defaults to `statisticalTest = none`. A two-sided paired t-test requires explicit selection, confirmed independence and pairing, exactly two conditions, and enough complete valid pairs. Calculations are separate for each protein:

```text
d_i = ratio_treatment,i − ratio_control,i   (N/T: T − N)
t = mean(d) / (sampleSD(d) / sqrt(n))
df = n − 1
```

输入是归一化绘图前的 **目标/内参 ratio**；对同一组有效配对，改变绘图基准不改变检验输入或 P 值。输出包括实际纳入 n、单位编号、t、df、双侧未校正 P 值、均值差及其 95% CI。均值差和 CI 的单位是目标/内参比值，不是图中相对基准的倍数。缺少足够配对、重复编号、无效数值或零差值方差时，显示不可计算，不制造 P=0 或 P=1。

Inputs are **target/reference ratios before plot scaling**. For the same eligible pairs, changing a valid figure baseline changes neither test inputs nor P. Outputs include actual n, included IDs, t, df, the two-sided unadjusted P-value, mean difference, and its 95% CI. The difference and CI use target/reference-ratio units, not plotted fold units. Insufficient pairs, duplicate IDs, invalid values, or zero variance of differences produce an unavailable result, not a fabricated P=0 or P=1.

公式、双侧含义、df 和差值 CI 可与 [SciPy `ttest_rel` 官方说明](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html)核对。这是方法参照；本应用用 `jstat@1.9.6` 的 Student-t 分布函数计算，不调用 SciPy，方法链接本身不构成数值对照验证。

The formula, two-sided definition, df, and difference CI can be checked against the [official SciPy `ttest_rel` documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html). This is a methodological reference: the app uses Student-t distribution functions from `jstat@1.9.6`, not SciPy. Linking a method is not evidence that a numerical comparison has passed.

## 假设与质量状态 / Assumptions and quality state

配对差值应符合所采用 t 检验的近似正态假设，配对单位之间应独立，配对关系来自实验设计。不能把技术重复当成新的独立个体。小样本特别是 n=3 时很难评估差值分布；软件不能从图像或组名验证这些假设。[GraphPad 配对 t 检验核查表](https://www.graphpad.com/guides/prism/latest/statistics/stat_checklist_pairedt.htm)

The t-test assumes approximately normal paired differences and independence between paired units. Pairing belongs to the experimental design; technical replicates are not new individuals. Small samples, especially n=3, make the difference distribution difficult to assess. Images and group names cannot verify these assumptions. [GraphPad paired-test checklist](https://www.graphpad.com/guides/prism/latest/statistics/stat_checklist_pairedt.htm)

**跨膜、跨曝光或批次的可比性限制同时适用于两种绘图归一化。** 配对 t 检验始终使用原始目标/内参比值；改成“各自对照 = 1”的图形不能消除这些输入之间的尺度差异。跨采集条件汇总时，应独立验证可比性并保留检验质量提示，不能通过切换显示模式移除风险。

**Cross-membrane, exposure, and batch comparability limits apply under both plot-normalization modes.** Paired tests always use original target/reference ratios; a figure with each matched control equal to 1 cannot remove scale differences between test inputs. Pooling acquisition contexts requires separate comparability evidence and retained inference warnings, regardless of display mode.

DRAFT 或像素质量警告不会一律阻止探索性检验，但警告必须随结果保留；无效信号、无内参或配对歧义等阻断输入不纳入。一个可计算 P 值既不能消除这些质量限制，也不能证明仪器线性或研究结论。多个蛋白分别给出的 P 值未经多重比较校正，不可当作已控制整体错误率；当前也不提供 ANOVA、非参数检验或技术重复层级模型。

DRAFT and pixel-quality warnings do not universally prevent exploratory testing, but warnings remain attached to results. Blocked inputs, such as invalid signals, missing references, or ambiguous pairs, are excluded. A computable P-value resolves neither these limitations nor instrument linearity. P-values across proteins are unadjusted; they do not control the overall error rate. ANOVA, nonparametric tests, and hierarchical technical-replicate models are not provided.

不要为了获得较小 P 值改选 ROI、排除个体、切换基准或检验。应依据实验设计和预先明确的分析问题选择方法，并保留实际修改记录。

Do not select ROIs, exclusions, baselines, or tests to obtain a smaller P-value. Choose methods from the experimental design and a stated analysis question, retaining the actual edit history.

数值及界面验证以[版本验证记录](validation-real-images.md)为准；科研有效性、独立实验室评价和固定 ImageJ 对照仍需补充。 / Consult the [version-specific validation record](validation-real-images.md) for executed checks; scientific validity, independent-laboratory assessment, and a fixed ImageJ comparison remain outstanding.
