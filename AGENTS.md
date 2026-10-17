# AGENTS.md — blot-workbench（WB 模块 + 总首页 + 统一发布）

面向 AI agent（ZCode / Codex 等）在本仓库工作的约定。人手一份的背景见 `docs/wisplab-handoff-2026-10-17.md` 与 `docs/validation-real-images.md`。

## 唯一源码目录

本仓库的正式编辑目录是 **`~/.codex/worktrees/wb-ui-release/WB分析`**（分支 `codex/wb-ui-release`）。`~/Downloads/WB分析` 是受保护的 main checkout，`~/.codex/worktrees/fbae/` 存放交接文档与软著资料——都不要当作开发目录，也不要互相覆盖。

## 结构

- `src/real/` — **纯函数引擎**（无 DOM）：`model.ts`（项目/泳道/归一化/统计）、`pixels.ts`（TIFF/PNG 解码、`proposeRegions` 泳道提议、`measureRegion`）、`rolling-ball.ts`（ImageJ 兼容背景扣除）、`analysis-report.ts`、`figure-*`。无头调用：仓库内 `node_modules/.bin/tsx`。
- `src/quick/`、`src/single/` — 快速多排 / 单条带工作区；`src/App.tsx` 挂 `#real/#demo/#guide`。
- `portal/` — WispLab 总首页（`index.html/styles.css/favicon.svg/locale.js` 四文件）。
- `deployment/wisplab/` — 统一发布器（`release.py`，publish/rollback）；服务器更新器只读 **`wisplab-deploy-` 前缀**的 Release。

## 测量约定（不要偏离）

- 净信号（dark）＝ 面积×背景均值 − 条带和；light 反号。RGB 取算术通道均值；16 位原样参与测量。
- 背景二选一：local（背景矩形）或 rolling-ball（`{kind:"rolling-ball", radius}`，与 ImageJ 像素级 parity，见 `docs/validation-real-images.md`）。
- 泳道提议是**半自动设计**：多面板图按"多排条带行歧义"拒绝属预期；正确做法是人工定位面板条带行、引擎在条带内分割。自动候选必须人工复核（`CANDIDATES_REQUIRE_REVIEW`）。
- 导入策略按设计只收 8/16 位无符号 TIFF/PNG；JPEG 与扩展名不符**显式拒绝，不要加自动转换**。

## 公开基准与 grader

公开语料全流程对照（4 图/21 泳道，net 相对差 ≤3.2e-04）：`~/Downloads/WispLab预印本验证/wb/`（`app_pipeline.ts` + `wb_reference.py` + README）。厂商语料在 `~/Downloads/WB测试膜/`，**CST 许可禁止再分发，图片不进仓库与 deposit**。改测量/统计代码后：`npm test` 全绿 + 跑 wb 参考对照 + （涉 rolling ball 时）`npx tsx scripts/imagej-parity/run-parity.ts`。

## 其他纪律

- 界面文案**中英双语**同时补（`src/i18n.ts`、`src/messages.ts`），切换语言不得重置分析。
- 发布只走 `deployment/wisplab/release.py publish`（tag 带 `wisplab-deploy-` 前缀），且需所有者确认；其他前缀的 Release 不影响线上。
- java/ImageJ 相关脚本在无 GUI 会话会间歇挂起、ImageJ 访问 ~/Downloads 被 TCC 拦——IO 走 ASCII /tmp。
