import test from "node:test";
import assert from "node:assert/strict";
import {
  CloudClient,
  CloudError,
  TOKEN_KEY,
  digest,
  validAccount,
} from "../platform/client.js";
const storage = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const cloudCapabilities = {
  version: 1,
  accounts: true,
  registration: "open",
  projectStorage: "cloud",
};
const auth = {
  token: "test-token",
  record: { id: "abcdefghijklmno", username: "researcher" },
};
test("blocked browser storage getters retain usable in-memory guest and account sessions", () => {
  const prior = Object.fromEntries(
    ["sessionStorage", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    for (const key of Object.keys(prior))
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get() {
          throw new Error("Storage blocked");
        },
      });
    const client = new CloudClient();
    assert.equal(client.auth, null);
    client.save(auth);
    assert.equal(client.auth.record.username, "researcher");
    client.logout();
    assert.equal(client.auth, null);
  } finally {
    for (const [key, descriptor] of Object.entries(prior)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
test("logout clears usable storage even when the other store throws", () => {
  const session = storage(),
    local = {
      getItem() {
        throw new Error("Blocked");
      },
      removeItem() {
        throw new Error("Blocked");
      },
    };
  const client = new CloudClient({ session, local });
  client.save(auth);
  assert.ok(session.getItem(TOKEN_KEY));
  client.logout();
  assert.equal(session.getItem(TOKEN_KEY), null);
});
test("password validation counts UTF-8 bytes and constrained usernames", () => {
  assert.ok(validAccount("researcher", "a".repeat(71)));
  assert.ok(!validAccount("researcher", "a".repeat(72)));
  assert.ok(!validAccount("researcher", "汉".repeat(24)));
  assert.ok(!validAccount("Researcher", "a".repeat(12)));
  assert.ok(!validAccount(".researcher", "a".repeat(12)));
  assert.ok(!validAccount("ok", "a".repeat(12)));
});
test("only auth token and minimal account persist, default session; passwords never persist", async () => {
  const local = storage(),
    session = storage(),
    calls = [];
  const client = new CloudClient({
    local,
    session,
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return response(auth);
    },
  });
  await client.login("researcher", "private-password", false);
  assert.equal(local.getItem(TOKEN_KEY), null);
  assert.ok(!session.getItem(TOKEN_KEY).includes("private-password"));
  await client.refresh();
  assert.equal(calls[1][1].headers.Authorization, "Bearer test-token");
  assert.equal(calls[1][1].cache, "no-store");
  assert.equal(calls[1][1].credentials, "omit");
  client.save(auth, true);
  assert.equal(session.getItem(TOKEN_KEY), null);
  assert.ok(local.getItem(TOKEN_KEY));
  client.logout();
  assert.equal(local.getItem(TOKEN_KEY), null);
  assert.equal(client.auth, null);
});
test("late refresh does not restore a logged-out session", async () => {
  let resolve;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: () => new Promise((r) => (resolve = r)),
  });
  client.save(auth);
  const refreshing = client.refresh();
  client.logout();
  resolve(response(auth));
  await assert.rejects(refreshing, (e) => e.status === 401);
  assert.equal(client.auth, null);
});
test("expired session clears token while network failures retain it", async () => {
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async () => response({}, 401),
  });
  client.save(auth);
  await assert.rejects(client.refresh(), (e) => e.status === 401);
  assert.equal(client.auth, null);
  client.save(auth);
  client.fetcher = async () => {
    throw new Error("offline");
  };
  await assert.rejects(client.refresh(), (e) => e.status === 0);
  assert.ok(client.auth);
});
test("upload sends exact bytes and optimistic base revision", async () => {
  let body;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async (_u, o) => {
      body = o.body;
      return response({});
    },
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  const blob = new Blob([Uint8Array.of(0, 255, 1, 42)], {
    type: "application/zip",
  });
  await client.upload(
    { id: "abcdefghijklmno", currentRevision: "123456789012345" },
    { blob, name: "experiment.zip" },
    "source-sha",
  );
  assert.equal(body.get("baseRevision"), "123456789012345");
  assert.equal(body.get("sha256"), await digest(blob));
  assert.deepEqual(
    new Uint8Array(await body.get("file").arrayBuffer()),
    new Uint8Array(await blob.arrayBuffer()),
  );
});
test("download verifies exact size and hash before returning data", async () => {
  const blob = new Blob(["scientific bytes"]);
  let n = 0;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async () =>
      ++n % 2 ? response({ token: "filetoken" }) : new Response(blob),
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  const snapshot = {
    id: "abcdefghijklmno",
    file: "snapshot.zip",
    sizeBytes: blob.size,
    sha256: await digest(blob),
  };
  assert.equal(
    await (await client.download(snapshot)).text(),
    "scientific bytes",
  );
  await assert.rejects(
    client.download({ ...snapshot, sha256: "0".repeat(64) }),
    (e) => e.code === "integrity",
  );
  await assert.rejects(
    client.download({ ...snapshot, sizeBytes: 1 }),
    (e) => e.code === "integrity",
  );
});
test("conflicts are surfaced; client never retries an upload", async () => {
  let calls = 0;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async () => {
      calls++;
      return response({ data: { code: "revision_conflict" } }, 409);
    },
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  await assert.rejects(
    client.upload(
      { id: "abcdefghijklmno", currentRevision: "" },
      { blob: new Blob(["{}"]), name: "x.json" },
      "test",
    ),
    (e) => e instanceof CloudError && e.status === 409,
  );
  assert.equal(calls, 1);
});
test("a local acceptance API has isolated auth storage and never reads production credentials", () => {
  const local = storage(),
    session = storage();
  local.setItem(TOKEN_KEY, JSON.stringify(auth));
  const client = new CloudClient({
    base: "http://127.0.0.1:8090",
    local,
    session,
  });
  assert.equal(client.auth, null);
  client.save({ ...auth, token: "local-only" }, true);
  assert.equal(JSON.parse(local.getItem(TOKEN_KEY)).token, "test-token");
  assert.equal(new CloudClient({ local, session }).auth.token, "test-token");
  assert.equal(
    new CloudClient({ base: "http://127.0.0.1:8090", local, session }).auth
      .token,
    "local-only",
  );
});
test("late login cannot restore a logged-out account", async () => {
  let resolve;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: () => new Promise((r) => (resolve = r)),
  });
  const login = client.login("researcher", "test-password", false);
  client.logout();
  resolve(response(auth));
  await assert.rejects(login, (e) => e.code === "account_changed");
  assert.equal(client.auth, null);
});
test("logout-all finishing for a previous account cannot clear a newer account", async () => {
  let resolve;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: () => new Promise((r) => (resolve = r)),
  });
  client.save(auth);
  const logout = client.logoutAll();
  client.save({
    token: "second",
    record: { id: "123456789012345", username: "other" },
  });
  resolve(new Response(null, { status: 204 }));
  await logout;
  assert.equal(client.auth.token, "second");
});
test("same-account token refreshes preserve the account context", async () => {
  const replies = [];
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: () => new Promise((r) => replies.push(r)),
  });
  client.save(auth);
  const before = client.context();
  const one = client.refresh(),
    two = client.refresh();
  replies[1](response({ ...auth, token: "two" }));
  await two;
  replies[0](response({ ...auth, token: "one" }));
  await one;
  client.assertContext(before);
  assert.equal(client.auth.record.id, auth.record.id);
});
test("switching account while hashing an upload prevents the network mutation", async () => {
  let release,
    calls = 0;
  const gate = new Promise((r) => (release = r));
  class SlowBlob extends Blob {
    async arrayBuffer() {
      await gate;
      return super.arrayBuffer();
    }
  }
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async () => {
      calls++;
      return response({});
    },
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  const upload = client.upload(
    { id: "abcdefghijklmno", currentRevision: "" },
    { blob: new SlowBlob(["{}"]), name: "x.json" },
    "test",
  );
  client.save({
    token: "second",
    record: { id: "123456789012345", username: "other" },
  });
  release();
  await assert.rejects(upload, (e) => e.code === "account_changed");
  assert.equal(calls, 0);
});
test("switching account during file-token issue stops the file download", async () => {
  let resolve,
    calls = 0;
  const blob = new Blob(["bytes"]),
    snapshot = {
      id: "abcdefghijklmno",
      file: "snapshot.zip",
      sizeBytes: blob.size,
      sha256: await digest(blob),
    };
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  const download = client.download(snapshot);
  client.logout();
  resolve(response({ token: "signed-file-token" }));
  await assert.rejects(download, (e) => e.code === "account_changed");
  assert.equal(calls, 1);
});
test("switching account while streaming cancels the stream before exposing the file", async () => {
  let controller,
    cancelled = false,
    calls = 0;
  const blob = new Blob(["bytes"]),
    snapshot = {
      id: "abcdefghijklmno",
      file: "snapshot.zip",
      sizeBytes: blob.size,
      sha256: await digest(blob),
    };
  let ready;
  const started = new Promise((r) => (ready = r));
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async (_url, options) => {
      if (++calls === 1) return response({ token: "signed-file-token" });
      assert.equal(options.referrerPolicy, "no-referrer");
      ready();
      return new Response(stream);
    },
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  const download = client.download(snapshot);
  await started;
  await Promise.resolve();
  client.logout();
  controller.enqueue(new TextEncoder().encode("bytes"));
  await assert.rejects(download, (e) => e.code === "account_changed");
  assert.ok(cancelled);
});
test("invalid snapshot filenames and metadata are rejected before requesting a token", async () => {
  let calls = 0;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async () => {
      calls++;
      return response({});
    },
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  client.save(auth);
  const snapshot = {
    id: "abcdefghijklmno",
    file: "../snapshot.zip",
    sizeBytes: 1,
    sha256: "a".repeat(64),
  };
  await assert.rejects(
    client.download(snapshot),
    (e) => e.code === "invalid_snapshot",
  );
  assert.equal(calls, 0);
});
test("native PocketBase validation-shaped business codes are normalized for callers", async () => {
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async () =>
      response(
        {
          data: {
            code: {
              code: "revision_conflict",
              message: "Newer revision exists",
            },
          },
        },
        409,
      ),
  });
  client.capabilities = { ...cloudCapabilities }; // Explicit cloud deployment fixture.
  await assert.rejects(
    client.request("/api/wisplab/projects"),
    (e) => e.status === 409 && e.code === "revision_conflict",
  );
});

