# 发布记录与复现 / Publication and reproducibility

`0.1.0-alpha.1` 是纯合成数据的网页流程演示，版本日期为 2026-10-10。公开仓库与 GitHub Pages 网页已经上线。此记录区分已完成的构建/部署检查与科研定量验证；后者不属于本版本的完成范围。

## 入口与版本

| 项目 | 地址或值 |
| --- | --- |
| 公开源码 | [Gaoyuan-0423/blot-workbench](https://github.com/Gaoyuan-0423/blot-workbench) |
| 在线演示 | [GitHub Pages](https://gaoyuan-0423.github.io/blot-workbench/) |
| 版本归档与最终证据 | [v0.1.0-alpha.1 预发布记录](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1) |
| 版本日期 | 2026-10-10 |
| 作者与许可证 | Gaoyuan；MIT |

在线演示会随主线部署更新。需要复现某一版本时，应使用对应 Release 的 tag、提交和资产，不能把今后的网页内容视为这一版本的固定副本。项目没有软件论文或 DOI；引用信息见 [CITATION.cff](../CITATION.cff)。

## 已有运行证据

- 应用主线提交：[7ea215419f51df283962d62b8ead768a6758caba](https://github.com/Gaoyuan-0423/blot-workbench/commit/7ea215419f51df283962d62b8ead768a6758caba)。
- [主线 CI 运行 38060883807](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38060883807) 已通过 18 项核心测试、12 项脚本测试，以及 Windows/macOS × Chrome/Edge 四个组合各 7 项端到端测试。
- [Pages 部署运行 38061081294](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38061081294) 成功，在线入口已核验。

这些运行对应上述应用提交。发布文档合入后会再次运行主线 CI 和 Pages 部署；最终 tag、构建提交、运行链接与资产校验信息以 Release 中的固定记录为准，不将这里的应用提交冒充最终发布提交。环境与检查范围详见[验证记录](validation.md)，页面证据见[截图记录](screenshots/README.md)。

本版本的归档附件为网页构建包 `web.zip`、构建清单 `manifest.json` 和校验文件 `SHA256SUMS`；准确文件名及下载地址以 Release 附件列表为准。

## 采用与反馈证据

目前已合并的 PR 是开发者自己创建的开发记录，不代表外部贡献或用户反馈。仓库访问、下载等指标的采集也不等同于实验室试用或科研采用；目前没有已确认的实验室采用案例可报告。后续如记录用户反馈、试用或采用，应分别说明来源、日期、授权和具体使用范围。

## 真实指标记录

仓库的 `metrics.yml` 工作流在每周一 08:17（Asia/Shanghai，GitHub 调度可能延迟）、每次 Release 发布时及手动触发时读取 GitHub API，将时间、来源、统计口径、Stars/Forks、Issues/PR 状态和各 Release 附件下载次数保存在独立 `metrics` 分支。首次快照运行链接记录在 Release 中。数据可用而没有记录时为零，API 无法取得时为 `null`，不会伪造增长；下载次数包括维护者校验下载，不等同于独立用户。没有网页行为追踪，也不采集实验项目。

这些快照仅记录实际状态，不承诺每周产生代码改进。实质更新由提交、PR、CHANGELOG 和新的版本标签记录，不替换已发布版本的附件。

## 复现与解释

1. 从对应 Release 获取源码或检出其 tag，按 README 的本地启动步骤运行。
2. 使用仓库附带的合成示例，按使用指南检查、确认、导出并恢复项目；原始示例包从未确认状态开始。
3. 复核结果时同时记录版本、提交、操作和环境。预期 CSV 的 18 行来自 6 个实验单位的重复测量，不是 18 个独立样本。

CI 通过表示记录的程序行为满足测试断言，不表示真实图像定量准确，也不证明所有浏览器、系统版本或未来部署都适用。真实 TIFF/PNG 导入、科研算法与统计分析仍未实现。

## English

The public repository and [GitHub Pages demo](https://gaoyuan-0423.github.io/blot-workbench/) are live. Version `0.1.0-alpha.1` is dated 2026-10-10 and attributed to Gaoyuan under MIT. The linked M1 source commit passed 18 core tests, 12 script tests, and 7 end-to-end tests in each Windows/macOS × Chrome/Edge combination; the linked Pages deployment succeeded. Documentation integration triggers another CI/deployment run. Use the [prerelease record](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1) for the final tag, commit, build evidence, and asset checksums. The live site may change after this version. Passing workflow tests does not establish scientific quantification accuracy; real-image import and scientific analysis remain unimplemented.
