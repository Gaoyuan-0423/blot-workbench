# 文档 / Documentation

本目录包含当前工作区指南与历史版本记录。当前单条带与快速模式支持单页 8/16-bit 无符号整数 TIFF 和 8-bit PNG/JPEG；完整原图项目位于 `#real`，旧合成演示位于 `#demo`。具体格式限制见各工作区指南，历史版本范围见对应[发布记录](https://github.com/Gaoyuan-0423/blot-workbench/releases)。

This directory contains current workspace guides and historical version records. Single-strip and quick modes support single-page unsigned 8/16-bit TIFF and 8-bit PNG/JPEG. Full original-image projects use `#real`; the legacy synthetic demonstration uses `#demo`. See each workspace guide for format limits and the corresponding [release notes](https://github.com/Gaoyuan-0423/blot-workbench/releases) for historical scope.

[在线演示 / Published demo](https://gaoyuan-0423.github.io/blot-workbench/) · [源码 / Source](https://github.com/Gaoyuan-0423/blot-workbench) · [发布版本 / Releases](https://github.com/Gaoyuan-0423/blot-workbench/releases)

## 从这里开始 / Start here

侧栏 **使用教程 / User guide** 打开独立 `#guide` 页面，跟随右上角 **EN / 中文** 切换。单条带、多排与完整项目的操作指南如下。

**User guide / 使用教程** in the sidebar opens the standalone `#guide` page, following the top-right **EN / 中文** switch. Guides for single-strip, multirow and full-project workflows are available below.

| 指南 / Guide | 中文 | English |
| --- | --- | --- |
| 单条带识别 / Single-strip recognition | [单条带指南](single-strip.md) | [Single-strip guide](single-strip.md#english-guide) |
| 多排与内参 / Multiple rows and reference | [简易模式指南](quick-mode.md) | [TIFF support and limits](quick-mode.md#tiff-support-english) |
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
| [图版与原始数据优化 / Figures and source-data workflow](wb-publication-optimization.md) | 多条带排版、来源文档、导出检查与验证 / Strip layout, source documents, export checks, and validation |
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
