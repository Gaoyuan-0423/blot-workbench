# 贡献指南 / Contributing

感谢你帮助把实验室工作流变得更清楚。当前版本是合成数据演示；请把产品流程问题、实现缺陷和未来科研方法需求分别描述。

## 反馈前

先查看 [README](README.md) 和[演示边界](docs/demo-boundary.md)。真实图像导入与定量未实现，不要把预置演示值用于评价算法误差。当前尚未创建远端仓库；`.github/` 下的 issue/PR 模板是待发布材料，可先用于整理本地反馈。请提供版本、系统、浏览器和最短复现步骤；尽可能使用内置示例。

不要提交未获授权的原始图像、样本标识、凭据或本机路径。公开 issue 和 PR 会被他人看到。外部数据应先确认共享范围与许可证，再讨论引入方式。

## 修改流程

1. 较大的行为或数据结构变更先开 issue，说明问题、预期行为和验证方式。
2. 在分支中保持变更聚焦，不复制竞品代码、图标、图片或具体界面素材。
3. 修改中英界面时同步关键术语与错误提示；修改方法时同步演示边界和数据解释。
4. 数据结构修改说明旧项目的兼容与迁移策略，不能静默重写旧分析参数或结果。
5. 运行与变更相关的检查并在 PR 中写实际结果；未运行就写未运行及原因。

开发命令见 [README](README.md#本地运行与开发)。UI 改动应附实际截图及环境；数值或状态逻辑应有覆盖失败条件的测试。不要添加仅重复实现、却无法发现错误的测试。

## 研究与许可

算法贡献应说明输入数据类型、适用条件、计算定义、边界情况和可复现证据。新依赖或复用代码应记录来源与许可证；MIT 项目许可证不自动改变依赖的义务。

提交贡献表示你有权提供该内容，并同意按本仓库的 MIT 许可证分发。不得把未验证能力写为已支持，不得编造测试、作者、DOI 或性能提升。

## English

The remote repository has not been created. Issue/PR templates are publication-preparation materials and can be used to organize local feedback. Prefer the built-in synthetic example for reproduction and include exact versions and environments. Do not post unpublished data, credentials, private identifiers, or third-party assets without permission. Discuss substantial changes first, keep patches focused, and report tests actually run. Changes to methods, schema, or languages require corresponding documentation. Preserve older analysis snapshots and describe migrations. Contributions must be yours to share under MIT; dependencies retain their own licenses. Never present a planned feature or an unexecuted test as complete.
