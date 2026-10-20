# WispLab desktop / 桌面实验版

This is an **experimental, unsigned** offline desktop distribution. The renderer loads installed application files, never the live website. / 这是**未签名实验版**：应用读取安装包内的真实资源，启动与核心分析不依赖在线网站。

**First release: optional accounts and local project files only.** Signing in does not upload images, tables, results or project archives, and does not synchronize experiments between computers. Export a project file on one device and import it on the other. Cloud project storage remains disabled; retained cloud code is for a separately reviewed future opt-in.

**首版范围：账号可选，项目保存在本地。** 注册、登录不会上传实验数据，也不提供跨设备同步。更换电脑或在网页与桌面之间迁移时，请使用项目文件导出／导入。游客核心分析和本地项目无需账号或网络。

## Source and release contract / 源码与版本

The three tools keep their existing source repositories. Desktop packaging consumes their existing `web-dist` build artifacts; it does not maintain a second copy of analysis code.

| Route | Source repository | Bundled resources |
| --- | --- | --- |
| `app://wisplab/` | `Gaoyuan-0423/blot-workbench` | `deployment/wisplab/portal/` from the pinned WB commit |
| `app://wisplab/wb/` | `Gaoyuan-0423/blot-workbench` | successful CI `web-dist` |
| `app://wisplab/pathology/` | `Gaoyuan-0423/pathology-workbench` | successful CI `web-dist` |
| `app://wisplab/pcr/` | `Gaoyuan-0423/pcr-workbench` | successful CI `web-dist` |

CI input requires three complete, lowercase 40-character commit SHAs. It rejects branches, tags, short hashes and `latest`. The complete CI must have succeeded on `main` at the requested SHA. Existing release helpers verify the artifact digest and archive paths before copying files. The portal comes from that same WB commit and Git blob hashes are checked. All source SHAs, CI runs, artifact digests and individual file SHA256 values are in `resources/release.json` and shipped with the app.

网页版、GitHub Pages 和桌面版共用各工具仓库的源码与 CI 构建。改分析功能仍改原仓库；桌面壳与打包流程只改本目录。桌面安装包发布是独立的明确步骤，不会随网站更新静默替换用户本机应用。

## Local development / 本机开发

Run from the WB repository root, with dependencies already installed in all three source checkouts:

```sh
npm ci --prefix desktop
python3 desktop/scripts/stage.py local \
  --pathology /absolute/path/to/pathology-workbench \
  --pcr /absolute/path/to/pcr-workbench \
  --build --allow-dirty
npm test --prefix desktop
python3 -m unittest discover -s desktop/test -p 'test_*.py'
npm run test:smoke --prefix desktop
npm start --prefix desktop
```

Use `--allow-dirty` only for development. This is explicitly recorded as `mode: local`, `buildOrigin: local-development`, and `dirty` per source. Omit that flag for clean checkouts. Omitting `--build` combines existing dist files for quick testing; those bytes may be older than the checkout, and the manifest records `builtBeforeStaging: false`. Such a local package is not evidence of successful CI. Run `--build` after every source change. Do not delete user browser/app profiles to fix a package; staging only replaces its own generated `desktop/resources/` directory.

The smoke check launches real Electron with a temporary profile, disables HTTP(S), imports synthetic WB/IHC images, exercises the pathology worker, calculates bundled PCR data, exports results, checks local navigation and storage, and writes screenshots/results under `desktop/reports/`. It fails if these guest/local workflows attempt any HTTP(S) request, including a capability or account API request. Its export interception exists only in the test process; product exports use native Save dialogs. Account login is an optional online workflow and requires separate service acceptance; it is not a prerequisite for this offline suite.

After packaging, run `npm run test:packaged --prefix desktop` on that target platform. It launches the actual `.app`/EXE, checks the isolated temporary profile, and repeats the offline suite with `app.isPackaged: true`. CI runs this before retaining installers. This verifies the installed resource layout; it does not certify an OS signature or bypass installation warnings.

Windows packaged testing handles a Playwright startup race: the first custom-protocol page can finish loading before Playwright observes its navigation event. The test connects only to its disposable process's loopback DevTools endpoint, verifies the local portal URL, complete document, visible heading and three local tool links, captures `packaged-before-reload.png`, then reloads that rendered page once. Blank or failed pages fail this check. The actual packaged executable, `app.asar`, sandbox and all 13 subsequent assertions remain in use. This helper and its debugging connection are excluded from the distributed app.

## CI packages / 可安装版本

Use the `Desktop packages (unsigned experimental)` workflow with the three exact tested SHAs. No publication or deployment happens automatically; workflow outputs remain versioned GitHub Actions artifacts for 30 days. Retain chosen installers, manifest and checksums in a deliberate GitHub Release before artifact expiry.

```sh
gh workflow run desktop.yml --repo Gaoyuan-0423/blot-workbench \
  -f wb_sha=FULL_40_CHARACTER_WB_SHA \
  -f pathology_sha=FULL_40_CHARACTER_PATHOLOGY_SHA \
  -f pcr_sha=FULL_40_CHARACTER_PCR_SHA
```

For local staging of those same successful CI bytes, with `gh` authenticated:

```sh
python3 desktop/scripts/stage.py ci \
  --wb-sha FULL_40_CHARACTER_WB_SHA \
  --pathology-sha FULL_40_CHARACTER_PATHOLOGY_SHA \
  --pcr-sha FULL_40_CHARACTER_PCR_SHA
```

`WISPLAB_ARTIFACT_TOKEN` is an optional Actions secret for cross-repository artifact reads when the run's default `GITHUB_TOKEN` cannot read the other repositories. Use a token scoped to these three repositories with Contents read and Actions read; no write/deploy/admin permission is needed. Authentication errors stop packaging. Credentials are not bundled or printed.

