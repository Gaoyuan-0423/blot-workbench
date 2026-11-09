# P0-D03 病理工作台分析有效性实现与验证

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `p0-implementation/pathology-validation.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

记录时间：2026-11-08T18:15:31.781257+08:00

仓库：`pathology-workbench`。分支：`codex/validation-p0-20261108`。工作树基线 commit：`bb9c45c0fc81fe7ea0c449d209e9d63e6eb66a2e`。本次变更尚未提交；基线 commit 不是本次实现的 commit。没有推送或发布。

## 本次实现

- 统一 current-analysis gate 将工作像素对象、图像元数据、ROI、全部分析参数、AI 开关和模型内容 SHA-256 绑定到一个请求；非分析性样本库/显示修改不改变测量身份。
- 参数变化后的首次界面提交即隐藏旧指标与 overlay。窗口报告 API、Methods、样本保存、Excel/JSON 入口与项目快照使用同一受校验结果，不等待 400 ms debounce 后才失效。
- 连续变更使用 ticket，迟到成功/失败不能覆盖新请求。worker 的普通计算失败、崩溃、响应读取失败及 postMessage 失败均有拒绝路径；失败时当前结果不可用，界面允许重试。
- AI 会话按内容 SHA-256 缓存；同名不同内容不能复用旧模型。worker 异步壳串行处理请求，避免前台与批处理互换共享模型。批处理固定其启动时的配置与 AI 选择。
- 保存实际 AI 使用状态、实际模型身份及请求模型身份（包括 Otsu 回落）。中英 Methods 标明实际 AI/回落；无当前有效结果时不生成完成式 Methods；IF Methods 反映当前 RGB 通道、阈值及整图范围。
- 旧项目包中的 analysis/restoredAnalysis 缺少可验证的生成时绑定，导入时只作为历史值，不补造当前身份。项目再导出只保存本工作区重新计算且仍匹配的 ready 结果；未重算时不携带旧结果。原项目包不被修改。

## 真实执行的验证

| 命令 | 最终结果 |
|---|---|
| `npm test` | 通过：19 个测试文件，163 个 tests |
| `npm run build` | 通过；包含 `tsc -b` 与 Vite 生产构建 |
| `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=5198 npx playwright test tests/e2e/analysis-validity.spec.ts tests/e2e/smoke.spec.ts --workers=1 --reporter=line` | 通过：4/4，最终一轮 11.9 s |
| `git diff --check` | 通过 |
| `npm run lint` | exit 0；仍有 11 条 warnings（React refs/effect/memoization 及 chart erasing-op），不是零 warning |

最初使用默认 Playwright 浏览器运行时，本机缺少指定 chromium_headless_shell-1248，因此未启动浏览器。随后使用已安装 Chrome 的独立 headless 进程完成全部 4 条检查；没有安装浏览器、接管用户标签页或操作用户 GUI。`playwright.config.ts` 增加可选 `PLAYWRIGHT_CHANNEL=chrome`，默认 CI 行为不变。

Vite 构建仍提示一个打包体积超过 500 kB 的 warning；这不是构建错误。本轮没有做性能基准。

新增针对性回归覆盖：pixels/图像元数据/ROI/各参数/AI 开关与模型内容失效；连续请求和过期成功/失败；模型身份不符拒绝；worker 故障与恢复；同名模型缓存替换；worker 串行边界；旧项目新参数夹带旧结果的拒绝；无当前结果的中英 Methods；改参数立即显示/API/报告下载/项目导出/样本按钮；现有历史样本不被当前参数修改重写。浏览器另外运行已有真实 worker 的合成 IHC 导入→分析→Excel 导出及批处理 smoke。

## 运行环境

- macOS 27.0.1，arm64
- Node v24.14.1；npm 11.11.0
- 安装版本：Vitest 5.0.4、TypeScript 6.0.3、Vite 8.3.4、Playwright 1.64.0、React 19.3.0
- Google Chrome 156.0.8078.81，headless
- 复用现有 node_modules；未安装或升级依赖。

## 验证边界

这份记录是工程回归检查，不是图像定量准确性、独立外部验证或生物结论有效性的证明。没有新增真实数据、独立 holdout 或新科学实验。没有修改 `src/core/analysis/` 和 `src/core/image/` 的图像/测量算法，因此没有重跑历史厂商 35 图定量基准。

AI 身份与异步边界由 mock session、受控 worker 和真实 SHA-256 验证；本轮未加载真实 ONNX 权重评估分割准确性。2 条既有 smoke 使用真实分析 worker 与原有合成图生成器。

当前图像的运行期身份依赖应用将 ImageData 视作不可变对象并在换图时替换引用；不承诺检测外部代码对同一像素 buffer 的原地篡改。已提交的过期 worker 计算会继续完成，但响应被丢弃；本轮没有增加底层中断或挂起超时。模型字节会随每次 AI 请求发送到 worker，缓存按内容身份复用会话，尚未对大模型传输开销做优化。

历史归档/样本的既有测量值未获得追溯性认证。旧包在重算前重新导出会省略当前结果，这是防止给未知生成来源的结果补造身份的保守处理。独立科学验证、样本独立性与全场景方法学审校仍是后续工作。

## 本次工作树文件及当前采样 SHA-256

以下哈希是本记录生成时的代码快照，hash basis 为 `implementation_snapshot_2026-11-08`，不是历史证明。共 18 个改变/新增文件。

| 文件（相对 pathology-workbench） | SHA-256 |
|---|---|
| `playwright.config.ts` | `25a16556723be679e6eb6a2a6f304514ed78a8e250aea55dceaadc8ef449f175` |
| `src/App.tsx` | `f41f0a84fc912294f6bf81e6c8b0c6125704e94a262b56e827eb1a2c2c4f7613` |
| `src/core/ai/session.test.ts` | `311ed180d2207fd82a6abf2acd6fec3a16c82edcd15fbd8f3400b506962c11a6` |
| `src/core/ai/session.ts` | `292dee071655c94c7457d19447dacaab46466977d7919e16769ef58cc1666219` |
| `src/core/analysis-client.test.ts` | `f4790c26e464d8fbe8f2527ca12ca0f6337a3b067b2707a7e2bf6d20b6e956dd` |
| `src/core/analysis-client.ts` | `bf58a5921f0846afb8c4bff55711280fd9f88b17bfae431f9d33ff0df87a7c0b` |
| `src/core/analysis-validity.test.ts` | `a9049abe45c66de373e935631b1bb03e5c22efe016006c8ef1477f26ea2d0252` |
| `src/core/analysis-validity.ts` | `5307911ae8b81e2762d9c6e88aa9d423d7e08647219cc8620ed98b59d97ed2d3` |
| `src/core/analysis.worker.test.ts` | `9806ff1b53c4809d24af3097521c9fc0c30d4758c42174f43e901d1e303af94c` |
| `src/core/analysis.worker.ts` | `55844303f019bc791d4626ed72cc8e3cc364a36950472b78efba6de847dbd114` |
| `src/core/api.ts` | `03906c4c9a29e76f335997f296e8e83418127c038bf2f8e9d604cf5fdb8e83ee` |
| `src/core/methods.test.ts` | `d43180bc315f7a822ef37c00faf9ae29e863fb1fd4c9caaffdacda5e0e1d626d` |
| `src/core/methods.ts` | `3567f1573c5683103d6ef29fe17ba376dfc69bdfccd57bbb5e168d8fcba2c2bf` |
| `src/core/types.ts` | `870de40419387642ffc5872dad62286f3b61e3f6caf5e94e0ca0d87b21e2db64` |
| `src/i18n/messages.ts` | `8b1b95af671ee8ff95f64f3eaf25b10bb6ae31da3234c8d51560b391db087a15` |
| `src/project-io.test.ts` | `c654a7642a0084aff3cf760afe2657983fa844296c79a2764f785cbf6ac329f1` |
| `src/project-io.ts` | `f2603dc8c236bba9a28bdfdd027d0a1b3fc70d7e195d1e278d45c88a45c5cffa` |
| `tests/e2e/analysis-validity.spec.ts` | `8f0cbe43ff25388dc4abc4212356d7968264e6dc7e076da62a670276e2b12b2e` |
