# 真实图像开发验证 / Real-image development validation

范围 / Scope: `0.3.0-dev.3`（已发布为 `v0.3.0-alpha.1` / released as `v0.3.0-alpha.1`），开发预览，2026-10-12。本记录随实现提交保存，不改变 `0.1.0-alpha.1` 的发布声明。 / This record accompanies the implementation commit and does not amend the published alpha's claims.

本次 `0.3.0-dev.3`：103 个单元测试（含新项目默认共同基准、旧存档保持匹配对照及基准选择持久化回归）、12 个脚本测试、12 个 Chrome 浏览器流程测试（含 5 个真实像素/配对流程，其中断言新项目默认共同基准且切换基准不改变 P 值）、TypeScript 与生产构建通过。当前只核验了本机 macOS Chrome；未重新运行无改动的视觉 API 套件，Windows/Edge 与远端 CI 状态不由此推定。 / Dev.3 passed 103 unit tests (covering the new common-baseline default, legacy-archive matched-control fallback, and explicit baseline-choice persistence), 12 script tests, 12 Chrome workflows (including 5 real-pixel/pairing workflows asserting the default baseline and P-value invariance across baseline switches), TypeScript, and the production build. This run covered local macOS Chrome only. The unchanged vision-API suite was not rerun; Windows/Edge and remote CI remain unverified.

历史记录（`0.3.0-dev.2`）：101 个单元测试、12 个脚本测试、12 个 Chrome 浏览器流程测试（含 5 个真实像素/配对流程）、TypeScript 与生产构建通过。新增推断测试、完整配对、共同基准、统计 CSV、双语导出与项目迁移已覆盖。 / Historical dev.2 checks passed: 101 unit tests, 12 script tests, 12 Chrome workflows (including 5 real-pixel/pairing workflows), TypeScript, and the production build, covering paired inference, complete pairs, common baseline, statistics CSV, bilingual exports, and archive migration.

历史记录（`0.3.0-dev.1`）：81 个单元测试、12 个脚本测试、10 个浏览器流程测试（其中 3 个真实像素流程）、4 个独立 API 模拟服务流程，以及 TypeScript 与生产构建通过。 / Historical dev.1 checks passed: 81 unit tests, 12 script tests, 10 browser workflow tests (3 for real pixels), 4 isolated API workflow tests, TypeScript, and the production build.

## 支持范围 / Supported subset

| 项目 / Item | 当前范围 / Current scope |
| --- | --- |
| 像素 / Pixels | 每通道 8/16 位无符号整数；灰度或 RGB，Alpha 必须全不透明 / Unsigned 8/16-bit grayscale or RGB; alpha must be fully opaque |
| TIFF | Classic TIFF，单页，大小端，条带存储，chunky，左上方向，None/LZW/Deflate，predictor 1/2；WhiteIsZero 方向转换 / Single-page, both byte orders, strips, chunky layout, top-left orientation, listed compression and predictors |
| TIFF 元数据 / Metadata | 主图 EXIF/GPS 指针仅从解码副本移除，原文件不改、不遍历子目录；图像 SubIFD 仍拒绝 / EXIF/GPS pointers removed only from a decoding copy, never traversed; original retained; image SubIFDs rejected |
| PNG | 非交错灰度、RGB 与全不透明 Alpha；不支持调色板、动画、透明键或 EXIF 方向 / Non-interlaced grayscale/RGB/opaque-alpha; no palette, animation, transparency keys, or EXIF orientation |
| 限额 / Bounds | 每图 ≤64 MiB、≤8,388,608 像素、任一边 ≤16,384；项目 ≤48 图、原图 ≤256 MiB、总像素 ≤33,554,432；元数据有独立上限 / Per-image, aggregate, and metadata bounds are checked |
| 定量 / Measurement | 原始数组求和；RGB 算术通道均值；局部均值扣背景或与 ImageJ 数值一致的 rolling ball（可选半径）；暗/亮信号；不使用 Canvas 读数 / Source-array sums, arithmetic RGB mean, local mean background or an ImageJ-compatible rolling ball (optional radius); dark/light signals; no Canvas measurement |
| 排除 / Rejection | 多页、BigTIFF、浮点/有符号、平铺、平面分通道、非标准方向、透明像素等明确失败，不自动转成 8 位 / Unsupported forms fail explicitly instead of conversion to 8 bits |

支持原始位深不证明采集强度线性。RGB/PNG 色彩元数据不用于重新校正测量值；方法与原始字节一并保留。图像显示使用独立 8 位预览，不能替代原始定量数组。 / Preserving bit depth does not establish intensity linearity. Encoded intensities are measured without color-management remapping; display previews are separate.

## Rolling ball 与 ImageJ 数值对照 / Rolling-ball parity with ImageJ

