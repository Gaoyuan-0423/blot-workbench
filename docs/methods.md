# 方法与解释范围

真实图像 `0.3.0-dev.2` 的实际像素方法和边界见[中文指南](real-images.md) / [English](real-images.en.md) 与[验证](validation-real-images.md)。开发版支持匹配对照或共同基准，明确个体 N/T 配对与可选双侧配对 t 检验见[统计方法](paired-statistics.md)。本页下方仍描述旧合成示例，不能将示例 fixture 当作真实项目的当前计算结果。 / The development version supports matched-control or common-baseline scaling; see [statistical methods](paired-statistics.md) for explicit N/T units and opt-in paired inference. The legacy formulas below describe synthetic fixtures, not current real-project computations.

版本：`0.1.0-alpha.1`。本页区分演示中的数学说明、当前实现与后续研究要求。

## 当前的数值展示

合成图生成器生成 8-bit 灰度 PNG，以 `signal = 255 - gray` 表示本示例的暗带信号，并在固定默认条带/背景矩形中生成下列数值。界面仅展示这些 fixture，不提供任意图像或编辑后 ROI 的重新测量：

1. 默认条带区域内信号之和：`bandSum`。
2. 条带区域面积：`area`，以像素数表示。
3. 默认背景区域内信号均值：`backgroundMean`。
4. 扣背景净信号：`net = bandSum - area × backgroundMean`。
5. 内参归一化示意：`ratio = targetNet / referenceNet`。
6. 相对值：`relative = ratio / mean(ratio of S1, S2, S3)`；在每个目标/内参图对内，以三个演示对照样本的比值均值为基准。

默认条带与背景矩形各为 72 × 36 像素。目标与内参 fixture 按同一批次、同一膜和同一曝光配对；这只是示例的规则，不是通用实验配对算法。上式说明需要保存 ROI、背景方法、配对和归一化基准，不证明该背景选取对真实图像均适用，也不建立跨曝光或跨批次的可比性。

`getFixtures()` 根据它自己构造的像素生成固定值，`presetMeasurements()` 提供对应比值。当前没有从用户文件解码再测量的管线；ROI、样本设计或配对不匹配时，旧 fixture 不能继续充当当前结果。

真实引擎将需要定义信号极性、像素数据类型、背景模型、边界取整、缺失值及非正内参的处理。不能在未说明的情况下截断负净值、取绝对值，或用一个很小的常数绕过零分母。

## 显示与计算的分离

后续真实定量应读原始像素数组；对比度、亮度、伪彩和显示缩放仅作用于预览。原图必须保留且不能覆盖。任何改变像素的计算步骤都应有显式方法、参数与版本，而不是隐藏在显示按钮后。

本演示并未实现或验证真实高位深图像管线。支持文件扩展名，不等于保留了其有效位深、通道或线性信息。

## 配对、重复与跨图比较

目标和内参需要关联同一实验样本及相应膜/检测上下文。泳道位置只是图像位置。重复拍摄、多个曝光和重复上样属于同一实验单位下的多次测量，不能自动作为独立生物学重复。

跨曝光的信号通常不能仅除以曝光时间就认为可比；跨膜或批次也不能靠分组名称自动合并。后续必须要求合适的共同参考、未饱和的工作范围和可验证的比较设计，保存采用的校正过程。用户需决定实验单位、技术重复的汇总方式与统计模型。首版演示不做推断统计。

## 相关工作

下面是官方文档/论文层面的参考，不是本项目实测排名。通用流程可以研究，代码复用和资源再分发则需要另行核对许可证。

- [ImageJ 官方 Analyze 手册](https://imagej.net/ij/docs/guide/146-30.html)：定义 ROI 测量、原始积分密度与泳道分析等。后续比较应固定 ROI、背景和转换设置。
- [IOCBIO Gel 原始论文](https://doi.org/10.1186/s12915-023-01734-8)：已有项目、样本、图像及分析步骤关联与可追溯工作流。项目保存和可复现性并非本项目独有创新。
- [GelBox 官方文档](https://campbell-muscle-lab.github.io/GelBox/)：已有背景校正、条带拟合及整合原始数据与分析信息的保存设计。方法不同的工具不应被要求输出机械相同的结果。

潜在研究问题是：在定量可靠性得到验证的前提下，能否减少多图任务的操作与错误，并改善间隔后的重新上手。是否具备论文贡献，取决于数据、比较设计与实际结果。

## English summary

The fixture generator measures its own 8-bit synthetic pixels using `signal = 255 - gray` and fixed 72 × 36 pixel band/background ROIs. The UI displays those fixed measurements; edits do not run fresh integration. Targets are paired with the same-batch/membrane/exposure reference, then divided by the mean ratio of the three demo controls S1–S3. This does not establish cross-exposure or cross-batch comparability. A future engine must preserve raw data, separate display from measurement, and track methods and experimental units. Existing tools provide method and workflow precedents; project saving is not claimed as a unique invention.
