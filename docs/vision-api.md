# 可配置视觉 API 接入 / Configurable vision API

适用：本机开发版本 `0.2.0-dev.1`。这是 API 接入阶段，不是完整的批量自动 WB 分析器；公开 `v0.1.0-alpha.1` 网页和下载包没有被替换。

## 启动和配置

在此开发分支的目录中，使用 Node.js 22.12 或更新的兼容版本：

```sh
npm ci
npm run local
```

打开终端显示的 `http://127.0.0.1:4318`，点击左侧“视觉 API 设置”。`npm run dev` 只启动原来的静态开发前端，不含 API 服务；需要配置时使用 `npm run local`。

1. 填写提供商给出的 **Base URL** 和支持图像输入的 **模型 ID**。Base URL 填到 API 前缀，例如 `https://api.example.com/v1`，不要带 `/chat/completions`、密钥、查询参数或片段；示例地址并非实际服务。公网服务须使用 HTTPS；本机模型可用 `http://127.0.0.1:端口/v1` 或 localhost。
2. 在 **API Key** 输入密钥并保存。保存只改变本机内存配置，不发送图片。无鉴权本机模型可以不填密钥。同一服务留空会保留现有密钥；更换协议/域名/端口不沿用旧密钥。服务只实现一种兼容协议，不保证每个提供商都支持。
3. 核对页面显示的目的服务和模型，再点 **发送合成图并测试**。程序发送自带的固定 6 泳道 PNG 和固定提示词，不发送当前项目、实验图片、样本名或泳道说明。调用可能按服务规则计费，程序不自动重试。
4. 返回合法候选矩形时展示数量及是否为 6。这个结果仅检查接口是否能收图并返回合法结构，**数量吻合不证明框选正确、科研准确或实验数据适用**。提示词要求响应 `{"bands":[{"x":48,"y":108,"width":72,"height":36}, ...]}`，坐标为这张 720×280 合成图的整数像素；模型不提供灰度值。
5. 可取消测试或清除配置。关闭设置会取消仍在等待的请求，但不能撤回服务已经收到的内容。服务重启后配置及密钥丢失，需要重填。

密钥不回显，不写入 localStorage/IndexedDB，不包含在项目包、日志或代码中。页面输入框在保存成功后清空，服务只返回 `keyConfigured`。配置版本改变后，旧页面不能在未刷新配置的情况下发送测试。

构建后可运行同一接口与生产静态资源：

```sh
npm run build
npm run local:preview
```

`WB_PORT` 可以覆盖默认端口。macOS/Linux：`WB_PORT=4319 npm run local`；Windows PowerShell：`$env:WB_PORT=4319; npm run local`。服务仅监听 `127.0.0.1`，必须从终端给出的同源地址操作。此阶段没有桌面安装器。

## API 与数据边界

- `GET /api/vision/config`：安全配置 `{baseUrl, model, keyConfigured, revision, protocol}`。
- `POST /api/vision/config`：`{baseUrl, model, apiKey?}`；省略 key 的保留规则如上，显式空 key 清除 key。
- `DELETE /api/vision/config`：清除配置与密钥。
- `POST /api/vision/test`：`{revision}`；服务器决定固定的合成输入，不接受图片/项目/任意提示词字段。
- 错误为固定结构 `{error:{code,message}}`，不回传提供商的原始错误正文。请求有大小限制、超时和取消，每次最多一个测试，运行中不能修改配置。

API 仅供本机同源网页使用；校验 Host、Origin/Fetch Metadata，不开放跨域配置，不跟随提供商重定向。公网静态页面只显示本机启动说明，不提供密钥输入，不尝试调用本机 API。

兼容范围为 Chat Completions 的 `model`、`messages`、`image_url` 输入，以及 `choices[0].message.content` 中的 JSON 文本输出；模型须支持 system 消息与图像输入。不强制供应商特有的结构化输出、温度或生成长度参数，生成行为与用量按供应商默认设置；本机的 60 秒超时和响应大小限制并不是计费上限。所有返回结果仍在本机按严格结构、整数坐标和边界校验，拒绝截断、拒答及无效结果，不自动更换模型或重试。尚未逐家验证兼容性。

用户的“全部图片一次导入＋泳道说明＋自动出图＋可手动调整”需求保留在[批量自动设计](automation-design.md)。当前接口是该流程的接入基础，真实 TIFF/PNG 位深解码、批量配对、自动定位评估和真实定量还需分别实现验证；不把此阶段界面冒充那些功能。

## 验证

```sh
npm run check
BROWSER_CHANNEL=chrome npm run test:vision:e2e
```

API 单元测试使用注入的假服务；浏览器集成测试启动仅监听本机的假视觉服务，贯穿网页、真实本机后端和上游请求。合成响应与 test-only key 不代表真实模型。本阶段没有真实供应商凭据，也未验证任意云端模型的定位准确率。运行记录见[接入验证记录](validation-vision-api.md)。

## English

Run `npm ci` and `npm run local` from the development branch, then open the printed loopback URL and select **Vision API settings**. Enter an API prefix, an image-capable model ID, and optionally a key. The only supported adapter is OpenAI-compatible Chat Completions with `image_url` input and JSON text output. Configuration is memory-only and saving does not call the model. Changing provider origin clears the old key; restarting the local service clears all settings.

**Send synthetic image & test** sends only the built-in six-lane PNG and a fixed prompt. It may incur provider charges. It never sends project data or accepts arbitrary image input. Valid JSON rectangles and a matching band count are interface checks, not scientific validation. Manual demo workflows remain available independently. Batch real-image quantification, high-bit-depth TIFF/PNG handling, and automatic figure output are separate future stages. The public Pages alpha is unchanged.
