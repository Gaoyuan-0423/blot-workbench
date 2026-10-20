# 架构与路线图

## 真实图像开发预览 / Real-image development preview

`0.3.0-dev.2` 的 `src/real/pixels.ts` 提供不依赖 DOM 的解码、区域与定量；`model.ts` 管理来源字节、参数版本、配对、CSV/ZIP 和描述性汇总；`RealWorkbench.tsx` 提供双语界面，图形导出独立于测量像素。首次暂用独立 `#real` 路由与项目格式 v1；不能在旧演示与真实项目间直接互换。共享布局和显式个体 N/T 表均可运行。个体编号与来源图组分开记录，重复测量不增加独立 n；技术重复自动合并仍未实现。归一化策略与统计检验输入分离：共同基准影响图形尺度，`statistics.ts` 的配对检验使用未经该二次缩放的目标/内参比值。

The new real-image route separates pure pixel computation, project/provenance logic, UI, and figure rendering. It uses a distinct version-1 archive and storage key. Shared-layout and explicit individual N/T workflows are implemented experimentally, with individual IDs distinct from source groups. Repeated measurements do not increase n; technical-replicate aggregation is not implemented. Plot normalization is separate from paired-test inputs, which retain original target/reference ratios. See [current workflow](real-images.en.md) and [validation](validation-real-images.md). The sections below preserve the earlier demonstration roadmap.

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

`desktop/` 已实现实验性 Electron 封装与打包流程，捆绑三个工具同一套网页构建及首页，在 `app://wisplab/` 加载本地资源；没有另行维护一套分析算法。核心分析与本地项目操作可离线使用。默认包未签名、未经公证，没有自动更新器；网站更新不会自动替换已安装程序。安装包发布与各平台验收仍是独立步骤，不以“网页跨平台”或本机 Mac 检查替代 Windows 验收。见[桌面说明](../desktop/README.md)。

账号与云保存代码独立于本机分析，实际开放能力由部署决定；账号入口不意味着已启用实验数据上传。仅在云保存已启用且用户主动确认上传后，项目包才发送到服务端；本地项目不因登录而自动上传或被替换。

The experimental Electron shell in `desktop/` bundles the same three web builds and portal under `app://wisplab/`, without a separate analysis implementation. Core analysis and local projects work offline. Default packages are unsigned and unnotarized, with no automatic updater; website updates do not replace installed software. Distribution and platform acceptance are separate steps. Account and cloud-saving code is optional and deployment-controlled: account access does not establish that experimental-data upload is enabled. Uploads require both an enabled capability and explicit user confirmation; sign-in does not automatically upload or replace local work.

## Wisp Science：计划中的可选适配

Wisp 官方已有本地 MCP 连接，以及把 Skill、stdio MCP 和 MCP App 打包的插件格式。可采用独立分析核心加薄适配层，复用项目与方法，避免把核心工作流绑定到聊天模型。[基础配置](https://github.com/xuzhougeng/wisp-science/blob/main/docs/basic-configuration.md)、[插件格式](https://github.com/xuzhougeng/wisp-science/blob/main/docs/feature-plugins.md)

官方页面对 App 主动工具调用存在表述差异，具体能力需锁定 Wisp 版本验证：加载、ROI 交互、文件导出、连接断开与长任务恢复。此仓库当前不提供可安装 Wisp 插件。

本地 MCP 的计算位置不保证上下文不外发；远程模型请求可能包含工具输出或选中状态。未来默认向聊天提供最少的脱敏任务状态，预览图、样本元数据和结果外发需有独立的数据边界。见[隐私说明](privacy.md)。

## WB 与免疫荧光

可共用项目、原图存储、样本 ID、ROI 几何、参数快照、审阅状态、导出与中英文资源。

IF 的多通道读取、标定、阈值/分割、细胞或组织对象、视野与样本层级、强度背景和共定位方法必须独立实现和验证；不能把 WB 泳道替换名称就视为 IF 分析。先保留模块边界，不提前建立庞大插件平台。

## English summary

The earlier browser alpha demonstrates project state and review workflows. Real-image decoding, quantification, explicit pairing, and opt-in inference are experimental features with separate validation requirements. An experimental desktop shell and packaging workflow now bundle the existing web applications; publication and platform acceptance are separate. IF within WB and Wisp integration remain future stages. The analysis core and project format stay independent of UI hosts and language models. Each stage requires evidence before expanding its scope; Windows/macOS compatibility must be tested, not inferred from the web stack.
