# 演示数据与边界 / Demo boundaries

`0.1.0-alpha.1` 是产品流程演示。图像由程序构造；生成器按照固定默认 ROI 对合成像素求得示例数值，供界面作为预置 fixture 展示。**它不是任意输入图像的定量引擎：修改 ROI 或换图不会重新测量，也不构成真实科研图像的算法性能基准。**

## 数据构成

| 项目 | 含义 |
| --- | --- |
| 1 个项目 | 包含全部示例，项目不等同于日期目录 |
| 2 个批次 | 同一组样本的重复处理/成像场景，不新增实验单位 |
| 8 张图像 | 每批次目标与内参各 2 个曝光，共 2 × 2 × 2 张 |
| 6 个样本 | 每条泳道关联稳定样本 ID |
| 6 个实验单位 | 在批次和曝光之间重复使用，不能按图片或泳道行数增加 n |
| 预设质量场景 | 正常、弱带、不均匀背景、饱和；标签不是检测器输出 |

示例图像、项目包、清单和 CSV 位于 [`public/examples/`](../public/examples/)。项目包中的内容与清单应能相互对应。原始实验图像、用户提供的 HTML、竞品代码/界面素材均不属于该示例集。

这些合成内容随本项目按 MIT 许可证提供。它们不代表任何受试者、实验室、抗体性能或真实生物学效应。

## 演示结果的生命周期

预置数值只用于与预设匹配的演示配置。改变 ROI、内参配对或相关分析设置后，需要把相应结果标为失效；界面不能用“重新计算”掩盖没有真实定量实现的事实。

模板是起点；旧分析保存模板快照。更新模板不应更改既有区域和结果。明确重新应用模板时才产生新的分析修订，旧快照用于理解修改前状态。

确认、排除与备注体现人工检查状态。确认一张图并不能证明线性响应、定量有效或跨膜可比。

## 不能从示例得出的结论

- 不能估计真实 TIFF/PNG 的解码正确性或位深保真。
- 不能估计条带定位、背景扣除、饱和识别或定量的准确率。
- 不能检验跨曝光、跨膜、跨批次校正的有效性。
- 不能用显示的组差异计算科研结论、p 值或效应量。
- 不能把浏览器中能操作，等同于 Windows/macOS 所有浏览器均已通过。

下一步算法验证需要独立的合成真值数据、真实图像与明确的比较方法，见[验证计划](validation.md)。

## English summary

This release contains procedural synthetic images. The generator measures its fixed synthetic pixels with default ROIs to produce preset fixtures; editing ROIs does not run new measurements, and arbitrary input images are not supported. The example has 8 images across 2 batches, with target and reference images at 2 exposures, reusing the same 6 samples and 6 experimental units. Repeated lanes and exposures do not increase biological n. Quality labels are scenario annotations. The example is for workflow review, not validation of experimental-image quantification. ROI/pairing changes invalidate fixtures; template edits preserve older analysis snapshots.