| Runner | Output |
| --- | --- |
| Windows x64 | NSIS installer and portable EXE |
| macOS Apple Silicon | arm64 DMG and ZIP |
| macOS Intel | x64 DMG and ZIP |

本机 Mac 可以运行 `npm run package:mac --prefix desktop -- --arm64`；Intel 使用 `--x64`，但运行验证应在对应架构完成。Windows 包由 Windows runner 构建和验证。本机未执行的 Windows CI 不能报告为已经通过。每个目标先通过单元与 Electron 离线 smoke，才生成安装包；之后 `npm run checksums --prefix desktop` 写出 SHA256 清单。

Native icons reuse the portal's indigo WispLab logo. `build/icon.png` is a committed rasterization of `deployment/wisplab/portal/favicon.svg`; when that source changes, run `npm run icons --prefix desktop` with Playwright Chromium installed, then review the regenerated icon. Windows resource editing remains enabled for the icon and product metadata; code signing is explicitly disabled with `signExecutable: false`.

The Windows installer includes English and Simplified Chinese and follows the OS locale. Native save dialogs and menus also follow the OS language; the tool pages keep their shared Chinese/English preference.

## Security and offline scope / 安全与离线范围

- Standard secure origin `app://wisplab` supports relative Vite assets, Workers, fetch, IndexedDB and localStorage. The protocol allows only four bundled roots, allowed file extensions and GET/HEAD; resolved real paths cannot escape their root. Requests for unknown files return 404.
- `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`. Webviews, child windows, remote renderer navigation and permission prompts are disabled. CSP disallows inline/remote scripts; bundled WASM and module workers are allowed.
- Preload exposes only `window.wispLabDesktop.isDesktop` and `getAppVersion()`. It exposes no filesystem, shell, token, process or arbitrary IPC API. Version IPC validates the trusted main frame.
- Exports are existing browser Blob downloads. Only this app's trusted main-window initiator is accepted, then Electron presents the native save dialog. Existing file inputs support project/image/table imports. Imported project archives pass each tool's existing strict validator and require replacement confirmation.
- External HTTP(S) links require confirmation and are limited to the WispLab/GitHub host allowlist. Files, arbitrary schemes and popup windows do not launch. The shell does not disable TLS checks, macOS Gatekeeper, Windows SmartScreen or any OS security setting.
- Core WB raster analysis, pathology classical image analysis, PCR calculation and local projects are offline. Pathology optional ONNX requires the user to provide a compatible local model; WASM runtime assets are bundled. Opening the optional account controls requires a connection; signing in does not enable experimental data upload in this release. Remote AI availability is limited by each tool's existing CSP and service setup: the desktop package includes no local vision proxy, so WB workflows requiring that proxy are unavailable. Do not count remote AI as an offline feature or bypass CSP to enable it. None of these services are prerequisites for local analysis.
- The optional account service is `https://wisplab.top`, using the shared platform client with Bearer token authorization and `credentials: omit`. It stores account credentials as password hashes and operational account data, not experimental project files in this release. The package contains no user password or server secret. Existing optional AI providers are limited by `connect-src`; adding a provider requires reviewing that allowlist, not disabling CSP.
- Project capability defaults to `projectStorage: "local"` if the service is unknown or offline. The first deployment keeps `WISPLAB_PROJECT_STORAGE=local`; the client disables cloud project operations and the accounts-only server proxy blocks project/file routes. Retained cloud code is inactive. Enabling it later requires a separate decision, server configuration and upload/privacy/quota/backup acceptance; changing the desktop's network allowlist alone does not enable cloud storage.

## Storage, updates and rollback / 保存、更新与回滚

Websites and desktop have separate origin storage. Browser IndexedDB data is not silently copied to desktop. Use the local project export/import entry to transfer a project file between devices or between the website and desktop. Signing in to the same account does not transfer projects; there is no cloud backup in this release. All three local tool routes share the desktop origin, but existing project storage keys are tool-specific. Language preference can be shared. Electron uses the product name for its profile: normally `~/Library/Application Support/WispLab Experimental` on macOS and `%APPDATA%\WispLab Experimental` on Windows, with a persistent `wisplab-desktop` partition. The portable EXE also retains data there. Do not rename the product/profile directory in a future release without a data-migration plan. See [Electron app paths](https://www.electronjs.org/docs/latest/api/app/).

无自动更新器：发布新版本后由用户下载安装；保留上一版安装包、`release.json` 和 SHA256 清单即可回退程序。回退之前导出需要保留的项目；旧版可能不支持新版项目格式。恢复旧安装包不等于自动降级项目数据。卸载/更新时不要主动删除用户数据目录。

## Signing status / 签名状态

The default config does not sign or notarize. macOS distribution outside a development machine may be blocked or warned about by Gatekeeper; Windows may show an unknown publisher/SmartScreen warning. No bypass instructions or automated security changes are provided. Public, warning-reduced distribution needs a valid Apple Developer ID certificate and notarization for macOS, and an appropriate Windows code-signing identity; that is a separate release configuration with protected CI secrets. Building an unsigned package does not establish that it will install without warnings on another machine.

Official references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocols](https://www.electronjs.org/docs/latest/api/protocol), [download items](https://www.electronjs.org/docs/latest/api/download-item), [macOS signing](https://www.electronforge.io/guides/code-signing/code-signing-macos), [Windows signing](https://www.electronforge.io/guides/code-signing/code-signing-windows), [GitHub runner architectures](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).
