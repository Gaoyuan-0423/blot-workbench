# 数据与隐私 / Data and privacy

适用范围：本地 `0.1.0-alpha.1` 网页演示。本次没有托管部署。未来部署者若修改代码、增加分析服务或嵌入第三方脚本，应重新说明数据流。

## 当前数据流

- 当前页面、脚本及合成示例由本机开发/预览服务器提供。安装依赖会访问包源；这与在浏览器中处理项目是不同的数据流。
- 工作台状态在浏览器中处理与保存，当前只保留一个工作区。项目包导入读入浏览器；项目包和 CSV 导出由浏览器下载到用户选择的位置。
- 此演示没有账号、科研图像上传接口或远程模型分析流程，也没有真实 TIFF/PNG 导入能力。
- 浏览器保存不是加密保险箱或可靠备份。同一浏览器配置下有权限访问站点存储的人可能读取项目；清理站点数据可能删除它。

保存按钮或浏览器存储不承诺跨设备同步。导出的项目包可能包含名称、备注、ROI 和分析配置，分享前应检查内容。

未来若授权部署到 GitHub Pages，浏览器会向托管服务请求页面与静态文件，托管方可能处理常规连接日志。本地计算不等于托管访问完全无网络；本次尚未进行该部署。

## 验证承诺的边界

“没有数据上传功能”是本演示的设计范围。发布验证还应记录浏览器网络请求，确认导入、编辑和导出时没有项目内容离开浏览器。没有记录的网络检查不能称为完成审计。第三方浏览器扩展、托管平台和用户自行修改的部署不在应用代码的控制范围内。

## 未来 Wisp 适配

本地 MCP 只说明工具在本机运行，不保证其输出不会进入远程模型上下文。Wisp 官方文档说明图片附件和图片读取可能发给视觉模型，MCP App 也可更新下一轮文本/JSON 上下文。[模型配置](https://github.com/xuzhougeng/wisp-science/blob/main/docs/model-configuration.md)、[插件文档](https://github.com/xuzhougeng/wisp-science/blob/main/docs/feature-plugins.md)

因此未来应把独立网页/本地分析与可选聊天协助分开，并逐项说明原图、缩略图、样本标签、路径与结果是否会外发。当前没有这项集成，不宣称完成了其隐私验证。

## English summary

This demonstration currently serves assets from a local development/preview server and handles project state in the browser. No hosted application has been deployed. Dependency installation requests packages from registries; a future hosted deployment would request static assets from its hosting provider. The app has no account, experimental-image upload endpoint, or remote-model workflow. This is not an encrypted-storage guarantee. Browser storage can be cleared and is not a backup. Exported projects may contain labels, notes, and settings. Future Wisp/MCP integration requires a separate data-flow review: local computation does not imply that outputs or image previews stay out of remote model context.
