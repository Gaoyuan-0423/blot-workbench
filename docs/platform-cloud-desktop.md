# WispLab accounts, local projects and desktop handoff / 账号、本地项目与桌面版交接

2026-10-20 first-release scope: **optional accounts and local project files; cloud experiment upload and synchronization are disabled**. Production activation and signed desktop distribution are separate acceptance steps; do not infer either from a successful local build.

首版只开放可选账号和本地项目管理。登录不会上传原图、实验表格、结果或项目包，也不会把实验自动同步到其他电脑。跨设备、网页与桌面之间通过项目文件导出／导入。下文保留后续云存储实现的维护位置，但不代表首版已开放此功能。

## What is shared

The portal and all tools display **WispLab实验数据分析平台 / WispLab Experimental Data Analysis Platform**. Chinese / EN remains persistent. Accounts are optional. Guest analysis and local project downloads remain available without contacting the account service.

An account identifies the same user across the suite. It does not store experiments in this release. Export a recoverable local project file, transfer it yourself, then import it on the other computer or site. Keep a separate copy of important project files; signing in is not a backup.

Browser login storage is isolated by website origin, so a browser may need to sign in on each tool address. The desktop uses one application origin. Passwords are never stored in project files or browser storage. The optional remember checkbox stores a token; default login is session-only. Tokens last one hour; account operations may renew the token. Ordinary logout removes the local token; “Sign out all devices” revokes existing tokens. There is no automated password recovery in this first edition.

The capability contract defaults to `projectStorage: "local"`; an unavailable or unknown service stays local-only. Normal guest analysis and local project operations make no account API request. Opening account controls explicitly checks service capabilities. The first server uses `WISPLAB_PROJECT_STORAGE=local`, and its public proxy exposes account endpoints only: project/file routes are blocked. Registration/login sends the necessary account credentials and account requests; it does not upload experimental data. Account records, password hashes and operational logs still require server storage and backup. Local API keys and authentication tokens are excluded from every project archive.

## Source of truth / 以后修改哪里

| Component | Maintained source |
| --- | --- |
| WB tools | `blot-workbench/src/` |
| IHC, stains and IF | `pathology-workbench/src/` |
| PCR | `pcr-workbench/src/` |
| Shared account UI, local project controls and retained future cloud client | `blot-workbench/platform/` |
| Portal | `blot-workbench/deployment/wisplab/portal/` |
| Account service and retained future cloud implementation | `blot-workbench/services/cloud/` |
| Windows / macOS shell and packaging | `blot-workbench/desktop/` |

`public/platform/` in each tool and the portal's `platform/` are **generated copies**, not separately maintained implementations. After changing `platform/`, run from the WB repository:

```sh
node scripts/sync-platform.mjs \
  --target /path/to/pathology-workbench \
  --target /path/to/pcr-workbench
node scripts/sync-platform.mjs --check
```

Commit the generated copies alongside the tool changes. The release packager checks every asset digest and rejects a suite containing different shared platform versions. Every tool build embeds its source commit in `meta[name="wisplab-build"]`; a local dirty build is explicitly marked. Archive adapters include that build identity where their archive format supports it; desktop manifests always record all three source SHAs.

## Recoverable projects

- WB original-image and demo modes use their existing strictly validated native project archives.
- Single-strip and quick modes preserve original uploads, source grayscale, preparation/crop/straightening settings, manual regions, external reference selection, labels and display-only brightness/contrast. Restoring regions does not rerun detection or replace manual edits.
- Pathology preserves exact working pixels, original attachments when available, ROI, controls, sample/batch settings and images. Old saved work that already discarded an original attachment is labeled incomplete; the missing original cannot be reconstructed. ONNX model weights are not included in project files and need reloading when used.
- PCR preserves source tables/files, mapping, exclusions, merged rows, melt data and settings. Non-finite QC values are encoded reversibly instead of silently changing NaN into null.

Archives are bounded and validated before replacing current analysis. A cancellation, changed experiment, changed account or failed checksum leaves the current analysis intact. Files exceeding a tool's archive limits must be kept separately or split into smaller projects. The first release has no cloud quota or upload workflow because experimental files are not accepted by the server.

## Local acceptance

```sh
python3 services/cloud/run_local.py
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/?mode=single&cloudApi=local`. The `cloudApi=local` override works only on localhost/127.0.0.1; deployed sites ignore it. Test authentication is stored under a separate key from production. Use synthetic data and disposable local accounts.

