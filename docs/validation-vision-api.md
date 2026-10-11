# 视觉 API 接入验证记录

记录日期：2026-10-11（Asia/Shanghai）。版本：`0.2.0-dev.1`；源码对应本文件首次加入的 Git 提交。当前为开发分支，不是新的科研定量发行版。

## 本机实际执行

环境：macOS 27.0.1，Node.js 24.14.1。浏览器测试使用 Playwright 安装/识别的实际 Chrome 和 Microsoft Edge channel；未用本机结果推断 Windows 已通过。

| 命令/检查 | 实际结果 | 范围 |
| --- | --- | --- |
| `npm run check` | 36 项测试通过；TypeScript 与生产构建通过 | 18 项既有核心测试、18 项 API/静态文件测试 |
| `npm run test:scripts` | 12 项通过 | 原有发布包、许可清单和指标采集脚本 |
| `WB_E2E_PORT=4177 BROWSER_CHANNEL=chrome npm run test:e2e` | 7 项通过 | 项目、模板、失效标记、导出恢复与无图片上传的原有流程 |
| `WB_E2E_PORT=4178 BROWSER_CHANNEL=msedge npm run test:e2e` | 7 项通过 | 同上，Edge |
| `BROWSER_CHANNEL=chrome npm run test:vision:e2e` | 4 项通过 | 网页→真实本机后端→本机假供应商 |
| `BROWSER_CHANNEL=msedge npm run test:vision:e2e` | 4 项通过 | 同上，Edge |
| 实际页面检查 | 通过 | Codex in-app Chromium 打开生产预览，配置字段/数据说明正常显示，默认无服务和密钥 |

视觉集成测试覆盖：保存配置不调用上游；测试只发送固定合成 PNG；当前项目与样本标记不外发；配置查询和项目 ZIP 不含测试密钥；关闭重开配置；未保存时禁止测试；更换服务来源清除旧密钥；取消后恢复；英文清除配置；线上静态模式不显示密钥输入、不请求本机接口。

API 测试另覆盖错误消息不反射密钥、请求/响应大小、超时、过期配置、并发、重定向、坐标合法性、截断/拒答、空工具调用元数据兼容，以及静态文件路径和符号链接边界。没有记录真实密钥，没有调用真实供应商；假响应只用于验证接口和数据流，不是模型能力证据。

CI 已加入 Windows/macOS × Chrome/Edge 四组合，每组运行原有 7 项与新增 4 项浏览器测试。CI 的实际结果以对应 Pull Request 和 Actions 记录为准；此表仅记录本机已执行结果。

## 截图与限制

[设置页截图](screenshots/vision-api-settings.jpg)采集于 2026-10-11，`http://127.0.0.1:4318/`，macOS 27.0.1，Codex in-app Chromium 默认 1280×720 视窗，版本 `0.2.0-dev.1`。截图未编辑，服务和密钥均未配置，没有发送请求到模型。视窗下方还有可滚动的合成图测试区域；截图不代表模型连接已成功。

尚未验证真实供应商、真实图像自动定位、TIFF/PNG 原始位深解码、实际灰度定量、批量任务及自动出图。上述功能不能依据接口测试通过而宣称可用。
