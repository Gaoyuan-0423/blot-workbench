# Blot Workbench / 印迹工作台

[完整英文 / English README](README.en.md) · [在线演示 / Live demo](https://gaoyuan-0423.github.io/blot-workbench/) · [中文教程](docs/user-guide.md) · [English guide](docs/user-guide.en.md) · [Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues)

面向实验室的 Western blot 项目工作台：先做好多图整理、样本关系、人工检查与间隔后继续分析，再验证真实图像定量。

A Western blot project workbench for laboratories: organize images and sample relationships, review analyses, and return to unfinished work before moving on to validated experimental-image quantification.

## 版本与边界 / Versions and boundaries

- **开发版 / Development — `0.2.0-dev.1`**：增加本机视觉 API 配置、内置合成图接口测试，以及独立中英使用教程。公开网页与下载包尚未被此开发版替换。 / Adds local vision API configuration, a built-in synthetic-image interface check, and a standalone bilingual guide. This development version has not replaced the public site or downloads.
- **已发布 / Published — `0.1.0-alpha.1`**：2026-10-10 发布的纯合成数据流程演示。[直接体验 / Open demo](https://gaoyuan-0423.github.io/blot-workbench/)无需安装；固定版本与构建证据见 [Release](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1)。 / A synthetic-data workflow demonstration dated 2026-10-10. The live demo needs no installation; the Release records the archived version and build evidence.

开发功能位于 [`codex/configurable-vision-api` 分支 / development branch](https://github.com/Gaoyuan-0423/blot-workbench/tree/codex/configurable-vision-api)，尚未合入主线。本次双语首页更新不会替换线上应用。 / Development features remain on that branch and are not merged into the main application. Updating this bilingual homepage does not replace the deployed app.

**两个版本都不能导入真实 TIFF/PNG 或进行科研定量。演示数值来自固定合成图与预设区域，修改 ROI 不会重新测量，不能用于实验结论或论文定量。**

**Neither version imports real TIFF/PNG images or performs scientific quantification. Demonstration values come from fixed synthetic images and preset regions. Editing an ROI does not remeasure it; these values must not support experimental conclusions or publication quantification.**

![Blot Workbench 合成数据演示 / Synthetic-data demonstration](docs/screenshots/app-home.jpg)

截图展示已发布演示的界面；环境与版本见[截图记录 / Screenshot record](docs/screenshots/README.md)，不构成算法或跨平台验证。 / The screenshot shows the released demonstration. Its recorded environment and version are not evidence of algorithm accuracy or cross-platform compatibility.

## 可以体验什么 / What you can explore

| 中文 | English |
| --- | --- |
| 一个项目包含多个日期、批次、膜、目标/内参和曝光；项目不是单次实验。 | Organize dates, batches, membranes, target/reference images, and exposures within one project. A project is not a single experiment. |
| 核对样本、分组与实验单位；检查条带/背景 ROI、内参配对和排除状态。 | Check samples, groups, experimental units, band/background ROIs, reference pairing, and exclusions. |
| 复用模板并保留分析快照；配置改变后旧结果失效。 | Reuse templates while preserving analysis snapshots; configuration changes invalidate prior results. |
| 查看预置扣背景与归一化过程，导出项目/CSV，保存后继续工作。 | Inspect preset background correction and normalization, export projects/CSV, and resume saved work. |
| 开发版可配置视觉服务，只在主动测试时发送内置合成图。 | The development version can configure a vision service and send a built-in synthetic image only on explicit testing. |

示例有 **8 张图、2 个批次、目标/内参各 2 个曝光，以及跨批次复用的 6 个样本、6 个实验单位**。重复曝光或再次上样不会增加独立样本数。

The example contains **8 images, 2 batches, a target and reference at 2 exposures, and the same 6 samples representing 6 experimental units across batches**. Repeated exposures or loading do not increase the number of independent samples. [演示边界 / Demo boundaries](docs/demo-boundary.md)

## 教程与首次体验 / Guides and first use

开发版侧栏的 **使用教程 / User guide** 打开独立 `#guide` 页面，跟随右上角 **EN / 中文** 切换；也可以在本机应用地址后加 `#guide` 直接进入。线上 `0.1` 尚无此新入口，请使用下方仓库教程。

In the development version, **User guide / 使用教程** in the sidebar opens the standalone `#guide` page. It follows the top-right **EN / 中文** language switch and can also be opened by appending `#guide` to the local app URL. The published `0.1` site does not yet have this new entry; use the repository guides below.

| 教程 / Guide | 中文 | English |
| --- | --- | --- |
| 项目、复核、恢复与导出 / Projects, review, recovery, and export | [使用指南](docs/user-guide.md) | [User guide](docs/user-guide.en.md) |
| 本机视觉 API 配置与合成图测试 / Local vision API and synthetic test | [API 接入指南](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/vision-api.md) | [Vision API guide](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/vision-api.en.md) |

首次体验建议：载入示例 → 核对样本和曝光 → 检查 ROI/内参配对 → 确认可用图 → 查看结果 → 导出项目并重新打开。修改 ROI 或配对时，观察旧结果如何变为失效。

For a first walkthrough: load the example → check samples and exposures → review ROIs/reference pairing → confirm eligible images → inspect results → export and reopen the project. Change an ROI or pairing to see prior results become stale.

下载 / Downloads：[示例项目包 / Example project](public/examples/example.wbproj.zip) · [预期结果 CSV / Expected CSV](public/examples/example-results.csv) · [清单 / Manifest](public/examples/manifest.json)

项目包从全部待复核状态开始；确认 7 张可用图后，预期 CSV 有 3 对目标/内参 × 6 个样本 = 18 行。饱和图没有有效结果，18 行也不代表 18 个独立样本。 / The archive starts unreviewed. Confirming 7 eligible images produces the expected 18 rows: 3 target/reference pairs × 6 samples. The saturated image has no valid result; 18 rows do not mean 18 independent samples. [示例说明 / Example notes](public/examples/README.md)

## 尚未实现 / Not implemented

真实 TIFF/PNG 解码与定量、已验证的高位深处理、真实图像自动条带识别、批量自动分析、统计检验、发表组图、免疫荧光、桌面安装器及 Wisp Science 插件均未实现。视觉 API 返回的候选数为 6，也不能证明框选正确或科研准确。

Real TIFF/PNG decoding and quantification, validated high-bit-depth processing, automatic band detection on experimental images, batch automation, statistical tests, publication figures, immunofluorescence, desktop installers, and Wisp Science integration are not implemented. A vision API returning 6 candidates does not establish correct localization or scientific accuracy.

[架构与路线图 / Architecture and roadmap](docs/architecture.md) · [批量自动设计（未实现）/ Batch design (not implemented)](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/automation-design.md)

<a id="本地运行与开发"></a>

## 本地运行与开发 / Local use and development

以下 API 与新教程启动步骤仅适用于开发分支。Windows 与 macOS 使用相同命令，需要 Git 和 Node.js 22.12 或更新的兼容版本；在已经克隆的仓库目录中，先切换到开发分支再启动：

These API and new-guide instructions apply only to the development branch. Windows and macOS use the same commands. With Git and Node.js 22.12 or a newer compatible version, switch branches in your cloned repository before starting:

```sh
git fetch origin
git switch codex/configurable-vision-api
npm ci
npm run local
```

打开终端显示的本机地址，默认 `http://127.0.0.1:4318`；教程为 `http://127.0.0.1:4318/#guide`。按 `Ctrl+C` 停止。`npm run dev` 仅启动前端，**不包含视觉 API 服务**；不要双击 `index.html`。这不是桌面安装器。

Open the printed local address, default `http://127.0.0.1:4318`; the guide is at `http://127.0.0.1:4318/#guide`. Stop with `Ctrl+C`. `npm run dev` runs only the frontend and **does not include the vision API service**. Do not open `index.html` directly. This is not a desktop installer.

构建后本机预览（含 API）/ Preview a build locally with the API:

```sh
npm run build
npm run local:preview
```

检查命令 / Verification commands:

```sh
npm run check
npm run test:scripts
npm run test:e2e
npm run test:vision:e2e
```

浏览器测试需要匹配项目版本的 Playwright 浏览器环境。命令列表不代表测试已执行；已发布版与开发版的证据分别见[演示验证](docs/validation.md)和[API 接入验证](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/validation-vision-api.md)。流程测试通过不等于科研算法有效。

Browser tests require the matching Playwright browser environment. Listing commands does not claim they have run. Consult the [released-demo validation](docs/validation.md) and [development API validation](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/validation-vision-api.md) separately. Passing workflow tests does not validate a scientific method.

## 数据与隐私 / Data and privacy

项目在浏览器中处理，只保存一个当前工作区。新建、载入示例或导入项目会替换它；长期保留或迁移请先导出项目包。清除站点数据、换浏览器或换站点可能使保存不可用，浏览器保存不是备份。在线站点与本机地址不会自动同步。

Projects are handled in the browser, which holds one current workspace. Creating a project, loading the example, or importing replaces it. Export a project archive for backup or migration; clearing site data or changing browsers/origins may make saved work unavailable. Browser storage is not a backup, and hosted and local origins do not synchronize.

GitHub Pages 会提供静态页面和合成示例，因此访问网页仍有网络请求。开发版的可选 API 测试会把内置合成 PNG 和提示词发给你配置的服务，**不发送当前项目或实验图像**。密钥仅由本机服务保存在内存中，不回传、不进入浏览器持久存储或项目导出；重启服务后需重填。服务可能计费，本机超时或取消不保证停止远端计费。

GitHub Pages serves static assets and synthetic examples, so opening the site makes network requests. The optional development API test sends the built-in synthetic PNG and prompt to your configured service, **not the current project or experimental images**. The local service holds the key only in memory; it is not returned, persisted in browser storage, or exported with projects. Restarting clears it. Providers may charge for requests; a local timeout or cancellation does not guarantee remote billing stops.

[隐私说明 / Privacy](docs/privacy.md) · [方法与相关工作 / Methods and related work](docs/methods.md)

## 参与与引用 / Contributing and citation

通过 [GitHub Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues) 反馈问题时，请提供版本、系统/浏览器、复现步骤和预期行为，尽量使用内置示例。请勿公开未获授权的实验图像、样本信息或 API 密钥。[贡献指南](CONTRIBUTING.md)

Use [GitHub Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues) to report the exact version, environment, reproduction steps, and expected behavior, preferably with the built-in example. Do not publish unauthorized images, sample information, or API keys. See [Contributing](CONTRIBUTING.md).

软件采用 [MIT 许可证](LICENSE)。引用时注明实际使用的版本与提交；[CITATION.cff](CITATION.cff)记录已发布版本，开发分支不可冒充该发行版。项目尚无软件论文或 DOI，不把开源、自动化或项目保存主张为独有创新。

The software uses the [MIT license](LICENSE). Cite the version and commit actually used. [CITATION.cff](CITATION.cff) describes the published version, not the development branch. There is no software paper or DOI, and open source, automation, or project saving are not claimed as unique innovations.

[更新记录 / Changelog](CHANGELOG.md) · [已发布版本说明 / Released version notes](docs/releases/v0.1.0-alpha.1.md) · [发布记录 / Publication record](docs/publishing-plan.md) · [文档目录 / Documentation index](docs/README.md)
