# 真实图像开发验证 / Real-image development validation

范围 / Scope: `0.3.0-dev.1`，开发预览，2026-10-12。本记录随实现提交保存，不改变 `0.1.0-alpha.1` 的发布声明。 / This record accompanies the implementation commit and does not amend the published alpha's claims.

本机最终检查通过：81 个单元测试、12 个脚本测试、10 个浏览器流程测试（其中 3 个真实像素流程）、4 个独立 API 模拟服务流程，以及 TypeScript 与生产构建。 / Final local checks passed: 81 unit tests, 12 script tests, 10 browser workflow tests (3 for real pixels), 4 isolated API workflow tests, TypeScript, and the production build.

## 支持范围 / Supported subset

| 项目 / Item | 当前范围 / Current scope |
| --- | --- |
| 像素 / Pixels | 每通道 8/16 位无符号整数；灰度或 RGB，Alpha 必须全不透明 / Unsigned 8/16-bit grayscale or RGB; alpha must be fully opaque |
| TIFF | Classic TIFF，单页，大小端，条带存储，chunky，左上方向，None/LZW/Deflate，predictor 1/2；WhiteIsZero 方向转换 / Single-page, both byte orders, strips, chunky layout, top-left orientation, listed compression and predictors |
| TIFF 元数据 / Metadata | 主图 EXIF/GPS 指针仅从解码副本移除，原文件不改、不遍历子目录；图像 SubIFD 仍拒绝 / EXIF/GPS pointers removed only from a decoding copy, never traversed; original retained; image SubIFDs rejected |
| PNG | 非交错灰度、RGB 与全不透明 Alpha；不支持调色板、动画、透明键或 EXIF 方向 / Non-interlaced grayscale/RGB/opaque-alpha; no palette, animation, transparency keys, or EXIF orientation |
| 限额 / Bounds | 每图 ≤64 MiB、≤8,388,608 像素、任一边 ≤16,384；项目 ≤48 图、原图 ≤256 MiB、总像素 ≤33,554,432；元数据有独立上限 / Per-image, aggregate, and metadata bounds are checked |
| 定量 / Measurement | 原始数组求和；RGB 算术通道均值；局部均值扣背景；暗/亮信号；不使用 Canvas 读数 / Source-array sums, arithmetic RGB mean, local mean background, dark/light signals; no Canvas measurement |
| 排除 / Rejection | 多页、BigTIFF、浮点/有符号、平铺、平面分通道、非标准方向、透明像素等明确失败，不自动转成 8 位 / Unsupported forms fail explicitly instead of conversion to 8 bits |

支持原始位深不证明采集强度线性。RGB/PNG 色彩元数据不用于重新校正测量值；方法与原始字节一并保留。图像显示使用独立 8 位预览，不能替代原始定量数组。 / Preserving bit depth does not establish intensity linearity. Encoded intensities are measured without color-management remapping; display previews are separate.

## 已执行的检查 / Executed checks

本机环境 / Local environment: macOS 27.0.1，Node.js 24.14.1，项目锁定依赖。浏览器测试使用 Playwright 的 Chrome channel；具体输出以测试报告为准。 / Dependencies are locked. Browser workflow checks use the Playwright Chrome channel.

- 像素测试：8/16 位 PNG/TIFF、端序、压缩/多 strip/predictor、WhiteIsZero、不透明 Alpha、手算区域积分、局部背景、弱谷/额外泳道/多排歧义，以及校验和、恶意指针和资源上限。
  Pixel tests cover supported encodings, independently specified region arithmetic, proposal ambiguity, corrupt inputs, hostile metadata pointers, and resource bounds.
- 模型测试：逐实验内参和对照归一化、完整配对交集、重复曝光不增加 n、多蛋白分开、无效分母/重叠区域阻断、原图哈希、历史隔离、归档恢复、保存顺序与 CSV 防公式注入。
  Model tests cover normalization, complete paired sets, independent-unit counting, protein separation, invalid geometry/signals, provenance, recovery, save ordering, and CSV escaping.
- 浏览器测试：8 位 TIFF 与 16 位 PNG 混合导入；一次泳道说明；候选；手动 ROI 改变净信号及倍数；自动建议保留手动区域；双语、刷新和另一个隔离浏览器上下文恢复；CSV/SVG/PNG/TIFF 导出；检查无外部请求，导入/分析阶段无 HTTP 请求。
  Browser tests cover the actual local workflow, original-byte archives, manual recalculation, recovery, bilingual controls, downloads, and network behavior for the tested sequence.
- 独立参考：用 Pillow 生成的 9 种合成 TIFF，与 TypeScript 解码逐像素完全一致。另有六张用户提供的私有 TIFF，仅在本机用同一人工 ROI 与独立 Pillow/NumPy 实现比较，60 个面积/积分/背景/净信号/端点比例值误差为 0，归一化容限为 `1e-12`；原图、文件名、数值及输出不进入仓库。
  Independent checks compare nine Pillow-generated synthetic encodings and a private six-image local-only test. The latter establishes agreement for specified ROIs, not the correctness of ROI selection or biological inference. Private data are not repository fixtures.
- 另外七张不透明组织源图能解码，两张带透明画布的拼图明确拒绝用于测量。只作格式回归，没有推断其膜配对或患者统计。 / Seven additional opaque tissue source images decode; two transparent montages are rejected for measurement. This is format coverage, not patient-level validation.

可复现的公开输入与预期输出见 [SYNTHETIC 像素示例](../public/examples/real/README.md)。私有测试不能替代公开基准。 / See the public synthetic pixel example; a private smoke test is not a public benchmark.

## 尚未验证 / Outstanding validation

- 固定、公开的 ImageJ 流程对照，更多仪器及压缩格式，原始采集动态范围与曝光线性。 / Fixed ImageJ workflow, wider instrument coverage, acquisition dynamic range, and exposure linearity.
- 多实验室手动 ROI 一致性、批量耗时与错误率、数周后重新上手，以及接近资源限额时的响应性。 / Independent-lab agreement, throughput/error rates, delayed return-to-use, and near-limit responsiveness.
- 新增真实图像流程的 Windows/macOS × Chrome/Edge CI 结果须对应本次提交单独检查；旧 alpha 的矩阵不能作为本版证据。 / New-flow platform results must be tied to this commit, not inherited from the old alpha.
- 配对组织患者模型、技术重复合并、跨膜/跨曝光可比性、推断统计均未实现。 / Patient pairing, technical-replicate aggregation, cross-membrane/exposure comparability, and inferential tests are not implemented.

本版图表是均值 ± SD 和逐实验配对点，不自动给 p 值。质量提示随 CSV、项目和图形保留；人工复核不消除截断，也不证明算法科研有效。 / Charts show paired points and mean ± SD, without automatic p values. Review cannot remove clipping or establish scientific validity.

## 复现 / Reproduction

```sh
npm ci
npm run check
npm run test:scripts
npm run test:e2e
npm run test:vision:e2e
```

新增 MIT 依赖为 `tiff@7.1.3`、`fast-png@8.0.0`（包括 MIT 的 `iobuffer@6.0.1`）。构建分发时运行 `node scripts/third-party-notices.mjs --output dist/THIRD_PARTY_NOTICES.txt` 保留依赖原许可。 / Generate the license inventory with the command shown; source code licensing does not replace third-party notices.
