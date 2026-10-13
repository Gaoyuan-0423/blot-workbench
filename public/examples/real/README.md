# SYNTHETIC 原始像素验证示例 / SYNTHETIC original-pixel validation

此处全部图像由项目自己的脚本原创生成，不含任何实验室或用户数据。它们检验真实工作区的像素读取、背景扣除、配对与归一化实现，**不是生物学实验结果，也不证明真实图像定位或科研定量已验证**。这与旧合成演示直接返回预设数值不同：真实工作区从这些 PNG 的原始像素计算；移动区域会改变测量结果。

Every image here is generated from scratch by this project's own script. No laboratory or user images are included. This example exercises original-pixel decoding, background subtraction, pairing, and normalization. **It contains no biological results and does not validate localization or quantitative reliability on real experimental images.** Unlike the older fixture demo, this workspace measures PNG pixels; moving a region changes the measurement.

## 文件 / Files

- [example.realwb.zip](example.realwb.zip): 原图、初始区域、来源备注和历史；在真实工作区“打开项目”导入。 / Originals, initial regions, provenance notes, and history; import with Open project in the real workspace.
- [expected-results.csv](expected-results.csv): 当前初始项目的计算输出，明确标为 DRAFT。 / Calculated output for the initial project, explicitly marked DRAFT.
- [expected-values.json](expected-values.json): 独立规定的解析真值及区域坐标。 / Independently specified analytical values and region coordinates.
- [originals/](originals/): 六张原创灰度 PNG；每对具有相同位深，第二对为 16 位，其余为 8 位。 / Six original grayscale PNGs; the second pair is 16-bit, the other pairs are 8-bit.

## 预期结果 / Expected values

三组模拟配对图，每组包含目标和内参两张图、NC 与 Treatment 两个泳道。条带区域均为 80 × 20 = 1600 像素；背景区域同面积。整图 320 × 140 像素。所有区域位置详见 JSON；文件无截断或噪声，刻意不代表现实图像难度。

There are three simulated image pairs, each with target/reference images and NC/Treatment lanes. Each band and background region has 1600 pixels (80 × 20); each image is 320 × 140 pixels. See JSON for all coordinates. The images have no clipping or noise and deliberately do not represent real-image difficulty.

| 模拟组 / Simulated set | 位深 / Bit depth | 目标暗信号 NC, Treatment / Target dark differences | 内参暗信号 / Reference differences | Treatment fold |
| --- | --- | --- | --- | --- |
| 1 | 8 | 40, 20 | 20, 20 | 0.5 |
| 2 | 16 | 80 × 257, 60 × 257 | 20 × 257, 20 × 257 | 0.75 |
| 3 | 8 | 60, 60 | 20, 20 | 1 |

暗条带净信号 = 条带面积 × 背景均值 − 条带像素积分。先在每组内部计算目标/内参，再除以该组 NC 的目标/内参比值。Treatment 的 fold 为 [0.5, 0.75, 1]；均值 0.75，样本 SD 0.25。NC 的归一化值按定义为 1；这不表示真实生物对照没有变异。

For dark bands, net = band area × background mean − band pixel sum. Within each set, divide target by reference, then divide by the NC ratio from that same set. Treatment folds are [0.5, 0.75, 1], with mean 0.75 and sample SD 0.25. NC is 1 by construction; this does not imply absence of biological variation in real controls.

模拟数据不具有生物独立性，初始项目保留 designConfirmed=false，n 只称“配对组”。各图从未复核状态开始，输出保持 DRAFT。可以检查并移动区域、复核图像、保存和恢复；请勿为了消除 DRAFT 将模拟组勾选成生物独立实验。此示例不计算 p 值。

These generated sets have no biological independence. designConfirmed remains false and n denotes paired sets. Images start unreviewed and output stays DRAFT. Inspect or move regions, review images, save, and restore the project. Do not declare biological independence merely to remove DRAFT. No p value is calculated.

## 重建 / Reproduce

在仓库根目录执行 / From the repository root:

```sh
npm exec -- tsx scripts/generate-real-example.ts
```

脚本只生成上述公开文件，不读取私有文件。导出前将实际像素计算结果与独立规定的解析真值比较；不匹配时停止。固定日期只是可重建的示例元数据，不是实验日期。

The script only writes these public assets and never reads private files. Before export it checks calculated pixels against the independent analytical specification and stops on mismatch. The fixed date is reproducible example metadata, not an experimental date.