`src/real/rolling-ball.ts` 是对 ImageJ 1.x 公共领域算法（`BackgroundSubtracter`/`RollingBall`，"Process › Subtract Background"，light background）的独立 TypeScript 实现。对照方法：同一图先由 ImageJ 转 8 位并存为基准，随后 ImageJ 与本实现分别执行 rolling=25/50/100 的背景扣除，逐像素比较校正结果并比较全图 IntDen（校正后像素和）。测试 `src/real/rolling-ball.parity.test.ts` 在本机语料缺失时自动跳过；完整扫描命令为 `npx tsx scripts/imagej-parity/run-parity.ts 10`。 / `src/real/rolling-ball.ts` is an independent TypeScript implementation of ImageJ 1.x's public-domain algorithm. Parity method: ImageJ converts each fixture to 8-bit as the shared input, then both ImageJ and this implementation subtract a rolling ball (r=25/50/100, light background); the corrected images are compared pixel-by-pixel and whole-image IntDen (corrected sum) is compared relatively.

本机环境 / Environment: macOS (Apple Silicon)，本机 ImageJ 1.53a，Node 22，私有膜图语料（CST/Proteintech/Tanon 截图，不随仓库分发）。执行日期 / Executed: 2026-10-14。

| fixture (staged id) | radius | pixels | exact | max \|Δ\| | mean \|Δ\| | IntDen rel. Δ |
| --- | --- | --- | --- | --- | --- | --- |
| fixture-0 | 25 | 182000 | 99.9995% | 1 | 0.0000 | 0.00000% |
| fixture-0 | 50 | 182000 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-0 | 100 | 182000 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-1 | 25 | 791320 | 99.9996% | 1 | 0.0000 | 0.00000% |
| fixture-1 | 50 | 791320 | 99.9996% | 1 | 0.0000 | 0.00000% |
| fixture-1 | 100 | 791320 | 99.9997% | 1 | 0.0000 | 0.00000% |
| fixture-2 | 25 | 876288 | 99.9998% | 1 | 0.0000 | 0.00000% |
| fixture-2 | 50 | 876288 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-2 | 100 | 876288 | 99.9998% | 1 | 0.0000 | 0.00000% |
| fixture-3 | 25 | 876288 | 99.9991% | 1 | 0.0000 | 0.00000% |
| fixture-3 | 50 | 876288 | 99.9999% | 1 | 0.0000 | 0.00000% |
| fixture-3 | 100 | 876288 | 99.9997% | 1 | 0.0000 | 0.00000% |
| fixture-4 | 25 | 728000 | 99.9999% | 1 | 0.0000 | 0.00000% |
| fixture-4 | 50 | 728000 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-4 | 100 | 728000 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-5 | 25 | 876288 | 99.9991% | 1 | 0.0000 | 0.00000% |
| fixture-5 | 50 | 876288 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-5 | 100 | 876288 | 99.9998% | 1 | 0.0000 | 0.00000% |
| fixture-6 | 25 | 876288 | 99.9981% | 1 | 0.0000 | 0.00001% |
| fixture-6 | 50 | 876288 | 99.9999% | 1 | 0.0000 | 0.00000% |
| fixture-6 | 100 | 876288 | 99.9998% | 1 | 0.0000 | 0.00000% |
| fixture-7 | 25 | 876288 | 99.9989% | 1 | 0.0000 | 0.00000% |
| fixture-7 | 50 | 876288 | 99.9998% | 1 | 0.0000 | 0.00000% |
| fixture-7 | 100 | 876288 | 99.9999% | 1 | 0.0000 | 0.00000% |
| fixture-8 | 25 | 876288 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-8 | 50 | 876288 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-8 | 100 | 876288 | 100.0000% | 0 | 0.0000 | 0.00000% |
| fixture-9 | 25 | 269100 | 99.9989% | 1 | 0.0000 | 0.00000% |
| fixture-9 | 50 | 269100 | 99.9996% | 1 | 0.0000 | 0.00000% |
| fixture-9 | 100 | 269100 | 99.9955% | 1 | 0.0000 | 0.00002% |

最差逐像素精确率 99.9955%，最大单像素差 1（8 位舍入一步），最差全图 IntDen 相对差 0.00002%。16 位输入的 rolling ball 语义按同一公式在原位深执行，尚未与 ImageJ 的 16 位路径单独对照；这属于「尚未验证」。 / Worst pixel-exact rate 99.9955%, worst single-pixel difference 1 (one 8-bit rounding step), worst whole-image IntDen relative difference 0.00002%. Rolling ball on 16-bit rasters applies the same formula at the original depth but has not been separately compared against ImageJ's 16-bit path; that remains outstanding.

## 新增回归范围 / Added regression scope

`src/real/statistics.test.ts` 包含纯合成 n=2/3/10 配对数据的独立 SciPy t、P 和差值 CI 参考值，并覆盖极小但可表示的尾概率、共同正比例缩放、方向反转、重复编号、无效数值及零差值方差。模型回归涵盖个体去重、完整配对、基准变更后的检验输入一致性以及两种绘图模式下的跨采集可比性警告。此处记录测试定义，执行是否通过以本版最终检查记录为准。

`src/real/statistics.test.ts` contains purely synthetic n=2/3/10 paired fixtures with independently calculated SciPy t, P, and difference-CI references. Cases also address small representable tails, common positive scaling, direction reversal, duplicate IDs, invalid values, and zero difference variance. Model regression covers individual deduplication, complete pairs, test-input invariance to plot baselines, and cross-acquisition inference warnings under both plotting modes. These are test definitions; executed outcomes must be recorded against this version.

