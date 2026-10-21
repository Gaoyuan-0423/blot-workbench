# Mac App Store preparation / 商店版准备

**Xcode、三类签名身份及开发/商店描述文件已准备好，两种目标的预检均已通过。下一步完成签名构建和真实沙箱验收；当前尚无已验证的签名构建，未上传或提审。**

**Xcode, all three signing identities and development/store profiles are ready; both targets have passed preflight. Signed builds and real sandbox acceptance are next. No verified signed build, upload or submission is claimed.**

## 已知状态 / Current handoff

| 项目 / Item | 2026-10-21 状态 / Status |
| --- | --- |
| App Store Connect | 已创建 WispLab，macOS 1.0 / App record and macOS 1.0 created |
| Apple ID（应用编号 / app identifier） | `6825229877` |
| Bundle ID | `top.wisplab.desktop` |
| Team ID | `29RXSR5JXC` |
| 本机工具 / Local tools | Xcode `27.1`（`27A9275`）已初始化 / initialized |
| 本机身份 / Local identities | Apple Development、Apple Distribution、Mac Installer Distribution 均有效 / all three identities valid |
| 描述文件 / Provisioning profiles | 开发和商店 profiles 已生成并通过预检 / both profiles created and preflight passed |

后台应用记录不等于签名能力。现有 `package:mac` 仍是独立的未签名实验版流程；MAS 使用单独配置 `desktop/mas/config.cjs`。

An App Store record does not provide local signing credentials. The existing `package:mac` experimental distribution remains separate from the MAS configuration.

## 1. Xcode、证书与描述文件 / Xcode, certificates and profiles

1. 所有者安装并首次启动受支持的完整 Xcode，完成其初始化；在 **Settings → Accounts / Apple Accounts** 登录 Apple 账号，选择团队 `29RXSR5JXC`，进入 **Manage Certificates**。在 **Settings → Locations** 选择该 Xcode 的 Command Line Tools。
2. 准备下表证书，确保钥匙串中同时存在证书及其匹配私钥；只有下载的 `.cer` 文件不足以签名。需要的权限由团队所有者管理，不要撤销已有证书来尝试排错。
3. 在 Apple Developer 的 Certificates, Identifiers & Profiles 确认显式 App ID 对应 `top.wisplab.desktop`。开发 profile 选择开发证书并包含测试 Mac；商店 profile 选择对应的分发证书。下载后保存在仓库外，通过绝对路径传入构建。

The owner installs and opens full Xcode, signs in under Accounts, selects the team and manages certificates. Keep each certificate with its matching private key. Create profiles for the exact bundle ID; development profiles must include the test Mac. Store credentials and profiles outside Git.

| 用途 / Purpose | 签名证书 / Certificate | Profile / 输出用途 |
| --- | --- | --- |
| `mas-dev` 本机沙箱测试 | Apple Development | Mac App Development；仅已登记的测试 Mac / registered test Macs |
| `mas` 应用签名 | Apple Distribution | Mac App Store Connect；供 Apple 处理 / for Apple processing |
| `mas` 安装包签名 | Mac Installer Distribution | 签 `.pkg`；钥匙串常显示 `3rd Party Mac Developer Installer` / signs the installer |

