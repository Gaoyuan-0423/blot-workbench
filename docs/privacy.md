# 数据与隐私 / Data and privacy

**当前范围（2026-10-25）：公开版本无需账号，不提供登录、注册或云端项目。默认分析与项目文件保存在本机，跨设备通过导出／导入继续；用户主动调用的可选 AI 数据传输见下文。**

**Current scope (2026-10-25): the public edition has no accounts, sign-in, registration or cloud projects. Default analysis and project files stay on the device; transfer work through export/import. Data sent by explicitly invoked optional AI features is described below.**

## 本机分析与本地项目 / Local analysis and local projects

导入、像素测量和表格计算默认在本机完成，不因打开文件或改变参数而自动上传实验数据。所有用户都可以通过“本地项目”下载和打开可恢复的项目包。单条带与快速模式刷新或关闭前应主动下载项目。完整 WB 原图模式与旧合成演示各有独立的当前工作区；确认打开另一个项目会替换对应工作区。

Imports, pixel measurements, and table calculations run on the device by default. Opening a file or changing settings does not automatically upload experimental data. Users can download and open recoverable archives through **Local project** without an account. Download single-strip and quick-mode projects before refreshing or closing the page. Original-image WB and the legacy synthetic demo have separate current workspaces; confirming another project replaces the corresponding workspace.

项目包可能包含原始图片或表格、文件名、样本标签、备注、ROI、设置与结果，应按实验数据保管。历史状态中已丢失的原附件无法补回，会明确标注缺失。账号令牌、本机 API 密钥及病理 ONNX 模型权重不进入项目包；需要模型时须在本机重载。

Archives can include original images or tables, filenames, sample labels, notes, ROIs, settings, and results. Treat them as experimental data. Original attachments already lost from historical state cannot be reconstructed and are marked missing. Archives exclude account tokens, local API keys, and pathology ONNX model weights; reload models locally when needed.

内置网站示例、截图、公开测试文件与示例项目使用合成数据。用户导入或私有云保存的项目不会自动成为网站示例、预载数据或公开发布附件。

Built-in website examples, screenshots, public fixtures, and example archives use synthetic data. Imported or privately saved local projects do not automatically become website examples, preloaded data, or public release attachments.

## 旧账号与本机存储 / Previous accounts and local storage

公开前端不再联系账号服务，也不会读取或发送旧令牌。启动时仅删除旧版本的账号令牌专用键，实验项目、语言偏好、本机 AI 配置和 IndexedDB 保持不变。此清理不等于删除服务器历史账号或备份；相关隐私请求请联系 gaoyuan1799@163.com，历史数据仍按已公布的保留和删除要求处理。

The public frontend no longer contacts the account service or reads/sends old tokens. Startup removes only the previous edition's dedicated token keys; experiments, language preferences, local AI settings and IndexedDB remain intact. This local cleanup does not delete historical server accounts or backups. Contact gaoyuan1799@163.com for privacy requests; previously published retention and deletion obligations continue to apply.

GitHub Pages、自有域名及各子域名、网页、本机服务与桌面分别保存本机项目，不会自动复制。跨电脑请导出／导入项目包。清除站点数据、切换浏览器或删除桌面用户目录可能使项目不可用。浏览器存储不是加密保险箱或可靠备份，同一设备上有访问权限的人可能读取数据。

GitHub Pages, custom domains, subdomains, local servers and desktop have separate project stores. They do not copy projects automatically. Transfer projects using exported archives. Clearing site data, changing browsers or deleting the desktop profile can make projects unavailable. Browser storage is neither an encrypted vault nor a reliable backup; people with device access may be able to read it.

## 网页请求与可选视觉 API / Web requests and optional vision API

访问网页会请求静态页面、脚本和示例，托管方可能处理常规连接日志。本机启动由本机服务提供文件，安装依赖会访问包源。本机计算不等于完全没有网络请求，也不代表尚未下载的网页可以离线打开。

Websites request static pages, scripts, and examples; hosting providers may process ordinary connection logs. Local startup serves files locally, while dependency installation accesses package registries. Local computation is not a zero-network promise and does not make an unloaded website available offline.

WB 完整工作区的“视觉服务（自带 API）”使用用户自行配置的服务地址、模型与 API Key，由网页或桌面应用直接请求所选服务，不经 WispLab 账号服务器。打开设置或保存配置不调用模型。主动发起视觉候选请求时，会发送当前图像的降采样预览（8 位灰度 PNG）、泳道标签、数量和信号极性；批量请求逐张处理所选图像。图片和标签可能包含实验信息，不能视为匿名数字摘要。默认本地取样和像素测量不依赖此功能；视觉候选仍需人工复核，定量继续使用本机原始像素。

The full WB workspace's **Vision service (your own API)** uses a service address, model and API key configured by the user. Requests go directly from the website or desktop app to the selected provider, without passing through a WispLab account server. Opening settings or saving configuration does not call a model. An explicitly invoked vision-candidate request sends a downscaled preview of the current image (8-bit grayscale PNG), lane labels, lane count and signal polarity; batch requests process selected images individually. Images and labels may contain experimental information and are not merely anonymous numeric summaries. Default local region proposals and pixel measurements do not require this feature. Vision candidates still need manual review, and measurements continue using local original pixels.

