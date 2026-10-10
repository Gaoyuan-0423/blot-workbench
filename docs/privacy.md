# 数据与隐私 / Data and privacy

适用范围：`0.1.0-alpha.1` 网页演示，包括 [GitHub Pages 在线版本](https://gaoyuan-0423.github.io/blot-workbench/)和本机运行方式。部署者若修改代码、增加分析服务或嵌入第三方脚本，应重新说明数据流。

## 当前数据流

- 在线页面、脚本及合成示例由 GitHub Pages 提供，浏览器会向托管方请求这些静态文件。本机运行时由本机开发/预览服务器提供文件；安装依赖会访问包源。这些请求与项目内容的处理是不同的数据流。
- 工作台状态在浏览器中处理与保存，当前只保留一个工作区。项目包导入读入浏览器；项目包和 CSV 导出由浏览器下载到用户选择的位置。
- 此演示没有账号、科研图像上传接口或远程模型分析流程，也没有真实 TIFF/PNG 导入能力。
- 浏览器保存不是加密保险箱或可靠备份。同一浏览器配置下有权限访问站点存储的人可能读取项目；清理站点数据可能删除它。

保存按钮或浏览器存储不承诺跨设备同步。导出的项目包可能包含名称、备注、ROI 和分析配置，分享前应检查内容。

GitHub Pages 托管方可能处理常规连接日志。本地计算不等于托管访问完全无网络，也不表示应用可以在未加载资源时离线使用。在线站点与本机地址的浏览器存储相互独立，迁移项目需导出并导入项目包。

## 验证承诺的边界

“没有数据上传功能”是本演示的设计范围。网络请求检查只覆盖测试记录中的演示操作，不等于对所有浏览器、扩展或部署进行了完整隐私审计。实际运行及覆盖范围见[验证记录](validation.md)。第三方浏览器扩展、托管平台和用户自行修改的部署不在应用代码的控制范围内。

## 未来 Wisp 适配

本地 MCP 只说明工具在本机运行，不保证其输出不会进入远程模型上下文。Wisp 官方文档说明图片附件和图片读取可能发给视觉模型，MCP App 也可更新下一轮文本/JSON 上下文。[模型配置](https://github.com/xuzhougeng/wisp-science/blob/main/docs/model-configuration.md)、[插件文档](https://github.com/xuzhougeng/wisp-science/blob/main/docs/feature-plugins.md)

因此未来应把独立网页/本地分析与可选聊天协助分开，并逐项说明原图、缩略图、样本标签、路径与结果是否会外发。当前没有这项集成，不宣称完成了其隐私验证。

## English summary

The [live demonstration](https://gaoyuan-0423.github.io/blot-workbench/) requests its page, scripts, and synthetic examples from GitHub Pages. Local startup serves those files from a local server, while installing dependencies requests packages from registries. Project state is handled in the browser; the app has no account, experimental-image upload endpoint, or remote-model workflow. The hosting provider may process ordinary connection logs. Local computation is neither a zero-network promise nor an encrypted-storage guarantee. Browser storage can be cleared and is not a backup. Hosted and local origins have separate storage; use project archives to migrate. Exported projects may contain labels, notes, and settings. Recorded network checks cover specific test workflows, not a full privacy audit. Future Wisp/MCP integration requires a separate data-flow review: local computation does not imply that outputs or image previews stay out of remote model context.
