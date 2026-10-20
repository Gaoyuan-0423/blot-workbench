# WispLab accounts and optional project cloud / 账号与可选项目云端

The first release provides optional username/password accounts and **local project files only**. `WISPLAB_PROJECT_STORAGE=local` is the safe default. Registration and login do not upload experiments or provide cross-device experiment synchronization. Users move projects between devices through local export/import. Guest/offline analysis remains available; no scientific algorithm changes.

首版只开放账号，不上传原图、实验表格、项目包或结果；云项目接口同时由后端开关和公网代理禁用。账号数据库、密码哈希和运行日志仍占用少量服务器存储，并需要备份。完整云存储实现保留为后续明确启用的能力，不能因本地测试通过就对公网开放。接口见 [HTTP.md](HTTP.md)。

## Pinned upstream

PocketBase **0.40.5**, official release 2026-10-08, checked 2026-10-20. `pocketbase.lock.json` pins the official release asset URL, immutable asset API URL, and SHA-256 for every architecture. `download.py` checks the archive before extracting only the executable; no CDN or third-party mirror fallback. Do not use `pocketbase update` in production.

- [Official release](https://github.com/pocketbase/pocketbase/releases/tag/v0.40.5)
- [Authentication and token lifetime](https://pocketbase.io/docs/authentication/)
- [Protected files and view rules](https://pocketbase.io/docs/files-handling/)
- [Transactions and single-writer constraints](https://pocketbase.io/docs/js-database/)
- [JavaScript migrations](https://pocketbase.io/docs/js-migrations/)
- [Production operations](https://pocketbase.io/docs/going-to-production/)

PocketBase is an application backend with SQLite and protected file storage. Credentials are handled by its built-in auth collection, not a custom password algorithm. It remains pre-1.0: each upgrade requires a pinned new artifact, local migration/access-control tests, and a complete restore plan. Authorization does not equal end-to-end encryption; operators can read stored files. No encrypted-at-rest claim is made.

## Local development / 本地开发

From the WB repository:

```sh
python3 services/cloud/download.py
python3 services/cloud/run_local.py
```

The process binds **only** `127.0.0.1:8090`. Runtime data and downloaded binaries live in the ignored `services/cloud/.runtime/` directory. The three schemas are created by startup migrations, but project writes remain disabled by default. No accounts are pre-created. The local runner explicitly sets registration to `open` unless the operator already supplied a setting, so a developer may register a synthetic username using the ordinary API. Automatic hook reload is disabled, matching production: restart the local process after changing hooks. Invalid hooks fail startup rather than being skipped by the development watcher. Do not use real experimental or patient data for tests.

The shared `$app.onServe().bindFunc` hook disables PocketBase's default installer through its [official `installerFunc` override](https://pocketbase.io/jsvm/interfaces/core.ServeEvent.html#installerFunc). First start never opens a browser, creates the setup superuser, or prints a setup token. Superuser provisioning, if needed for administration, remains a separate explicit operator action.

For the shared frontend, use `http://127.0.0.1:5173/?cloudApi=local` (or port 5187, with `localhost` also accepted). This explicit switch works only on loopback-hosted pages and selects `http://127.0.0.1:8090`; production URLs always use `https://wisplab.top`. Development API tokens use a separate storage key so a test service never receives a production login token. Other local ports are intentionally not allowed by CORS. The local runner accepts `--data /absolute/temporary/directory` for a separate acceptance database and never creates a pre-seeded account.

```sh
python3 -m unittest discover -s services/cloud -p 'test_*.py' -v
```

The integration suite launches the actual pinned binary against a new temporary data directory per test, uses synthetic ZIPs, and removes that directory after stopping the process. It checks default local-only capabilities, working authentication, rejected uploads before multipart parsing, and zero added project/file bytes. Future cloud tests explicitly set `WISPLAB_PROJECT_STORAGE=cloud` and cover password login failures, owner isolation, protected-file downloads, exact binary bytes, immutable history, archive/restore, concurrent writes, quota accounting, type/size rejection, token revocation, and origin restrictions. To use a previously verified binary, set `WISPLAB_TEST_BINARY=/absolute/path/pocketbase`; the test runner also checks its version.

For optional **future cloud-mode** browser-to-backend acceptance, start the WB dev server on 5173 and a separate synthetic backend with `WISPLAB_PROJECT_STORAGE=cloud python3 services/cloud/run_local.py`, sync the shared platform files, then run:

```sh
WISPLAB_LIVE_CLOUD=1 npx playwright test tests/e2e/platform-live.spec.ts --workers=1
```

This test is skipped by default, including ordinary CI. It uses the actual local browser UI and API without mocks, creates only synthetic accounts and image packages, checks exact project recovery in another browser context, two retained revisions, conflict rejection, account isolation and continued guest analysis after logout. Synthetic accounts/data remain only in the local acceptance database; repeated runs are subject to real registration and request limits. Screenshots at 390/1440 pixels in Chinese and English plus a non-secret acceptance record are written to ignored `.release/cloud-acceptance/`.

## Production layout / Ubuntu目录

| Path | Purpose |
|---|---|
| `/opt/wisplab-cloud/releases/<timestamp>/` | Read-only pinned binary, migration and hook release |
| `/opt/wisplab-cloud/current` | Active release symlink |
| `/var/lib/wisplab-cloud/pb_data/` | Database, uploaded files, logs; mode 0700; never below a website root |
| `/etc/wisplab-cloud/environment` | Root-owned limits and registration switch |
| `/etc/wisplab-cloud/cloud.caddy.candidate` | Installed candidate API-only Caddy snippet |
| `/etc/wisplab-cloud/cloud-storage.caddy.candidate` | Inactive future full-cloud candidate; never install for the accounts-only release |
| `/etc/caddy/wisplab-cloud/cloud.caddy` | Reviewed and activated Caddy import |
| `/etc/systemd/system/wisplab-cloud.service` | Non-root, loopback-only service |

No new DNS record is needed. The public API lives at `https://wisplab.top/api/...`, with Caddy forwarding only account registration/login/refresh, capabilities and account-wide logout to loopback. Request bodies are limited to 16 KiB. All project, file and management paths return 404. The other tool origins use that API directly. A username identifies the same account from each address; browser session storage itself is origin-isolated.

## Reviewed activation / 审核后启用

These steps are for a later approved deployment. They have **not** been run on a server.

1. Confirm disk capacity, off-server backups, the current Caddyfile, and the existing publisher's preserved `import /etc/caddy/wisplab-cloud/*.caddy` inside the `wisplab.top` block. Install the updated static publisher before activation so future site releases retain this optional import. Do not replace the site's existing TLS/static config. Keep the service port inaccessible externally.
2. Stop an existing cloud service and make a consistent backup before upgrades. Run `sudo bash services/cloud/install_ubuntu.sh --apply`. It downloads/verifies the locked binary, installs a new release, creates the unprivileged **system service user only**, and writes `cloud.caddy.candidate`. It does not start services, reload Caddy, create application accounts, or change the main Caddyfile.
3. Review `/etc/wisplab-cloud/environment`. The service requires this file to exist. Keep `WISPLAB_PROJECT_STORAGE=local`; missing or empty also means `local`, and invalid values refuse startup. Registration defaults to `closed` both in the installed example and when its variable is absent or empty; only exact `open` enables registration, and any other nonempty value refuses startup. Experimental files are not accepted in this mode, regardless of quota settings.
4. Run `sudo systemctl daemon-reload`, then `sudo systemctl start wisplab-cloud`. Check `sudo systemctl status wisplab-cloud` and the local `/api/health` response. Do not expose the admin `/_/` or general `/api/` proxy.
5. Compare the **accounts-only** `/etc/wisplab-cloud/cloud.caddy.candidate` with the active configuration, install it as `/etc/caddy/wisplab-cloud/cloud.caddy` (creating that directory if needed), then run `sudo caddy validate --config /etc/caddy/Caddyfile`. Only after validation succeeds, reload Caddy. Do not install `cloud-storage.caddy.candidate` or import both snippets. `X-Real-IP` is overwritten, not trusted from the caller.
6. Check public capabilities report `projectStorage: "local"`, intended-origin access, bad-origin rejection, guest analysis and local project export/import. Public project/upload/file-token/download/usage/management paths must return 404, while direct loopback authenticated mutations return 403 `cloud_disabled` without adding files. Set `WISPLAB_REGISTRATION=open` and restart only when ready to allow public registrations; `closed` blocks new registration while existing users can sign in. Keep the frontend limited to account controls and local projects.
7. Record the WB commit, backend release path, PocketBase lock digest, schema migration, and frontend builds. Enable the service at boot with `sudo systemctl enable wisplab-cloud` after acceptance.

The service's default `GOMEMLIMIT=768MiB` is a Go runtime target, not a hard total-memory cap. Nothing in this change benchmarks production load or restores a real server backup.

## Future cloud activation — not part of this release

Cloud storage requires a separate decision after checking disk capacity and completing backup/restore acceptance. Only then set `WISPLAB_PROJECT_STORAGE=cloud` and replace the accounts-only active snippet with the reviewed `cloud-storage.caddy.candidate`. Never import both snippets. Verify private uploads/downloads with synthetic users, hash equality, conflicts and quotas before exposing cloud controls. Defaults are 280 MiB/file, 512 MiB/account and 5 GiB total; all retained versions and archived projects count. Reserve additional space for the database, temporary files and a full backup. Changing back to `local` disables writes without deleting previously stored data; recovery of old files requires an explicitly reviewed owner-restricted read path.

## Backup, rollback and version history / 备份回滚

Project revisions are append-only. Restoring a historical experiment creates a new revision so the old history remains. These revisions are **not** a substitute for server backups.

For a simple consistent backup, stop the cloud service, archive all of `/var/lib/wisplab-cloud/pb_data` together with the active release, lock file and operator environment, calculate the archive SHA-256, and restart the same service. Store backups outside the server and test restoring a copy on an isolated loopback service. Do not copy only `data.db` while writes are running: SQLite WAL and uploaded files must remain consistent. Do not include credentials or download URLs in public release artifacts.

To roll back application hooks only when schema-compatible: stop service, retain the failing release and data backup, repoint `current` to the previously tested release, then restart and accept it locally before reopening public access. For a database/schema incompatibility, restore the matching complete data backup into a **new directory**, select the matching binary/hooks release, and test that pair before switching. Keep the failed data directory for recovery. The initial migration deliberately refuses a destructive `down` migration instead of deleting accounts and experiments.

The static website release process does not overwrite this service or its data. Future backend upgrades are a separate, reviewed operation; append schema migrations rather than editing migrations already deployed.

## Known first-version boundaries

- Username/password only: no automatic email recovery or password-reset UI, social login, team sharing, public links, automatic background upload, or file deduplication.
- Ordinary logout clears the current browser token; “退出所有设备 / Sign out all devices” revokes all existing tokens. Account deletion is not exposed. An administrator's account recovery procedure must be settled before broad public rollout.
- Snapshot SHA-256 is client-declared and verified again on download. The backend enforces ownership, exact uploaded byte size, MIME/type, count and aggregate quotas. It does not interpret scientific archives or assert their measurement correctness.
- All archived versions consume quota. A future retention/purge workflow must include explicit user authorization and backups; this version never deletes history to make room.
- The provided tests exercise the backend on the current local platform. Ubuntu systemd and production Caddy activation still require server-side acceptance, and cloud functions must remain disabled if that acceptance cannot be completed.