test("capabilities are opt-in, default local, and never change authentication identity", async () => {
  const calls = [];
  let capability = cloudCapabilities;
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return response(capability);
    },
  });
  client.save(auth);
  const context = client.context();
  assert.equal(client.capabilities.projectStorage, "local");
  for (const path of [
    "/api/wisplab/projects",
    "/api/wisplab/usage",
    "/api/collections/cloud_projects/records",
    "/api/collections/cloud_snapshots/records",
    "/api/files/token",
  ])
    await assert.rejects(
      client.request(path),
      (e) => e.code === "cloud_disabled",
    );
  assert.equal(calls.length, 0);
  await client.loadCapabilities();
  client.assertContext(context);
  assert.equal(client.capabilities.projectStorage, "cloud");
  assert.equal(calls[0][1].headers.Authorization, undefined);
  capability = {
    version: 1,
    accounts: true,
    registration: "open",
    projectStorage: "local",
  };
  await client.loadCapabilities();
  client.assertContext(context);
  await assert.rejects(
    client.create("wb-single", "local-only"),
    (e) => e.code === "cloud_disabled",
  );
  assert.equal(calls.length, 2);
  for (const invalid of [
    {},
    { ...cloudCapabilities, version: 2 },
    { ...cloudCapabilities, registration: "unknown" },
  ]) {
    capability = invalid;
    await client.loadCapabilities();
    assert.equal(client.capabilities.projectStorage, "local");
  }
  client.fetcher = async () => {
    throw new Error("offline");
  };
  await client.loadCapabilities();
  assert.equal(client.capabilities.projectStorage, "local");
  assert.equal(client.capabilities.registration, "closed");
  client.assertContext(context);
});

