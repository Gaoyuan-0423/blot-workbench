# Blot Workbench / 印迹工作台

## BlotLens：独立项目，工作台内直接使用

独立的公开 MIT 项目 [BlotLens](https://github.com/Gaoyuan-0423/blotlens) 支持截图粘贴／导入、整图或框选区域 AI 识别、可编辑取样框、本地灰度测量、内参与对照归一化，以及 PNG/SVG/CSV/可复算 JSON 导出。包含撤销、多选、键盘微调、补框、背景处理切换及可自定义的柱状图配色。工作台通过 `reviewer` Git 子模块引用固定提交，复用同一套代码。

```sh
git clone --recurse-submodules https://github.com/Gaoyuan-0423/blot-workbench.git
cd blot-workbench
npm ci
npm run dev
```

默认打开 `http://127.0.0.1:4316`，点击侧栏「截图趋势核对」，从工作台导入截图后在页面内识别、改框和导出。切换工作台页面会保留分析；刷新前需单独导出分析 JSON，工作台项目包不包含截图分析。已有克隆先运行 `git submodule update --init --recursive`。独立启动仍可用 `npm run reviewer:dev`（4317）；也可以直接克隆 BlotLens 仓库。

识别时图片发送到用户配置的视觉服务，密钥仅保留在本机服务内存；无 API 也可使用合成示例或人工取样。静态构建也包含内嵌入口，支持手工分析，AI 需要本机 Node 服务。它只辅助截图趋势核对，不生成 P 值或自动判断论文结论。见 [集成说明](docs/blotlens-integration.md)、[方法与限制](reviewer/docs/methods.md) 和 [验证记录](reviewer/docs/browser-validation.md)。下文的 alpha 版本边界特指原实验项目演示流程。


[English](README.en.md) · [在线演示](https://gaoyuan-0423.github.io/blot-workbench/) · [GitHub 仓库](https://github.com/Gaoyuan-0423/blot-workbench) · [使用指南](docs/user-guide.md) · [问题反馈](https://github.com/Gaoyuan-0423/blot-workbench/issues)

面向实验室的 Western blot 项目工作台。先把多图整理、样本关系、人工检查和间隔后继续分析的流程做好，再验证真实图像定量。

**当前版本：`0.1.0-alpha.1`，纯合成数据的网页演示。数值是固定合成图在预设区域下的示例测量，不会随 ROI 修改重新定量。当前不能导入真实 TIFF/PNG，也不能用于实验结论或论文中的定量。**

**[打开在线演示](https://gaoyuan-0423.github.io/blot-workbench/)**，无需安装。版本日期：2026-10-10；版本归档与最终构建证据见 [alpha 预发布记录](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1)。也可按下文在本机运行。

![Blot Workbench 网页演示](docs/screenshots/app-home.jpg)

截图的环境、版本和证据状态见[截图记录](docs/screenshots/README.md)。截图展示界面，不构成算法或跨平台验证。

## 现在可以体验什么

- 在一个项目中浏览多个批次、膜、目标蛋白/内参和曝光。
- 检查样本、分组与实验单位的对应关系，避免把图像数当作独立样本数。
- 检查条带与背景 ROI、内参配对和排除状态；观察修改后旧结果失效的流程。
- 保存项目与分析时的模板快照，了解模板修订和旧分析之间的关系。
- 查看预置的背景扣除、内参比值和相对值，体验项目恢复及数据导出。
- 切换中英文界面。

演示含 **8 张合成图像、2 个批次、目标/内参各 2 个曝光，以及跨批次复用的 6 个样本和 6 个实验单位**。它们不是 12 个或 48 个独立生物学重复。详细边界见[演示说明](docs/demo-boundary.md)。

## 开始体验

1. 打开[在线演示](https://gaoyuan-0423.github.io/blot-workbench/)；首次打开会载入内置示例。需要本机运行时，按下方[本地运行说明](#本地运行与开发)启动。
2. 从项目概览进入一张图，检查 ROI、曝光、样本和内参关系。
3. 修改一项 ROI 或配对，确认原有模拟结果被标记为需要重新处理；这一步不会运行真实定量。
4. 保存并导出项目，刷新页面或重新导入，检查能否回到先前状态。

可下载[示例项目包](public/examples/example.wbproj.zip)、[示例结果 CSV](public/examples/example-results.csv)和[示例清单](public/examples/manifest.json)。示例只含本项目生成的合成数据；其图像和数值的来源与限制见[演示说明](docs/demo-boundary.md)。

项目包从“待复核”状态开始；示例 CSV 则是确认全部 7 张可用图后的预期输出，含 3 个目标/内参图对 × 6 个样本的 18 行。饱和图不产生结果，18 行不代表 18 个独立样本。[示例文件说明](public/examples/README.md)

浏览器只保存一个当前工作区；新建、载入示例或导入项目会替换它，请先导出需要保留的项目。清除站点数据、切换浏览器/域名或使用无痕模式都可能使保存不可用，本地保存不是备份。[完整指南](docs/user-guide.md)

## 当前不包含

真实 TIFF/PNG 解码与定量、已验证的高位深处理、自动条带识别、统计检验、正式发表组图、免疫荧光分析、桌面安装包和 Wisp Science 插件均未在此版本实现。它们在[路线图](docs/architecture.md)中单独列为后续工作。

已在 [M1 主线 CI](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38060883807) 通过 18 项核心测试、12 项脚本测试，以及 Windows/macOS × Chrome/Edge 四个组合各 7 项端到端测试。这些检查验证演示流程，不验证科研定量准确性，也不覆盖未记录的浏览器组合。环境与提交见[验证记录](docs/validation.md)。

## 数据与方法

演示的项目状态在浏览器中处理与保存；应用没有账号或图像上传服务。在线版本由 GitHub Pages 提供页面、脚本与合成示例，浏览器会向托管方请求这些静态资源。本地计算不等于访问页面时没有网络请求。详见[隐私说明](docs/privacy.md)。

修改 ROI、配对或分析参数后，旧模拟数值不能继续作为当前结果。模板更新不会悄悄重写旧分析快照。当前版本主要用于讨论这些交互与数据关系，算法正确性和真实图像可靠性需要另外验证。[方法说明](docs/methods.md)

## 本地运行与开发

这是开发者启动方式，不是面向实验室用户的桌面安装器。Windows 终端与 macOS 终端使用相同命令；先安装 Node.js 22.12 或更新的兼容版本，在项目文件夹执行：

```sh
npm ci
npm run dev
```

开发服务器仅监听本机。打开终端打印的地址，通常为 `http://127.0.0.1:4316`；结束时按 `Ctrl+C`。不要通过双击 `index.html` 代替开发服务器。

构建与检查命令：

```sh
npm run check
npm run test:e2e
```

已构建版本可用 `npm run preview` 在本机预览，地址以该命令输出为准。它不会发布应用。

浏览器测试需要项目指定版本的 Playwright 浏览器环境；命令存在不代表它已在某个平台执行成功。版本和运行证据见[验证记录](docs/validation.md)。

## 参与与引用

欢迎通过 [GitHub Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues) 反馈任务流程、恢复体验、中英术语和可重现的问题。请阅读[贡献指南](CONTRIBUTING.md)，公开反馈中不要附上未获授权的实验图像或样本信息。

软件采用 [MIT 许可证](LICENSE)。使用或讨论此演示时请引用具体版本；[CITATION.cff](CITATION.cff)提供元数据。项目目前没有软件论文或 DOI，开源、自动化与项目保存也不被主张为独有创新。相关工具见[方法说明](docs/methods.md#相关工作)。

[更新记录](CHANGELOG.md) · [本版本说明](docs/releases/v0.1.0-alpha.1.md) · [发布记录与复现](docs/publishing-plan.md) · [文档目录](docs/README.md)
