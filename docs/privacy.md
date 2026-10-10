# 数据与隐私 / Data and privacy

适用范围：工作台原实验项目演示及新增的 BlotLens 截图核对模块。在线部署是否包含新模块，以部署提交为准。

## BlotLens 截图核对

真实 PNG/JPEG 截图在浏览器内解码与测量。工作台导入按钮通过同源消息把原始文件字节交给内嵌 BlotLens，不自动请求 AI。用户点击识别后，截图或框选区域经过本机 Node 服务发送至用户配置的视觉供应商；响应包含标签和位置，数值继续在本地计算。API Key 仅在该服务进程内存保存，不进入浏览器持久存储或导出文件。供应商的数据处理规则由该供应商决定。

BlotLens 分析仅在页面内存中；刷新前需导出可复算 JSON。该文件包含原截图、模型配置和响应、取样框及编辑记录，分享文件会分享这些内容。它不包含 API Key，也不在工作台实验项目包中。静态部署支持手工分析，AI 需启动本机服务。详见[集成说明](blotlens-integration.md)。

## 当前数据流

- 在线页面、脚本及合成示例由 GitHub Pages 提供，浏览器会向托管方请求这些静态文件。本机运行时由本机开发/预览服务器提供文件；安装依赖会访问包源。这些请求与项目内容的处理是不同的数据流。
- 工作台状态在浏览器中处理与保存，当前只保留一个工作区。项目包导入读入浏览器；项目包和 CSV 导出由浏览器下载到用户选择的位置。
- 原实验项目演示没有账号、图像上传或远程模型流程；真实 PNG/JPEG 导入及可选 AI 识别由独立的 BlotLens 模块提供，数据流见上文。
- 浏览器保存不是加密保险箱或可靠备份。同一浏览器配置下有权限访问站点存储的人可能读取项目；清理站点数据可能删除它。

保存按钮或浏览器存储不承诺跨设备同步。导出的项目包可能包含名称、备注、ROI 和分析配置，分享前应检查内容。

GitHub Pages 托管方可能处理常规连接日志。本地计算不等于托管访问完全无网络，也不表示应用可以在未加载资源时离线使用。在线站点与本机地址的浏览器存储相互独立，迁移项目需导出并导入项目包。

## 验证承诺的边界

“没有数据上传功能”仅适用于原实验项目演示操作，不适用于 BlotLens 的可选 AI 识别。网络请求检查只覆盖测试记录中的操作，不等于对所有浏览器、扩展或部署进行了完整隐私审计。实际运行及覆盖范围见[验证记录](validation.md)。第三方浏览器扩展、托管平台和用户自行修改的部署不在应用代码的控制范围内。

## 未来 Wisp 适配

本地 MCP 只说明工具在本机运行，不保证其输出不会进入远程模型上下文。Wisp 官方文档说明图片附件和图片读取可能发给视觉模型，MCP App 也可更新下一轮文本/JSON 上下文。[模型配置](https://github.com/xuzhougeng/wisp-science/blob/main/docs/model-configuration.md)、[插件文档](https://github.com/xuzhougeng/wisp-science/blob/main/docs/feature-plugins.md)

因此未来应把独立网页/本地分析与可选聊天协助分开，并逐项说明原图、缩略图、样本标签、路径与结果是否会外发。当前没有这项集成，不宣称完成了其隐私验证。

## English summary

The [live demonstration](https://gaoyuan-0423.github.io/blot-workbench/) requests its page, scripts, and synthetic examples from GitHub Pages. Local startup serves those files from a local server, while installing dependencies requests packages from registries. Project state is handled in the browser; the original experiment demo has no remote-model workflow. The embedded BlotLens module accepts real screenshots and sends the chosen image or region to the user-configured provider only when recognition is requested. API keys remain in local server memory. BlotLens JSON exports contain screenshots, model responses and analysis history; they are separate from workbench project archives. The hosting provider may process ordinary connection logs. Local computation is neither a zero-network promise nor an encrypted-storage guarantee. Browser storage can be cleared and is not a backup. Hosted and local origins have separate storage; use project archives to migrate. Exported projects may contain labels, notes, and settings. Recorded network checks cover specific test workflows, not a full privacy audit. Future Wisp/MCP integration requires a separate data-flow review: local computation does not imply that outputs or image previews stay out of remote model context.