```sh
npm run check
npm run test:scripts
python3 -m unittest discover -s services/cloud -p 'test_*.py' -v
python3 -m unittest discover -s deployment/wisplab -p 'test_*.py' -v
npm run test:e2e
```

Accept the first-release default with account registration/login, capability `projectStorage: "local"`, blocked project/file requests, local export/import, and guest analysis without API calls. Mocked UI tests alone do not establish that a deployed account service works.

The retained cloud integration tests use a separate disposable backend explicitly started with `WISPLAB_PROJECT_STORAGE=cloud`; see `services/cloud/README.md`. Those tests exercise future code only and must not change the first-release server's local-only setting.

## Web release / 两个网址如何一起更新

The existing `deployment/wisplab/release.py publish` remains the unified release entry point. The procedure is: commit each changed tool, merge the tested commits to its main branch, wait for all required CI jobs, then publish one named WispLab suite release. The release orchestrator freezes exact successful CI artifacts, updates GitHub Pages and creates the server release. Verify both Pages bytes and each domain's `release.json`; a push alone does not prove that either website updated.

```sh
python3 deployment/wisplab/release.py publish --help
python3 desktop/scripts/stage.py ci --help
```

Use the existing release guide for the full selected release arguments and rollback command. A frontend release **does not install or upgrade the account backend**. Preserve its separate database and file storage across every static website release.

## First server activation

The existing WispLab site remains at `/srv/wisplab/current`, and its installed updater uses `/srv/wisplab/bin/deploy.py`. This revision adds an optional `import /etc/caddy/wisplab-cloud/*.caddy` inside only the `wisplab.top` site block. Before activating accounts, install the reviewed new deploy script on the server as well as the account service; a repository commit does not update the installed script automatically.

Follow `services/cloud/README.md` for the non-root service, protected data directory, locked PocketBase binary, account database backup and recovery. Keep `WISPLAB_PROJECT_STORAGE=local`. Install only the reviewed **accounts-only** API snippet from `/etc/wisplab-cloud/cloud.caddy.candidate` into `/etc/caddy/wisplab-cloud/cloud.caddy`; do not install the future `cloud-storage.caddy.candidate`. The snippet uses a dedicated `handle /api/*` so the existing static catch-all does not swallow API requests. It allows registration/login/refresh, capabilities and account-wide logout, with 16 KiB request bodies; project/file/usage/management routes return 404. Validate the entire existing Caddyfile before reload, retaining unrelated sites.

The first activation must verify public HTTPS, intended-origin access, registration/login/logout with synthetic accounts, public local-only capabilities, blocked project/upload/file/usage paths, no new experimental file bytes, guest operation, local project round trips and a recoverable account-database backup. Registration defaults to closed; explicitly enable it only after acceptance. No user password, private SSH key, session token or real experimental data belongs in this repository or the public release.

## Future cloud storage — disabled in this release

The retained implementation supports explicit project uploads, immutable version history, conflict detection and reversible archives. It is inactive in the first release. Enabling it later requires a separate approval of storage capacity and data handling, `WISPLAB_PROJECT_STORAGE=cloud`, the reviewed cloud-storage proxy snippet and new acceptance of account isolation, upload/download hash equality, concurrent conflicts, quotas, backups and recovery. Do not import both proxy snippets. These tests and configuration changes belong to that future release.

If enabled later, uploads would include original images/tables and recoverable analysis state. Server administrators would be able to access stored files; the implementation does not claim end-to-end encryption. Cloud storage would remain optional and explicitly initiated, rather than a continuous background backup.

## Desktop release and update

The Electron shell bundles the same three compiled web applications plus the portal. Core analysis, imports and exports operate from `app://wisplab/` without an internet connection. Optional account access requires connectivity; signing in does not upload or synchronize projects in this release. Optional remote AI remains subject to network availability and provider configuration; the WB local-server vision proxy is not bundled in this first desktop edition.

`desktop/README.md` documents local staging, packaging and the **Desktop packages (unsigned experimental)** workflow. The workflow consumes three full source SHAs and verifies successful CI artifacts and their digests. The desktop release manifest lists each source and file hash. A website update does not silently update an installed desktop app: create a new desktop package from the accepted suite and install that version. Automatic desktop updates are not enabled.

First-edition installers are unsigned experimental builds unless signing is explicitly configured. They are not Apple-notarized or Windows publisher-verified. Do not disable operating-system security protections. For public distribution, configure developer signing/notarization and verify packages on both Windows and macOS. Retain old installers, source manifests and checksums for application rollback; export local projects before rolling back to an older data format. Preserve the separate account database when updating or rolling back the account service.
