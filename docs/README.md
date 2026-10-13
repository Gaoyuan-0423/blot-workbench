# 文档 / Documentation

本目录同时记录在线演示 `0.1.0-alpha.1` 合成数据演示和 `0.3.0-alpha.1` 真实图像发布预览。后者提供真实像素测量、明确个体配对、可选配对检验、视觉 API 合成测试与中英教程；公开网页仍为 `0.1`，`0.3.0-alpha.1` 经 [GitHub Release 附件](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.3.0-alpha.1)分发。

This directory covers both the published `0.1.0-alpha.1` synthetic-data demo and the `0.3.0-alpha.1` real-image released preview. The latter provides source-pixel measurements, explicit individual pairs, optional paired inference, synthetic vision API tests, and bilingual guides; the public website remains `0.1`, and `0.3.0-alpha.1` ships via [GitHub Release assets](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.3.0-alpha.1).

[在线演示 / Published demo](https://gaoyuan-0423.github.io/blot-workbench/) · [源码 / Source](https://github.com/Gaoyuan-0423/blot-workbench) · [发布版本 / Releases](https://github.com/Gaoyuan-0423/blot-workbench/releases)

## 从这里开始 / Start here

开发版侧栏 **使用教程 / User guide** 打开独立 `#guide` 页面，跟随右上角 **EN / 中文** 切换。这个新入口尚未加入公开 `0.1` 网页；仓库中的完整中英操作指南如下。

In the development version, **User guide / 使用教程** in the sidebar opens the standalone `#guide` page, following the top-right **EN / 中文** switch. This new entry is not yet in the published `0.1` site. Complete Chinese and English operating guides are available below.

| 指南 / Guide | 中文 | English |
| --- | --- | --- |
| 真实图像与统计图 / Real images and plots | [真实图像指南](real-images.md) | [Real-image guide](real-images.en.md) |
| 项目与手动演示流程 / Projects and manual demo workflow | [使用指南](user-guide.md) | [User guide](user-guide.en.md) |
| 本机 API 配置与合成图测试 / Local API setup and synthetic testing | [视觉 API 指南](vision-api.md) | [Vision API guide](vision-api.en.md) |
| 项目首页与启动 / Overview and startup | [中英首页](../README.md) | [English README](../README.en.md) |

## 方法、实现与证据 / Methods, implementation, and evidence

| 文档 / Document | 内容 / Contents |
| --- | --- |
| [演示边界 / Demo boundaries](demo-boundary.md) | 合成来源、独立样本与预置数值限制 / Synthetic provenance, independent samples, and preset-value limits |
| [方法与相关工作 / Methods and related work](methods.md) | 演示公式、验证要求及现有工具 / Demonstration formulas, validation requirements, and existing tools |
| [架构与路线图 / Architecture and roadmap](architecture.md) | 当前组成与后续阶段 / Current components and future stages |
| [批量自动流程设计 / Batch automation design](automation-design.md) | 已实现子集与后续 API 自动化规划 / Implemented subset and planned API automation |
| [数据与隐私 / Data and privacy](privacy.md) | 浏览器存储、静态托管与可选服务数据流 / Browser storage, static hosting, and optional-service data flows |
| [演示验证记录 / Demo validation](validation.md) | 已发布演示的运行证据与边界 / Released-demo evidence and limitations |
| [真实图像验证 / Real-image validation](validation-real-images.md) | 格式、数值与交互测试范围 / Format, numeric, and workflow coverage |
| [API 接入验证 / API validation](validation-vision-api.md) | 开发版接口与模拟服务测试 / Development API and mock-provider checks |
| [截图记录 / Screenshot record](screenshots/README.md) | 实际截图的版本和环境 / Versions and environments of actual screenshots |
| [已发布版本说明 / Published release notes](releases/v0.1.0-alpha.1.md) | 已发布版本的范围和限制 / Scope and limitations of the published version |
| [发布记录与复现 / Publication and reproducibility](publishing-plan.md) | 发布入口、构建证据及固定归档 / Publication links, build evidence, and fixed archives |
| [贡献指南 / Contributing](../CONTRIBUTING.md) | 问题反馈、修改流程及许可 / Reporting, contribution workflow, and licensing |

用户指南与视觉 API 指南提供完整中英文版本。技术与验证文档目前以中文为主，部分附英文摘要；导航中的英文标题不表示正文已完整翻译。测试声明以具体版本、环境与运行记录为准，不能把计划或模拟服务测试写成科研验证。

The user guide and vision API guide have complete Chinese and English versions. Technical and validation documents remain primarily Chinese, some with English summaries; an English navigation label does not imply a full translation. Test claims apply to their recorded versions and environments. Plans and mock-provider checks are not scientific validation.

[配对设计、共同基准与统计检验 / Paired design, common baseline, and testing](paired-statistics.md)：检验输入、适用条件、质量状态及多重比较限制。 / Test inputs, assumptions, quality state, and multiplicity limits.
