# 数据与隐私 / Data and privacy

> **首版范围 / First-edition scope (2026-10-20):** 保留可选注册、登录和本地项目保存；不开放实验数据上传或云同步。跨电脑请导出、导入项目文件。Optional accounts and local projects are available; experimental-data uploads and cloud sync are disabled. Transfer projects between computers using exported project files.

本文说明 2026-10-20 开发版本的本地分析、可选账号、云项目保存与桌面封装。代码或本机测试通过不代表生产云服务已启用，也不代表桌面安装包已公开发布；实际状态以发布交接和验收记录为准。

This describes local analysis, optional accounts, cloud project saving, and desktop packaging in the 2026-10-20 development edition. Code and local tests do not establish production activation or a publicly released installer. Check the release handoff and acceptance record for actual service status.

## 默认本机分析与游客使用 / Local analysis and guest use

导入、像素测量和表格计算默认在本机完成，不因打开文件或改变参数而自动上传实验数据。账号不是分析的前提；游客可以通过“本地项目”下载和打开可恢复的项目包。单条带与快速模式刷新或关闭前应主动下载项目。完整 WB 原图模式与旧合成演示各有独立的当前工作区；确认打开另一个项目会替换对应工作区。

Imports, pixel measurements, and table calculations run on the device by default. Opening a file or changing settings does not automatically upload experimental data. Guests can download and open recoverable archives through **Local project** without an account. Download single-strip and quick-mode projects before refreshing or closing the page. Original-image WB and the legacy synthetic demo have separate current workspaces; confirming another project replaces the corresponding workspace.

项目包可能包含原始图片或表格、文件名、样本标签、备注、ROI、设置与结果，应按实验数据保管。历史状态中已丢失的原附件无法补回，会明确标注缺失。账号令牌、本机 API 密钥及病理 ONNX 模型权重不进入项目包；需要模型时须在本机重载。

Archives can include original images or tables, filenames, sample labels, notes, ROIs, settings, and results. Treat them as experimental data. Original attachments already lost from historical state cannot be reconstructed and are marked missing. Archives exclude account tokens, local API keys, and pathology ONNX model weights; reload models locally when needed.

内置网站示例、截图、公开测试文件与示例项目使用合成数据。用户导入或私有云保存的项目不会自动成为网站示例、预载数据或公开发布附件。

Built-in website examples, screenshots, public fixtures, and example archives use synthetic data. Imported or privately saved cloud projects do not automatically become website examples, preloaded data, or public release attachments.

## 未来可选云保存（首版关闭） / Optional future cloud saving (disabled in this edition)

仅未来明确启用云保存的部署才提供此功能。登录后的“保存当前分析到云端”会先准备快照；点击“确认上传”才把项目包上传到 WispLab 服务。原始图片或表格及可恢复分析状态会随包上传，不只是结果摘要。保存产生独立版本，不是持续后台备份。登录或查看版本记录不会自动上传当前数据；恢复需要明确选择“打开此版本”并确认替换。

Only a future deployment explicitly enabling cloud saves provides this feature. After sign-in, **Save current analysis to cloud** prepares a snapshot; **Upload project** explicitly sends its archive to WispLab. Original images or tables and recoverable analysis state are uploaded, not merely a result summary. Each save creates a separate version, not a continuous background backup. Signing in or viewing history does not automatically upload current data; restoring requires **Open this version** and replacement confirmation.

项目通过账号授权限制访问，其他普通账号无权读取；服务器管理员可以访问数据库与存储文件，**没有端到端加密**。归档项目不会立即删除历史文件或释放容量。只上传你有权存储的实验资料，不要把“私有”理解为管理员也无法读取。

Account authorization restricts access from other ordinary accounts. Server administrators can access the database and stored files; **there is no end-to-end encryption**. Archiving a project does not immediately erase history or reclaim capacity. Upload only data you are authorized to store; “private” does not mean inaccessible to administrators.

## 账号、来源与本机存储 / Accounts, origins, and local storage

账号使用用户名和密码；本版没有自动密码找回。密码用于用户主动发起的注册、登录或删除账号时的身份复核，不写入浏览器持久存储或项目包。默认登录在当前会话保存令牌；“记住登录”才持久保存令牌。普通退出清除本机令牌，“退出所有设备”撤销现有令牌；退出不会删除当前本机实验项目。

Accounts use a username and password, with no automated password recovery in this edition. Passwords are used for explicit registration, sign-in, or account-deletion reauthentication and are not written to persistent browser storage or archives. Login tokens are session-only by default; **Remember me** makes the token persistent. Ordinary sign-out clears the local token; **Sign out all devices** revokes existing tokens. Signing out does not delete the current local experiment.

2026-10-21 的本地候选版本已实现删除账号入口：再次验证当前密码后，删除该账号、关联服务器项目和文件并撤销登录，本机项目保留。该变更尚未部署，也未包含在已上传的 Mac 1.0.0 build 1 中。历史备份与系统日志的保留和删除流程仍待落实，不能将本地删除测试等同于历史备份已清除。技术支持与隐私请求联系：gaoyuan1799@163.com。

The local candidate dated 2026-10-21 supports account deletion after password reauthentication, removing the account and associated server projects/files while retaining local projects. This change is not deployed or included in uploaded Mac 1.0.0 build 1. Historical-backup and system-log retention/deletion procedures remain unresolved; local deletion tests do not establish backup erasure. Technical support and privacy contact: gaoyuan1799@163.com.

同一账号适用于各工具，但 GitHub Pages、自有域名及各子域名分别保存登录状态和本机项目，可能需要逐站登录。网页、本机服务与桌面来源的数据不会自动复制；首版跨电脑继续需导出／导入项目包；云保存／恢复尚未开放。清除站点数据、切换浏览器或删除桌面用户目录可能使本机项目不可用。浏览器存储不是加密保险箱或可靠备份，同一设备上有访问权限的人可能读取数据。

