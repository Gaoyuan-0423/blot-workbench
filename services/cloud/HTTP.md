# WispLab account and optional cloud HTTP contract v1

Production API base: `https://wisplab.top`. Local development: `http://127.0.0.1:8090`.
All mutations are explicit user actions. Anonymous local analysis never requires an account and never uploads data.

**First release: accounts and local project files only.** `WISPLAB_PROJECT_STORAGE` defaults to `local`. This allows registration/login while rejecting scientific project creation, changes, and uploads. Public Caddy routes also block all project, history, usage, file-token and download endpoints. Signing in does not synchronize experiments. Move an experiment between computers by exporting and importing its local project file.

## Capabilities

`GET /api/wisplab/capabilities` is public, returns `Cache-Control: no-store`, and contains no account or experiment data:

```json
{"version":1,"accounts":true,"registration":"open","projectStorage":"local"}
```

`registration` is `open` or `closed`. `projectStorage` is `local` or `cloud`; an absent or empty setting means `local`, and any other value refuses service startup. Frontends must treat missing, failed, or unsupported capability responses as local-only. Fetch capabilities when opening account features, without requiring a request for ordinary guest analysis.

In `local` mode, direct loopback project mutation requests return 403 with `data.code.code="cloud_disabled"` before request/file parsing; the accounts-only public proxy returns 404 for these unexposed paths. Existing data are never deleted when the mode changes. Backend owner-restricted reads remain available internally for operator-assisted recovery, but are not publicly exposed by the accounts-only proxy. Future cloud activation requires both explicit `projectStorage=cloud` and a separately reviewed full proxy configuration.

## Accounts

- Register: `POST /api/collections/users/records`, JSON `{username,password,passwordConfirm}`. Returns a user record (not a login token). Username: 3–32 lowercase ASCII letters/digits/`_.-`, starts with a letter or digit. Password: at least 12 characters and at most 71 UTF-8 bytes. No email is collected in v1.
- Login: `POST /api/collections/users/auth-with-password`, JSON `{identity:username,password}`. Returns `{token,record}`. Send `Authorization: <token>` on authenticated requests. Never transmit or persist passwords beyond the authentication request.
- Refresh: `POST /api/collections/users/auth-refresh`. The auth token lasts 1 hour; refresh while active. Old tokens remain valid until expiry or account-wide revocation.
- Ordinary logout: clear local token, account binding, and cached cloud list. This does **not** invalidate copies of that token held elsewhere.
- Logout all devices: `POST /api/wisplab/logout-all` (authenticated). Returns 204 and rotates the account token key; previous auth and file tokens cease to work. Then clear local auth even if the response is lost.
- Do not expose the admin dashboard, `_superusers`, collection management, or settings APIs on the public reverse proxy. There are no seeded admin or user accounts.
- Username/password only means no automated forgotten-password recovery in v1; do not offer an email-reset flow. Existing local projects remain usable when logged out.

## Projects — future cloud mode only

Tool values: `wb-real`, `wb-single`, `wb-quick`, `wb-demo`, `pathology`, `pcr`.

`POST /api/wisplab/projects`, JSON `{title,tool}` → 201:

```json
{"id":"15charrecordid1","title":"Experiment","tool":"wb-single","currentRevision":"","archived":false,"updated":"2026-10-20 00:00:00.000Z"}
```

`GET /api/collections/cloud_projects/records?page=1&perPage=50&sort=-updated&filter=archived%3Dfalse` → PocketBase pagination `{page,perPage,totalItems,totalPages,items}`. Owner rules are always applied by the server; client filters only narrow them. Optional tool filter. Record objects also include PocketBase metadata and owner; the public client only needs the six fields above.

`PATCH /api/wisplab/projects/{id}`, JSON `{title?:string,archived?:boolean}` → 200 project. Archive is reversible and retains all historical files; it does not reclaim quota. No permanent-delete route exists.

## Save a revision — future cloud mode only

`POST /api/wisplab/projects/{id}/snapshots`, authenticated multipart/form-data:

| Field | Meaning |
|---|---|
| `file` | Exactly one ZIP or JSON project snapshot; `.zip`, `.json`, or `.wisplab` filename; actual MIME must be ZIP or JSON. |
| `baseRevision` | Empty string for the first save; otherwise the last known `project.currentRevision` ID. Required even when empty. |
| `schemaVersion` | Positive integer 1–10000 describing the tool's project format. |
| `appVersion` | Nonempty application build/version, max 100 characters. |
| `sha256` | 64 lowercase hex characters, computed by client over the exact file bytes. |

201 response:

```json
{
  "project":{"id":"...","title":"...","tool":"wb-single","currentRevision":"...","archived":false,"updated":"..."},
  "snapshot":{"id":"...","project":"...","revision":1,"file":"snapshot_abc.zip","sha256":"...","schemaVersion":1,"appVersion":"...","created":"...","sizeBytes":1234}
}
```

Saving adds an immutable snapshot and moves the project head in one SQLite transaction. Quota checks and `baseRevision` checks run inside the same writer transaction. Two writers with the same base produce one success and one 409. No last-writer-wins overwrite. After a lost HTTP response, reload the project head/history before retrying. To restore an older revision, open it locally and save it as a new revision against the current cloud head.

The SHA-256 field is a **client-declared checksum**, not a server signature. The server stores the exact uploaded bytes and counts the actual file size; the downloader must hash the downloaded blob and compare before parsing. Tool-specific strict validation belongs to the project's codec, before upload and again before applying a download. The backend does not unzip or execute uploaded projects.

## History and downloads — future cloud mode only

- History: `GET /api/collections/cloud_snapshots/records?filter=project%3D%22PROJECT_ID%22&sort=-revision&page=1&perPage=50`. Every item is subject to owner rules.
- Get a short-lived file token: `POST /api/files/token` using the auth token → `{token}` (120 seconds).
- Fetch: `GET /api/files/cloud_snapshots/{snapshot.id}/{snapshot.file}?token=FILE_TOKEN&download=1`.
- Verify SHA-256, strictly decode, then apply as a single state replacement. Abort stale open requests if the user changes/imports the current experiment in the meantime.
- Treat file-token URLs as temporary credentials; never put them in logs, project archives, analytics, history links, or a service-worker cache. API responses use `Cache-Control: no-store`.

## Quotas and errors — future cloud mode

`GET /api/wisplab/usage` → `{usedBytes,projectCount,limits:{maxFileBytes,userBytes,totalBytes,maxProjects,maxRevisions}}`.

Defaults: 280 MiB/file, 512 MiB/account, 5 GiB across the server, 100 projects/account, 200 revisions/project. All revisions, including archived projects, count toward usage. Environment configuration may reduce these; the client must read limits. The 280 MiB cap accommodates the existing WB real-project archive cap.

PocketBase errors have `{status,message,data}`. Custom errors use PocketBase's validation-error shape: `data.code = {code: "revision_conflict", message: "..."}`. The stable business code is **`data.code.code`**; the client also accepts an older plain `data.code` string. A plain string cannot be passed directly to `ApiError.data`, because PocketBase replaces it with `validation_invalid_value`.

- 400: malformed input, mismatched passwords, invalid file type.
- 401: no valid authentication; ask the user to log in and retain local work.
- 403/404: access denied; absent and other-owner projects are indistinguishable.
- 403 `cloud_disabled`: scientific project storage is disabled; retain local work and use local export/import. The accounts-only public proxy blocks these paths with 404 before reaching the backend.
- 409 `revision_conflict` / `project_archived`: reload/list or explicitly save a separate project / restore archive.
- 413 `file_too_large`: retain local project, offer local export.
- 429: request-rate limit; retain local work and retry later after user action.
- 507 `storage_quota`, `project_quota`, `revision_quota`: no snapshot/head change. Do not imply archive frees storage.

Allowed production origins: `https://wisplab.top`, `https://wb.wisplab.top`, `https://pathology.wisplab.top`, `https://pcr.wisplab.top`, `https://gaoyuan-0423.github.io`, `app://wisplab`. Development additionally permits exactly localhost and 127.0.0.1 on ports 5173 and 5187. Origin checks do not replace bearer authentication or owner rules.

If cloud storage is explicitly enabled in a future release, projects and source files are private through authorization and HTTPS. They are not end-to-end encrypted; the server administrator can read them. Do not claim encrypted-at-rest storage unless the deployment separately provides it. Never include localStorage dumps, auth tokens, BYOK API keys, or account passwords in any snapshot. In the first accounts-only release, the server stores account/authentication data and operational logs, not experiment packages.


## Account deletion (candidate; deployment required)

`POST /api/wisplab/delete-account` requires a current users bearer token and JSON
`{"password":"current password","confirmUsername":"signed-in username"}`.
Unknown fields are rejected. The current password is verified inside the same
transaction that clears project current-revision references and deletes the
account's snapshots, files, projects and user record. Returns 204 after success;
wrong confirmation/password returns 400; unauthenticated requests are rejected.
All old account tokens become invalid. Other accounts and device-local projects
are unaffected. Ordinary collection DELETE operations remain forbidden.

The accounts-only Caddy snippet must explicitly expose this endpoint when the
backend is deployed. Historical external backups are not purged by this API;
operators must define retention, deletion handling and restore procedures that do
not resurrect deleted accounts. Do not describe this local candidate as deployed.
