# 简易模式 TIFF 支持验证 / Simple-mode TIFF validation

日期 / Date: 2026-10-25。覆盖 `?mode=single` 与 `?mode=quick`；原有 `src/real` 解码和测量实现未修改。

## 支持范围 / Supported inputs

- 单页 8/16-bit 无符号整数 classic TIFF，扩展名 `.tif` / `.tiff`，最大 64 MiB、8,388,608 像素、单边 16,000 像素。BigTIFF、多页、扩展名与内容不符及解码器不支持的编码显式拒绝。
- TIFF 原始强度使用 Float64 数组保存，RGB 保留算术通道均值；8-bit 线性预览仅用于显示。检测投影按位深统一尺度，测量不使用预览的量化值。
- 原 PNG/JPEG 的 8-bit 浏览器解码行为和限制保留；旧项目仍可导入。TIFF 项目归档保存原文件、位深、Little-endian Float64 测量数组与取样/几何参数；旧软件不会接受新 TIFF 项目。

Single-page unsigned 8/16-bit TIFF retains original-depth measurement values. The display preview is separate. Existing 8-bit PNG/JPEG and legacy project imports remain supported. Unsupported TIFF variants fail explicitly. New TIFF archives require a TIFF-capable application version.

## 本地验证 / Local verification

| 检查 / Check | 结果 / Result |
| --- | --- |
| `npm run check` | 238 个单元测试全部通过（含 4 个非法 Float64 归档用例），TypeScript 与生产构建通过。 |
| `tests/e2e/single.spec.ts`, `quick.spec.ts`, `single-preparation.spec.ts` | 31 例通过；随后新增混合位深内参用例通过，共覆盖 32 例。 |
| TIFF 解码 | 独立生成的 8/16-bit 大端/小端、Deflate 灰度图；16-bit RGB 非整数通道均值；原字节保存；BigTIFF、多页、截断与扩展名错配拒绝。 |
| 数值精度 | 16-bit 相邻值差 1 在直接测量、90° 校直及裁剪后均保留；暗条带/亮条带均验证。 |
| 浏览器流程 | 两种简易模式导入 TIFF、CSV 精确值、目标/内参、8/16-bit 混合内参归一化、项目下载与刷新后恢复。 |
| 归档有效性 | 精确恢复 Float64 测量数组；NaN、Infinity、负数、超出位深上限的值在导入时拒绝。 |
| 既有 WB 独立参考 | 4 张既有图、21 泳道及 2 张 16-bit 合成图、12 泳道重新运行；原引擎净信号与独立参考的记录相对差均为 0。 |

本地参考输出保存在忽略目录 `.release/tiff-validation-20261025/`。厂商图片没有加入仓库；新增 `tests/fixtures/quick-tiff.ts` 仅生成合成像素。

These checks establish implementation behavior and exact synthetic arithmetic, not experimental-blot recognition accuracy, exposure linearity, or comparability across membranes. Automatic regions still require review. The reference regression covers the existing decoder/measurement engine; it does not establish real-image accuracy of every simple-mode geometric workflow.
