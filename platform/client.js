// Shared WispLab client. Generated copies are distributed by sync-platform.mjs.
export const API = "https://wisplab.top";
export const TOKEN_KEY = "wisplab.account.v1";
const localCapabilities = () => ({
  version: 1,
  accounts: true,
  registration: "closed",
  projectStorage: "local",
});
function browserStorage(name) {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}
function stored(storage, key) {
  try {
    return storage?.getItem(key) || null;
  } catch {
    return null;
  }
}
export class CloudError extends Error {
  constructor(status, code = "") {
    super(code || String(status));
    this.status = status;
    this.code = code;
  }
}
export async function digest(blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function validAccount(username, password) {
  return (
    /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) &&
    Array.from(password).length >= 12 &&
    new TextEncoder().encode(password).length <= 71
  );
}
export class CloudClient {
  constructor({
    base = API,
    fetcher = globalThis.fetch.bind(globalThis),
    session = browserStorage("sessionStorage"),
    local = browserStorage("localStorage"),
  } = {}) {
    this.base = new URL(base).origin;
    this.fetcher = fetcher;
    this.session = session;
    this.local = local;
    this.auth = null;
    this.remember = false;
    this.generation = 0;
    this.capabilities = localCapabilities();
    this.capabilityRequest = 0;
    // A local acceptance-test API must never receive a production login token.
    this.storageKey =
      this.base === API ? TOKEN_KEY : TOKEN_KEY + "@" + this.base;
    try {
      const inSession = stored(session, this.storageKey),
        saved = inSession || stored(local, this.storageKey);
      if (saved) this.auth = this.validateAuth(JSON.parse(saved));
      this.remember = !inSession && !!this.auth;
    } catch {
      /* Blocked storage never blocks local analysis. */
    }
  }
  validateAuth(auth) {
    if (
      !auth ||
      typeof auth.token !== "string" ||
      !auth.token ||
      !/^[a-z0-9]{15}$/.test(auth.record?.id) ||
      typeof auth.record?.username !== "string"
    )
      throw new CloudError(401);
    return {
      token: auth.token,
      record: { id: auth.record.id, username: auth.record.username },
    };
  }
  save(auth, remember = this.remember, renewal = false) {
    this.auth = auth ? this.validateAuth(auth) : null;
    this.remember = remember;
    if (!renewal) this.generation++;
    for (const storage of [this.local, this.session]) {
      try {
        storage?.removeItem(this.storageKey);
      } catch {
        /* Clear each independently. */
      }
    }
    try {
      if (this.auth)
        (remember ? this.local : this.session)?.setItem(
          this.storageKey,
          JSON.stringify(this.auth),
        );
    } catch {
      /* In-memory session remains usable. */
    }
  }
  logout() {
    this.save(null, false);
  }
  context() {
    if (!this.auth) throw new CloudError(401);
    return {
      generation: this.generation,
      id: this.auth.record.id,
      token: this.auth.token,
    };
  }
  assertContext(context) {
    if (
      this.generation !== context.generation ||
      this.auth?.record.id !== context.id
    )
      throw new CloudError(401, "account_changed");
  }
  requireCloud() {
    if (this.capabilities.projectStorage !== "cloud")
      throw new CloudError(403, "cloud_disabled");
  }
  async loadCapabilities() {
    const request = ++this.capabilityRequest;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let next = localCapabilities();
    try {
      const value = await this.request("/api/wisplab/capabilities", {
        token: null,
        signal: controller.signal,
      });
      if (
        value?.version === 1 &&
        value.accounts === true &&
        ["open", "closed"].includes(value.registration) &&
        ["local", "cloud"].includes(value.projectStorage)
      )
        next = {
          version: 1,
          accounts: true,
          registration: value.registration,
          projectStorage: value.projectStorage,
        };
    } catch {
      // Unknown/offline capability is local-only; authentication identity is unchanged.
    } finally {
      clearTimeout(timeout);
    }
    if (request === this.capabilityRequest) this.capabilities = next;
    return this.capabilities;
  }
  async request(
    path,
    { method = "GET", body, signal, token = this.auth?.token } = {},
  ) {
    if (
      /^\/api\/(?:collections\/cloud_|files(?:\/|$)|wisplab\/(?:projects(?:\/|$)|usage(?:\?|$)))/.test(
        path,
      )
    )
      this.requireCloud();
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await this.fetcher(this.base + path, {
        method,
        headers,
        body,
        signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new CloudError(0, "network");
    }
    if (!response.ok) {
      let error;
      try {
        error = await response.json();
      } catch {}
      const value = error?.data?.code;
      throw new CloudError(
        response.status,
        typeof value === "string"
          ? value
          : typeof value?.code === "string"
            ? value.code
            : "",
      );
    }
    return response.status === 204 ? null : response.json();
  }
  async login(username, password, remember) {
    const generation = ++this.generation;
    const auth = await this.request(
      "/api/collections/users/auth-with-password",
      { method: "POST", body: { identity: username, password }, token: null },
    );
    if (this.generation !== generation)
      throw new CloudError(401, "account_changed");
    this.save(auth, remember, true);
    return auth;
  }
  async register(username, password, passwordConfirm) {
    return this.request("/api/collections/users/records", {
      method: "POST",
      body: { username, password, passwordConfirm },
      token: null,
    });
  }
  async refresh() {
    const context = this.context();
    try {
      const auth = await this.request("/api/collections/users/auth-refresh", {
        method: "POST",
        token: context.token,
      });
      this.assertContext(context);
      this.save(auth, this.remember, true);
    } catch (e) {
      if (e.status === 401 && this.generation === context.generation)
        this.logout();
      throw e;
    }
  }
  async logoutAll() {
    const context = this.context();
    try {
      await this.request("/api/wisplab/logout-all", {
        method: "POST",
        token: context.token,
      });
    } finally {
      if (this.generation === context.generation) this.logout();
    }
  }
  async list(tool, page = 1, archived = false) {
    const filter = `archived=${archived}` + (tool ? ` && tool="${tool}"` : "");
    return this.request(
      "/api/collections/cloud_projects/records?" +
        new URLSearchParams({
          filter,
          sort: "-updated",
          page: String(page),
          perPage: "30",
        }),
    );
  }
  async history(id, page = 1) {
    this.id(id);
    return this.request(
      "/api/collections/cloud_snapshots/records?" +
        new URLSearchParams({
          filter: `project="${id}"`,
          sort: "-revision",
          page: String(page),
          perPage: "30",
        }),
    );
  }
  id(id) {
    if (!/^[a-z0-9]{15}$/.test(id)) throw new CloudError(400);
  }
  async create(tool, title) {
    return this.request("/api/wisplab/projects", {
      method: "POST",
      body: { tool, title },
    });
  }
  async patch(id, body) {
    this.id(id);
    return this.request(`/api/wisplab/projects/${id}`, {
      method: "PATCH",
      body,
    });
  }
  async upload(project, snapshot, appVersion) {
    this.requireCloud();
    const context = this.context();
    this.id(project.id);
    const body = new FormData();
    body.append(
      "file",
      snapshot.blob,
      /\.(zip|json|wisplab)$/i.test(snapshot.name)
        ? snapshot.name
        : snapshot.name + ".zip",
    );
    body.append("baseRevision", project.currentRevision || "");
    body.append("schemaVersion", "1");
    body.append("appVersion", appVersion);
    body.append("sha256", await digest(snapshot.blob));
    this.assertContext(context);
    const result = await this.request(
      `/api/wisplab/projects/${project.id}/snapshots`,
      { method: "POST", body, token: context.token },
    );
    this.assertContext(context);
    return result;
  }
  async download(snapshot, signal) {
    this.requireCloud();
    const context = this.context();
    this.id(snapshot.id);
    if (
      !Number.isSafeInteger(snapshot.sizeBytes) ||
      snapshot.sizeBytes < 1 ||
      snapshot.sizeBytes > 280 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
      typeof snapshot.file !== "string" ||
      !snapshot.file ||
      snapshot.file.length > 255 ||
      /[\\/\x00-\x1f]/.test(snapshot.file)
    )
      throw new CloudError(400, "invalid_snapshot");
    const { token } = await this.request("/api/files/token", {
      method: "POST",
      signal,
      token: context.token,
    });
    this.assertContext(context);
    if (typeof token !== "string" || !token)
      throw new CloudError(400, "invalid_snapshot");
    const url =
      `${this.base}/api/files/cloud_snapshots/${snapshot.id}/${encodeURIComponent(snapshot.file)}?` +
      new URLSearchParams({ token, download: "1" });
    let response;
    try {
      response = await this.fetcher(url, {
        signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new CloudError(0, "network");
    }
    try {
      this.assertContext(context);
    } catch (e) {
      await response.body?.cancel().catch(() => {});
      throw e;
    }
    if (!response.ok) throw new CloudError(response.status);
    if (!response.body) throw new CloudError(400, "integrity");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        this.assertContext(context);
        if (done) break;
        length += value.byteLength;
        if (length > snapshot.sizeBytes) throw new CloudError(400, "integrity");
        chunks.push(value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    } finally {
      reader.releaseLock();
    }
    const blob = new Blob(chunks);
    if (
      length !== snapshot.sizeBytes ||
      (await digest(blob)) !== snapshot.sha256
    )
      throw new CloudError(400, "integrity");
    this.assertContext(context);
    this.requireCloud();
    return blob;
  }
}