“发送合成图测试”是单独的连接测试，只发送内置合成小图和测试提示，不发送当前实验图像、样本名、泳道标签或分析结果。它的限制不适用于正式视觉候选请求。所选供应商的数据处理、保留与计费受其政策和用户与其的约定约束；本机超时或取消不能保证已送达的请求未被处理或计费。

**Send synthetic test** is a separate connectivity test. It sends only a built-in synthetic image and test prompt, excluding current experimental images, sample names, lane labels and results. Those limits do not apply to actual vision-candidate requests. The provider's processing, retention and billing follow its policies and the user's agreement with it. Local timeout or cancellation cannot guarantee that a delivered request was not processed or billed.

WB 视觉服务地址、模型名和密钥默认只保存在当前页面内存，刷新即清；明确选择“在此设备记住”时才以明文写入本机 `localStorage`。已记住的副本会持续保留，需点击“清除已保存”同时删除持久副本和内存配置；仅取消勾选并保存不会删除已有副本。请求使用该密钥向所选服务认证，项目导出不包含密钥。本机存储不是加密保险箱，请勿在共用设备上记住密钥。

WB vision settings and keys stay in current-page memory by default and clear on refresh. Explicitly selecting **Remember on this device** stores the service address, model and key as plaintext in local `localStorage`. An existing remembered copy remains until **Clear saved** deletes both the persistent copy and in-memory configuration; unchecking the option and saving does not remove an earlier copy. Requests use the key to authenticate with the selected provider; project exports exclude it. Local storage is not an encrypted vault. Do not remember keys on shared devices.

## 离线桌面实验版 / Experimental offline desktop

桌面封装读取安装包内资源，核心分析与本地项目操作可离线使用；不提供账号或云同步。用户主动调用的远程 AI 需要联网；WB 直接视觉请求及密钥存储规则同上。PCR AI 解读可能发送样本名、基因名、实验设置、质量提示与计算结果到用户所选服务，不应视为匿名数据。选择记住 AI 配置时，密钥保存在本机应用存储，不是加密保险箱，也不进入项目导出。第三方处理和保留规则由所选服务决定。首版不包含 WB 本机视觉代理，远程 AI 不属于离线能力。工具使用单一 `app://wisplab/` 来源，存储键按工具区分；桌面不会自动导入网页浏览器的项目。

Desktop loads bundled resources, allowing core analysis and local project operations offline; accounts and cloud sync are unavailable. Explicitly invoked remote AI requires connectivity; the WB direct-request and key-storage rules above also apply. PCR AI interpretation may send sample and gene names, experiment settings, quality flags and computed results to the selected provider; these are not necessarily anonymous data. Remembered AI keys are stored locally, not in an encrypted vault or project exports. The selected provider determines its processing and retention rules. The first edition does not include the WB local vision proxy; remote AI is not an offline feature. Tools share one `app://wisplab/` origin with tool-specific storage keys. Desktop does not automatically import a web browser's projects.

默认桌面构建未签名、未经 Apple 公证或 Windows 发布者验证。没有自动更新器；网站更新不会自动替换已安装应用，需要明确打包、发布并手动安装新版本。回滚前先导出项目，旧版可能不支持新版数据格式。本机 Mac 测试通过不代表 Windows 安装验收完成。详见[桌面说明](../desktop/README.md)与[发布交接](platform-cloud-desktop.md)。

Desktop builds are unsigned by default, without Apple notarization or Windows publisher verification. There is no automatic updater; website updates do not replace installed apps. New versions require explicit packaging, release, and manual installation. Export projects before rollback; older versions may not support newer formats. Local Mac tests do not establish Windows installation acceptance. See the [desktop guide](../desktop/README.md) and [release handoff](platform-cloud-desktop.md).

## 版本与验证边界 / Version and validation boundaries

历史 `0.1.0-alpha.1` 仅有合成演示，当时没有账号、实验图像上传或真实 TIFF/PNG 导入；这些历史限制不能描述当前开发版本。网络检查只覆盖记录中的操作，不是对所有浏览器、扩展、部署或管理员行为的完整隐私审计。第三方扩展、托管平台和自行修改的部署不在应用代码控制范围内。

Historical `0.1.0-alpha.1` was a synthetic-only demo without accounts, experimental-image upload, or real TIFF/PNG import. Those historical limits do not describe this development edition. Network checks cover recorded operations, not a full privacy audit of every browser, extension, deployment, or administrator. Third-party extensions, hosting providers, and modified deployments are outside the application code's control.

未来 Wisp/MCP 集成需要单独审核数据流：本机执行不保证输出或图像预览不会进入远程模型上下文。当前没有该集成，不宣称已完成其隐私验证。

Future Wisp/MCP integration requires a separate data-flow review: local execution does not guarantee that outputs or image previews stay out of remote model context. This integration is not implemented, and its privacy behavior is not claimed as validated.