两种目标都必须使用 Electron 的 MAS 构建。`mas-dev` 不可作为商店提交包；商店分发签名的 `.app` 不作为本机双击测试包，安装测试应走 Apple 分发的 TestFlight。Developer ID 是商店外分发路线。[Electron MAS guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)、[Apple certificate types](https://developer.apple.com/help/account/certificates/certificates-overview/)

Both targets use Electron's MAS build. Use `mas-dev` for registered local machines and the Apple-delivered TestFlight build for distribution testing; do not assess a store-signed `.app` by launching it directly.

独立 MAS 配置对 `mas-dev` 和 `mas` 均设置 `timestamp: 'none'`。Apple 在商店接收时检查分发证书有效性，随后重新签名；这条渠道不依赖安全时间戳。Developer ID 商店外分发及公证仍要求安全时间戳，本设置不应用于普通 macOS 构建。参见 [Apple 签名指导](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)与 [TN3161 证书有效期说明](https://developer.apple.com/documentation/technotes/tn3161-inside-code-signing-certificates)。

The isolated MAS configuration sets `timestamp: 'none'` for both targets. Apple checks the distribution certificate at submission and re-signs the app. Developer ID distribution and notarization still require secure timestamps; this setting does not apply to the ordinary macOS build configuration. See the Apple signing guidance and TN3161 linked above.

Profile 创建步骤：[development](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile/)、[Mac App Store Connect](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)。仅有 API 上传密钥不能替代应用签名私钥。

## 2. 预检与构建 / Preflight and build

从 WB 仓库根目录运行。`mas:preflight` 只读检查，不签名、不上传；缺少 Xcode、身份或 profile 时应报告未就绪。

Run from the WB repository root. Preflight checks readiness without signing or uploading; missing prerequisites must remain a failure, not an unsigned fallback.

```sh
# 先检查开发环境 / Check development prerequisites first
WISPLAB_MAS_PROFILE='/absolute/path/WispLab-development.provisionprofile' \
  npm --prefix desktop run mas:preflight -- --target mas-dev

# 开发预检通过后 / Only after development preflight passes
WISPLAB_MAS_PROFILE='/absolute/path/WispLab-development.provisionprofile' \
  npm --prefix desktop run package:mas-dev

# 商店预检；替换为分发 profile / Store check with a distribution profile
WISPLAB_MAS_PROFILE='/absolute/path/WispLab-store.provisionprofile' \
  npm --prefix desktop run mas:preflight -- --target mas

# 全部验收后才构建商店包；此命令本身不上传 / Build only, no upload
WISPLAB_MAS_PROFILE='/absolute/path/WispLab-store.provisionprofile' \
WISPLAB_MAS_VERSION='1.0.0' WISPLAB_MAS_BUILD_NUMBER='1' \
  npm --prefix desktop run package:mas
```

| 参数 / Parameter | 约定 / Contract |
| --- | --- |
| `WISPLAB_MAS_PROFILE` | 必填，profile 绝对路径 / required absolute profile path |
| `WISPLAB_MAS_VERSION` | 默认 `1.0.0`；上传前核对 ASC 平台版本与包版本 / verify against the ASC version |
| `WISPLAB_MAS_BUILD_NUMBER` | 默认 `1`，整数 `1..9999`；每次新上传递增 / increment for each new upload |
| `WISPLAB_MAS_ARCH` | 默认 `universal`，也支持 `arm64`、`x64` / supported architectures |
| `CSC_KEYCHAIN` | 可选，专用钥匙串绝对路径 / optional dedicated keychain path |
| 产物 / Outputs | `desktop/out/mas-dev/`、`desktop/out/mas-store/` |

签名身份从本机钥匙串读取，不支持通过 `CSC_LINK` 导入证书。/ Signing uses local keychain identities; `CSC_LINK` certificate import is unsupported.

资源准备沿用 [README 的 staging 流程](README.md#local-development--本机开发)。开发目标可用 local 资源；商店目标只接受 `stage.py ci` 暂存的、来源和哈希验证通过的三工具构建。预检会检查目标证书、团队、profile 内证书对应关系及资源来源；构建成功仍不能代替下面的真实沙箱验收。

Reuse the existing staging workflow. Development accepts local resources; store builds require verified `stage.py ci` inputs for all three tools. Passing build checks does not establish sandbox runtime correctness.

## 3. 项目迁移与真实沙箱验收 / Migration and sandbox acceptance

实验版与商店版拥有不同应用身份和数据容器。先在 **WispLab Experimental** 各工具中导出完整项目，保留备份；在签名沙箱版通过文件选择器导入并复核。CSV、图片、统计报表不能替代完整项目。不要复制 Chromium profile 或删除旧数据目录；同一账号登录不迁移项目。

Export full projects from each experimental tool, retain backups, then import them through the sandboxed app's file picker. Browser profiles and account sign-in are not project migration mechanisms.

在真实签名 `mas-dev` 上逐项记录结果，并在 TestFlight 安装版复验。普通 Playwright / Electron smoke、单元测试和未签名 `.app` 不能证明 App Sandbox 的真实文件授权。不要为满足自动化调试器而添加 `com.apple.security.network.server`。

Record each check on signed `mas-dev`, then repeat on the TestFlight installation. Ordinary Playwright / Electron smoke tests do not prove sandbox file authorization. Do not add the network-server entitlement just to enable an automation debugger.

- [ ] 断网启动首页及 WB / 病理 / PCR；本地分析、Worker/WASM 正常，不要求登录。/ Launch all three tools offline; local computation and workers work without login.
- [ ] 原生对话框从用户选择的位置导入图片、表格、项目；取消、拒绝权限、中文和空格路径能正常处理。/ Test file selection, cancellation, denied access and non-ASCII paths.
- [ ] 原生保存对话框导出项目、CSV、图版、HTML/ZIP；重新导入，核对原图字节、ROI、计算结果和图版设置。/ Save, reopen and compare originals, measurements and presentation settings.
- [ ] 完全退出后重启，项目与语言仍在；更新后旧项目可恢复；实验版数据仍保留。/ Verify persistence, update recovery and preservation of experimental data.
- [ ] 外链确认、可选账号联网失败、注销与后续删除账号流程分别验证；不能靠扩大沙箱权限掩盖问题。/ Check external links and account error/deletion flows without broadening permissions to hide failures.
- [ ] 在拟支持的 Apple Silicon / Intel、最低支持 macOS 上实际安装运行；保存签名、entitlements、profile 与测试记录。/ Test supported hardware and OS versions, retaining signing and runtime evidence.

## 4. TestFlight 与提审待办 / TestFlight and submission blockers

确认构建来源、版本号和真实沙箱验收后，由有权限的所有者使用 Transporter 上传签名 `.pkg` 到上述应用；检查上传日志和 Apple 处理状态，再选择 TestFlight 构建、补充测试说明并安排内部测试。上传成功、TestFlight 可用和正式审核通过是三个不同状态；本流程不自动上传或发布。[Apple upload guidance](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)

An authorized owner uploads the signed package with Transporter, checks processing results and then configures TestFlight testing. Upload success is not App Review approval; these scripts do not publish.

- **账号删除尚未完成**：当前提供注册/登录，缺少已验收的应用内发起删除账号流程；需完成服务端删除及身份校验、用户确认、状态反馈，或先明确调整商店版本的账号范围。退出登录不等于删除账号。[Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
- **隐私材料待所有者核实**：准备公开隐私政策 URL、应用内入口、支持联系方式；依据实际账号服务、网络日志、第三方服务和 SDK 行为核对隐私披露及所需 privacy manifest。不要由“本地分析”推导“无数据收集”，也不要替所有者作未经核实的承诺。[Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- **商店材料待完成**：图标与真实 Mac 截图、中英描述、支持 URL、审核备注与需要时的测试账号；所有者确认内容权利、年龄分级、加密出口合规、定价和协议等问卷。按实际功能描述科研用途，不作未经验证的临床或准确性声明。

Open blockers: implement and verify account deletion if registration remains; the owner must approve an accurate privacy policy and disclosures based on actual services and SDKs. Prepare store screenshots, descriptions, support details and review access. Rights, age rating, export compliance, pricing and legal questionnaires remain owner decisions, not completed answers in this handoff.
