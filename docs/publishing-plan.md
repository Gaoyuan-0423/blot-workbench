# 发布准备与状态

本次发布范围包括公开 GitHub 仓库、GitHub Pages 网页和 alpha 预发布。**发布已获授权；本文记录准备事项，实际仓库、部署和 release 状态在核验后更新。** 在出现运行证据前，不把配置或拟用地址当成已上线结果。

## 拟用标识

| 项目 | 拟用值 | 状态 |
| --- | --- | --- |
| GitHub 仓库 | `Gaoyuan-0423/blot-workbench` | 尚未创建；不作为可访问仓库链接 |
| GitHub Pages 地址 | `gaoyuan-0423.github.io/blot-workbench/` | 尚未部署；不作为在线演示入口 |
| 版本 | `0.1.0-alpha.1` | 本地 alpha 标识；未发布 release |
| 作者 | Gaoyuan | 引用文件使用这一名称，不推断姓名拆分或 DOI |

## 发布步骤

1. 复核本地构建、示例和文档，确认不含用户原始实验数据或竞品资产。
2. 创建实际仓库并推送约定内容，运行已配置的 CI；记录 Windows/macOS × Chrome/Edge 的真实结果。
3. 对拟发布版本记录 commit、构建来源和许可证清单，生成可校验的发布资产。
4. 部署页面，实际检查资源、示例和下载入口，再将 README 与 CITATION 的仓库/页面地址更新为有效链接。
5. 拍摄真实仓库首页截图，记录时间和可见版本；补全 release 日期及说明。

`.github/workflows/` 是供未来使用的配置，放在本地不代表 CI 已运行，也不代表应用已部署。拟用路径不保证域名、账号配置或最终发布方案，执行时需要重新检查。

## English

Publication of a public repository, GitHub Pages demo, and alpha prerelease is authorized. The identifiers above remain proposed until their actual state is verified. CI files and release notes alone are not evidence of publication. Create the repository, run and record the actual platform matrix, produce verified assets, deploy and inspect the site, then add verified live links, citation URLs, release metadata, and a genuine repository screenshot.
