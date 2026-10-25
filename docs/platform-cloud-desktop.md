# WispLab account-free local projects and desktop handoff / 免登录本地项目与桌面版交接

2026-10-25: the public suite is account-free. Registration, sign-in, account controls, cloud projects and their network client have been removed from the distributed platform. Local analysis, project downloads and project imports remain available. A complete source archive of the preceding account-enabled suite is retained separately for possible future restoration.

2026-10-25 起，公开版本统一免登录：不提供注册、登录、账号管理或云端项目入口，也不向账号服务请求能力或发送旧令牌。WB、病理和 PCR 的分析与本地项目导入、导出继续使用。之前带登录的完整源码版本已另行归档，恢复时应明确选择归档版本并重新验证。

## Shared behavior / 共享行为

The portal and all tools retain **WispLab实验数据分析平台 / WispLab Experimental Data Analysis Platform**, Chinese / EN, and each tool's local project adapter. Cross-device work uses exported project files. There is no experimental-data upload, cloud backup or automatic synchronization.

The public `platform/client.js` now only removes the obsolete `wisplab.account.v1` and loopback-test token keys from local/session storage. It does not read token contents or delete experiments, preferences, IndexedDB databases or AI settings. Blocked browser storage never prevents analysis. Old account links return to the tool; old cloud-project links explain that a local project file is required. `?project=local` opens local project controls; the old `?account=local` link is accepted for compatibility.

## Source of truth / 以后修改哪里

| Component | Maintained source |
| --- | --- |
| WB tools | `blot-workbench/src/` |
| IHC, stains and IF | `pathology-workbench/src/` |
| PCR | `pcr-workbench/src/` |
| Shared local project UI and token cleanup | `blot-workbench/platform/` |
| Portal | `blot-workbench/deployment/wisplab/portal/` |
| Retained historical backend, not used by the public frontend | `blot-workbench/services/cloud/` |
| Windows / macOS shell and packaging | `blot-workbench/desktop/` |

`public/platform/` in each tool and the portal's `platform/` are generated copies. After changing `platform/`, run:

```sh
node scripts/sync-platform.mjs \
  --target /path/to/pathology-workbench \
  --target /path/to/pcr-workbench
node scripts/sync-platform.mjs --check
```

Commit the generated copies with each tool. The release packager rejects a suite with different platform digests. Build identities and archive adapters retain their existing provenance behavior.

## Recoverable projects

- WB original-image and demo modes use their existing strictly validated native project archives.
- Single-strip and quick modes preserve original uploads, source grayscale, preparation/crop/straightening settings, manual regions, external reference selection, labels and display-only brightness/contrast. Restoring regions does not rerun detection or replace manual edits.
- Pathology preserves exact working pixels, original attachments when available, ROI, controls, sample/batch settings and images. Old saved work that already discarded an original attachment is labeled incomplete; the missing original cannot be reconstructed. ONNX model weights are not included in project files and need reloading when used.
- PCR preserves source tables/files, mapping, exclusions, merged rows, melt data and settings. Non-finite QC values are encoded reversibly instead of silently changing NaN into null.

Archives are bounded and validated before replacing current analysis. A cancellation, changed experiment or failed checksum leaves the current analysis intact. Files exceeding a tool's archive limits must be kept separately or split into smaller projects. The first release has no cloud quota or upload workflow because experimental files are not accepted by the server.

## Local acceptance

```sh
npm run check
npm run test:scripts
npm run test:e2e
python3 -m unittest discover -s deployment/wisplab -p 'test_*.py' -v
```

Verify there are no account controls or API requests, including with old tokens and account/cloud links. Local project download/import, cancelled imports, adapter changes during an import, language switching and mobile layout are covered in `tests/e2e/platform-cloud.spec.ts` (the filename is retained for test-history continuity). Backend regression tests in `services/cloud/` cover retained historical implementation only; they do not activate any public service. The obsolete frontend account/cloud live tests have been removed.

## Web release / 两个网址如何一起更新

The existing `deployment/wisplab/release.py publish` remains the unified release entry point. The procedure is: commit each changed tool, merge the tested commits to its main branch, wait for all required CI jobs, then publish one named WispLab suite release. The release orchestrator freezes exact successful CI artifacts, updates GitHub Pages and creates the server release. Verify both Pages bytes and each domain's `release.json`; a push alone does not prove that either website updated.

```sh
python3 deployment/wisplab/release.py publish --help
python3 desktop/scripts/stage.py ci --help
```

Use the existing release guide for the full selected release arguments and rollback command. A static release does not change the retained backend or its data. The retired account service and its protected backups are managed separately; do not re-enable it when publishing the account-free suite.

## Restoring the archived account-enabled edition

The account-enabled source archive contains each tool's exact commit, complete Git bundle and source snapshot. It is separate from current public releases. Source alone cannot restore user accounts: the matching backend binary/hooks, protected configuration and consistent database backup are separate requirements. Keep credentials and account data out of public repositories and static website assets. Historical retention and deletion requirements continue to apply; archiving the implementation does not authorize indefinite account-data retention or reopening a restored database.

Restoring accounts later is a deliberate integration task: merge any desired new analysis changes into the archived edition, verify project-format compatibility, reconcile account deletions, test the backend in isolation, and deploy only after explicit authorization. Do not turn the public frontend back into an account client through a URL parameter or remote capability response.

## Desktop release and update

The Electron shell bundles the same three compiled web applications plus the portal. Core analysis, imports and exports operate from `app://wisplab/` without an internet connection. The public shell has no account controls and does not allow account-service connections in its CSP. Optional remote AI remains subject to network availability and provider configuration; the WB local-server vision proxy is not bundled in this first desktop edition.

`desktop/README.md` documents local staging, packaging and the **Desktop packages (unsigned experimental)** workflow. The workflow consumes three full source SHAs and verifies successful CI artifacts and their digests. The desktop release manifest lists each source and file hash. A website update does not silently update an installed desktop app: create a new desktop package from the accepted suite and install that version. Automatic desktop updates are not enabled.

First-edition installers are unsigned experimental builds unless signing is explicitly configured. They are not Apple-notarized or Windows publisher-verified. Do not disable operating-system security protections. For public distribution, configure developer signing/notarization and verify packages on both Windows and macOS. Retain old installers, source manifests and checksums for application rollback; export local projects before rolling back to an older data format. Historical account records and backups remain separate from desktop profiles and project files.
