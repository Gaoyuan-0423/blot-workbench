# 架构与路线图

本页以 `0.1.0-alpha.1` 为界区分已建立的演示结构与规划。路线图不承诺精确工期。

## API 接入开发分支

`0.2.0-dev.1` 在已有演示外增加同源本机 Node 服务和独立 `src/vision` 设置面板。当前协议为可配置的 OpenAI-compatible Chat Completions；只通过固定内置合成 PNG 检查服务响应，不接入真实图像项目或自动定量。配置与密钥不进入项目 schema，手动演示的保存/模板/导出流程保持独立。具体使用与测试边界见[API 指南](vision-api.md)，用户要求的批量自动主流程见[下一版设计](automation-design.md)。

## 当前演示结构

- TypeScript/React 网页界面：项目概览、样本、图像检查和模拟结果。
- 项目数据：批次、样本、实验单位、泳道、图像、模板、分析状态和快照。
- 浏览器内保存与项目包导入/导出：恢复流程和迁移流程的演示。
- 纯合成图像与预置结果：不依赖远程模型，不包含真实图像测量引擎。

项目对象把日期放在批次属性中，样本由稳定 ID 关联，模板快照与当前模板分开保存。当前 schema 只是演示模型；完整的膜对象、技术重复层级、曝光采集元数据、计算运行 provenance 和格式迁移仍需在真实引擎阶段完善。

## 接下来按证据推进

| 阶段 | 交付物 | 进入下一阶段的依据 |
| --- | --- | --- |
| 网页演示 | 可讨论的多图流程、示例与恢复/失效机制 | 关键交互和导出可复现；反馈不再依赖想象 |
| 图像与存储技术验证 | 真实 TIFF/PNG 解码、原始数组、像素/位深测试、项目格式升级策略 | 在明确支持的格式子集和两套系统中通过真值检查 |
| WB 最小定量 | 人工 ROI、背景扣除、明确配对、版本化结果及审阅记录 | 固定流程 ImageJ 对比、异常数据处理和真实图像测试有证据 |
| 批量与易用性 | 可复用模板、失败队列、恢复提示、备份迁移 | 批量任务和间隔重返测试显示改善且不增加错误 |
| 独立扩展 | 基础组图、可选 Wisp 适配、后续 IF 流程 | 各自需求、数据边界和验证方法明确 |

## 网页与桌面

目标是在 Windows/macOS 的明确浏览器矩阵上提供网页版本。浏览器原生解码和 Canvas 显示不能直接充当高位深定量管线，解码器和原始数组读取必须独立验证。对大图和批量任务还需测内存、后台任务取消及存储限额。

如果浏览器格式支持、文件权限或性能不满足目标，再比较本地服务加网页界面与桌面封装。当前没有桌面安装包，不以“网页跨平台”替代各平台验收。

## Wisp Science：计划中的可选适配

Wisp 官方已有本地 MCP 连接，以及把 Skill、stdio MCP 和 MCP App 打包的插件格式。可采用独立分析核心加薄适配层，复用项目与方法，避免把核心工作流绑定到聊天模型。[基础配置](https://github.com/xuzhougeng/wisp-science/blob/main/docs/basic-configuration.md)、[插件格式](https://github.com/xuzhougeng/wisp-science/blob/main/docs/feature-plugins.md)

官方页面对 App 主动工具调用存在表述差异，具体能力需锁定 Wisp 版本验证：加载、ROI 交互、文件导出、连接断开与长任务恢复。此仓库当前不提供可安装 Wisp 插件。

本地 MCP 的计算位置不保证上下文不外发；远程模型请求可能包含工具输出或选中状态。未来默认向聊天提供最少的脱敏任务状态，预览图、样本元数据和结果外发需有独立的数据边界。见[隐私说明](privacy.md)。

## WB 与免疫荧光

可共用项目、原图存储、样本 ID、ROI 几何、参数快照、审阅状态、导出与中英文资源。

IF 的多通道读取、标定、阈值/分割、细胞或组织对象、视野与样本层级、强度背景和共定位方法必须独立实现和验证；不能把 WB 泳道替换名称就视为 IF 分析。先保留模块边界，不提前建立庞大插件平台。

## English summary

The current browser alpha demonstrates project state and review workflows. Real image decoding, quantification, desktop packages, IF, and Wisp integration remain separate future stages. The analysis core and project format should be independent of UI hosts and language models. Each stage requires evidence before expanding its scope; Windows/macOS compatibility must be tested, not inferred from the web stack.