The same account works across tools, but GitHub Pages, the custom domain, and its subdomains keep separate login and local-project storage and may require separate sign-ins. Website, local-server, and desktop stores are not automatically copied. Continue elsewhere through archive export/import; cloud save/restore is disabled in this edition. Clearing site data, changing browsers, or deleting the desktop profile can make local projects unavailable. Browser storage is neither an encrypted vault nor a reliable backup; people with device access may be able to read it.

## 网页请求与可选视觉 API / Web requests and optional vision API

访问网页会请求静态页面、脚本和示例，托管方可能处理常规连接日志。本机启动由本机服务提供文件，安装依赖会访问包源。本机计算不等于完全没有网络请求，也不代表尚未下载的网页可以离线打开。

Websites request static pages, scripts, and examples; hosting providers may process ordinary connection logs. Local startup serves files locally, while dependency installation accesses package registries. Local computation is not a zero-network promise and does not make an unloaded website available offline.

WB 可选本机视觉 API 测试与云项目保存是不同的数据流。打开设置读取本机服务配置；保存配置不调用模型。只有主动点击“发送合成图并测试”，才发送固定合成 PNG 和提示词到用户配置的服务；当前实验图像、样本名、泳道文字和分析结果不进入该测试请求。服务可能计费，本机超时或取消不能保证已送达的请求未被处理或计费。

The optional local WB vision API test is separate from cloud saving. Opening settings reads local-service configuration; saving it does not call a model. Only **Send synthetic image & test** sends a fixed synthetic PNG and prompt to the configured provider. Current experimental images, sample names, lane labels, and results are excluded from this test request. Providers may charge; local timeout or cancellation cannot guarantee that a delivered request was not processed or billed.

视觉服务地址、模型名和密钥仅保留在本机服务运行期间的内存中，重启即清除；密钥不回传、不进入浏览器持久存储、日志、项目包或 GitHub。服务仅监听 `127.0.0.1` 并检查请求来源。托管网页没有该本机配置接口。WB 合成图测试的限制不代表其他工具或用户自配远程 AI 的统一数据政策。

The vision address, model, and key remain in local-service memory only and are cleared on restart. Keys are not returned or written to persistent browser storage, logs, archives, or GitHub. The service listens only on `127.0.0.1` and checks request origins. Hosted pages do not expose this local configuration interface. These WB synthetic-test limits do not establish a blanket policy for other tools or user-configured remote AI.

## 离线桌面实验版 / Experimental offline desktop

桌面封装读取安装包内资源，核心分析与本地项目操作可离线使用；首版不开放云同步。可选账号操作与用户主动调用的远程 AI 需要联网。PCR AI 解读可能发送样本名、基因名、实验设置、质量提示与计算结果到用户所选服务，不应视为匿名数据。选择记住 AI 配置时，密钥保存在本机应用存储，不是加密保险箱，也不进入项目导出。第三方处理和保留规则由所选服务决定。首版不包含 WB 本机视觉代理，远程 AI 不属于离线能力。工具使用单一 `app://wisplab/` 来源，存储键按工具区分；桌面不会自动导入网页浏览器的项目。

Desktop loads bundled resources, allowing core analysis and local project operations offline; cloud sync is disabled in this edition. Optional account operations and explicitly invoked remote AI require connectivity. PCR AI interpretation may send sample and gene names, experiment settings, quality flags and computed results to the selected provider; these are not necessarily anonymous data. Remembered AI keys are stored locally, not in an encrypted vault or project exports. The selected provider determines its processing and retention rules. The first edition does not include the WB local vision proxy; remote AI is not an offline feature. Tools share one `app://wisplab/` origin with tool-specific storage keys. Desktop does not automatically import a web browser's projects.

默认桌面构建未签名、未经 Apple 公证或 Windows 发布者验证。没有自动更新器；网站更新不会自动替换已安装应用，需要明确打包、发布并手动安装新版本。回滚前先导出项目，旧版可能不支持新版数据格式。本机 Mac 测试通过不代表 Windows 安装验收完成。详见[桌面说明](../desktop/README.md)与[发布交接](platform-cloud-desktop.md)。

Desktop builds are unsigned by default, without Apple notarization or Windows publisher verification. There is no automatic updater; website updates do not replace installed apps. New versions require explicit packaging, release, and manual installation. Export projects before rollback; older versions may not support newer formats. Local Mac tests do not establish Windows installation acceptance. See the [desktop guide](../desktop/README.md) and [release handoff](platform-cloud-desktop.md).

## 版本与验证边界 / Version and validation boundaries

历史 `0.1.0-alpha.1` 仅有合成演示，当时没有账号、实验图像上传或真实 TIFF/PNG 导入；这些历史限制不能描述当前开发版本。网络检查只覆盖记录中的操作，不是对所有浏览器、扩展、部署或管理员行为的完整隐私审计。第三方扩展、托管平台和自行修改的部署不在应用代码控制范围内。

Historical `0.1.0-alpha.1` was a synthetic-only demo without accounts, experimental-image upload, or real TIFF/PNG import. Those historical limits do not describe this development edition. Network checks cover recorded operations, not a full privacy audit of every browser, extension, deployment, or administrator. Third-party extensions, hosting providers, and modified deployments are outside the application code's control.

未来 Wisp/MCP 集成需要单独审核数据流：本机执行不保证输出或图像预览不会进入远程模型上下文。当前没有该集成，不宣称已完成其隐私验证。

Future Wisp/MCP integration requires a separate data-flow review: local execution does not guarantee that outputs or image previews stay out of remote model context. This integration is not implemented, and its privacy behavior is not claimed as validated.