test("an older capability response cannot re-enable cloud after a newer local response", async () => {
  const pending = [];
  const client = new CloudClient({
    local: storage(),
    session: storage(),
    fetcher: () => new Promise((resolve) => pending.push(resolve)),
  });
  const older = client.loadCapabilities(),
    newer = client.loadCapabilities();
  pending[1](response({ ...cloudCapabilities, projectStorage: "local" }));
  await newer;
  pending[0](response(cloudCapabilities));
  await older;
  assert.equal(client.capabilities.projectStorage, "local");
});

test("account deletion clears only auth after success and preserves a newer login", async () => {
  const session = storage(), local = storage();
  session.setItem("experiment", "keep"); local.setItem("project", "keep");
  const client = new CloudClient({session, local, fetcher: async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {password: "current-password", confirmUsername: "researcher"});
    return new Response(null, {status: 204});
  }});
  client.save(auth, true);
  await client.deleteAccount("current-password", "researcher");
  assert.equal(client.auth, null);
  assert.equal(local.getItem(TOKEN_KEY), null);
  assert.equal(session.getItem("experiment"), "keep");
  assert.equal(local.getItem("project"), "keep");
  let complete;
  client.save(auth);
  client.fetcher = () => new Promise(resolve => { complete = resolve; });
  const pending = client.deleteAccount("current-password", "researcher");
  client.save({...auth, token: "new-login"});
  complete(new Response(null, {status: 204}));
  await assert.rejects(pending, /account_changed/);
  assert.equal(client.auth.token, "new-login");
});
test("failed deletion retains the session for retry", async () => {
  const client = new CloudClient({session: storage(), local: storage(), fetcher: async () => response({}, 400)});
  client.save(auth);
  await assert.rejects(client.deleteAccount("wrong", "researcher"));
  assert.equal(client.auth.token, auth.token);
});