## 前版已执行的检查 / Previously executed checks

本机环境 / Local environment: macOS 27.0.1，Node.js 24.14.1，项目锁定依赖。浏览器测试使用 Playwright 的 Chrome channel；具体输出以测试报告为准。 / Dependencies are locked. Browser workflow checks use the Playwright Chrome channel.

- 像素测试：8/16 位 PNG/TIFF、端序、压缩/多 strip/predictor、WhiteIsZero、不透明 Alpha、手算区域积分、局部背景、弱谷/额外泳道/多排歧义，以及校验和、恶意指针和资源上限。
  Pixel tests cover supported encodings, independently specified region arithmetic, proposal ambiguity, corrupt inputs, hostile metadata pointers, and resource bounds.
- 模型测试：逐实验内参和对照归一化、完整配对交集、重复曝光不增加 n、多蛋白分开、无效分母/重叠区域阻断、原图哈希、历史隔离、归档恢复、保存顺序与 CSV 防公式注入。
  Model tests cover normalization, complete paired sets, independent-unit counting, protein separation, invalid geometry/signals, provenance, recovery, save ordering, and CSV escaping.
- 浏览器测试：8 位 TIFF 与 16 位 PNG 混合导入；一次泳道说明；候选；手动 ROI 改变净信号及倍数；自动建议保留手动区域；双语、刷新和另一个隔离浏览器上下文恢复；CSV/SVG/PNG/TIFF 导出；检查无外部请求，导入/分析阶段无 HTTP 请求。
  Browser tests cover the actual local workflow, original-byte archives, manual recalculation, recovery, bilingual controls, downloads, and network behavior for the tested sequence.
- 独立参考：Pillow 生成的合成 TIFF 与 TypeScript 解码逐像素比较；实际输出以对应版本的测试报告为准。私有文件仅可在本机参与适用性检查，原图、文件名、结果、项目包及截图不进入公开仓库或网站，也不作为预载示例。
  Independent references compare Pillow-generated synthetic TIFFs with TypeScript pixel arrays. Private files may be checked locally; their originals, filenames, results, archives, and screenshots are not published or preloaded as website examples. Private checks cannot replace a reproducible public benchmark.

可复现的公开输入与预期输出见 [SYNTHETIC 像素示例](../public/examples/real/README.md)。私有测试不能替代公开基准。 / See the public synthetic pixel example; a private smoke test is not a public benchmark.

## 尚未验证 / Outstanding validation

- 固定、公开的 ImageJ 流程对照，更多仪器及压缩格式，原始采集动态范围与曝光线性。 / Fixed ImageJ workflow, wider instrument coverage, acquisition dynamic range, and exposure linearity.
- 多实验室手动 ROI 一致性、批量耗时与错误率、数周后重新上手，以及接近资源限额时的响应性。 / Independent-lab agreement, throughput/error rates, delayed return-to-use, and near-limit responsiveness.
- 新增真实图像流程的 Windows/macOS × Chrome/Edge CI 结果须对应本次提交单独检查；旧 alpha 的矩阵不能作为本版证据。 / New-flow platform results must be tied to this commit, not inherited from the old alpha.
- 明确个体 N/T 配对与可选双侧配对 t 检验已经实现，但不能由此推定个体独立性、检验假设或科研有效性成立。技术重复自动合并、跨膜/跨曝光校准和多重比较流程仍未实现。 / Explicit individual N/T pairs and optional two-sided paired t-tests are implemented; this does not establish independence, assumptions, or scientific validity. Technical-replicate aggregation, cross-membrane/exposure calibration, and multiplicity workflows remain unimplemented.

本版默认柱图叠加单位点和均值 ± SD，可切换配对连线图。检验默认关闭；明确启用后对原始目标/内参比值计算双侧配对 t 检验，保留实际 n、df、未校正 P、均值差和 95% CI。质量提示及 DRAFT 随结果保留，阻断输入不纳入。人工复核不能消除截断或证明科研有效性。[方法与限制](paired-statistics.md)。 / Default charts use bars, unit points, and mean ± SD, with optional paired lines. Explicitly enabled paired tests use original target/reference ratios and retain actual n, df, unadjusted P, mean difference, and 95% CI. Quality flags and DRAFT remain; blocked inputs are excluded. Review cannot remove clipping or establish scientific validity.

## 复现 / Reproduction

```sh
npm ci
npm run check
npm run test:scripts
npm run test:e2e
npm run test:vision:e2e
```

生产 MIT 依赖包括 `tiff@7.1.3`、`fast-png@8.0.0`（其 `iobuffer@6.0.1` 也是 MIT）；本次新增 `jstat@1.9.6`，使用其 Student-t 分布函数，保留 jStat 原许可证。构建分发时运行 `node scripts/third-party-notices.mjs --output dist/THIRD_PARTY_NOTICES.txt` 保留依赖原许可。 / Generate the license inventory with the command shown; source code licensing does not replace third-party notices.
