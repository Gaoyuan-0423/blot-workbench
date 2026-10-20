import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const origin = "http://127.0.0.1:5187";
const auth = {
  token: "synthetic-auth-token",
  record: { id: "abcdefghijklmno", username: "test_researcher" },
};
const project = {
  id: "123456789012345",
  title: "Synthetic project",
  tool: "wb-single",
  currentRevision: "234567890123456",
  archived: false,
  updated: "2026-10-20",
};
const bytes = Buffer.from('{"synthetic":true}');
const snapshot = {
  id: "234567890123456",
  project: project.id,
  revision: 1,
  file: "synthetic.json",
  sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  created: "2026-10-20",
};

async function shell(
  page: Page,
  {
    signedIn = false,
    query = "",
    projectStorage = "cloud",
    registration = "open",
    capabilityStatus = 200,
  } = {},
) {
  await page.route(origin + "/platform/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
    await route.fulfill({
      contentType: name.endsWith(".js") ? "text/javascript" : "text/css",
      body: await readFile(
        new URL("../../platform/" + name, import.meta.url),
        "utf8",
      ),
    });
  });
  await page.route(origin + "/cloud-ui-test*", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main>Local analysis fixture</main><script>
    ${signedIn ? `sessionStorage.setItem('wisplab.account.v1', ${JSON.stringify(JSON.stringify(auth))});` : ""}
    window.applied = 0; window.importStarted = false; window.holdImport = false;
    window.addEventListener('wisplab:ready', () => {
      window.unregister = window.WispLab.registerProjectAdapter({tool:'wb-single',
        exportProject: async () => ({blob:new Blob(['synthetic local bytes']),name:'synthetic.zip',summaryTranslations:{zh:'保留合成项目文件',en:'Preserves the synthetic project file'}}),
        importProject: async (blob, options) => { window.importStarted=true; if(window.holdImport)await new Promise(resolve=>window.releaseImport=resolve); if(!options.isCurrent())throw new DOMException('Cancelled','AbortError'); window.applied++;return true; }
      });
    });
    </script><script type="module" src="/platform/wisplab.js"></script></body></html>`,
    }),
  );
  await page.route("https://wisplab.top/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Headers": "authorization,content-type",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        },
      });
    if (path === "/api/wisplab/capabilities")
      return route.fulfill({
        status: capabilityStatus,
        headers,
        json: { version: 1, accounts: true, registration, projectStorage },
      });
    if (path === "/api/wisplab/logout-all")
      return route.fulfill({ status: 204, headers });
    if (path.endsWith("/auth-refresh") || path.endsWith("/auth-with-password"))
      return route.fulfill({ headers, json: auth });
    if (path === "/api/collections/cloud_projects/records/" + project.id)
      return route.fulfill({ headers, json: project });
    if (path === "/api/collections/cloud_projects/records")
      return route.fulfill({
        headers,
        json: { items: [project], page: 1, totalPages: 1 },
      });
    if (path === "/api/collections/cloud_snapshots/records")
      return route.fulfill({
        headers,
        json: { items: [snapshot], page: 1, totalPages: 1 },
      });
    if (path === "/api/wisplab/usage")
      return route.fulfill({
        headers,
        json: {
          usedBytes: bytes.length,
          limits: { userBytes: 536870912, maxFileBytes: 293601280 },
        },
      });
    if (path === "/api/files/token")
      return route.fulfill({
        headers,
        json: { token: "synthetic-file-token" },
      });
    if (path.startsWith("/api/files/cloud_snapshots/"))
      return route.fulfill({
        headers: { ...headers, "Content-Type": "application/json" },
        body: bytes,
      });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await page.goto(origin + "/cloud-ui-test" + query);
}

test("login language switch retains unfinished form values without persisting the password", async ({
  page,
}) => {
  await shell(page, { query: "?account=login" });
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("test_researcher");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到 WispLab" }),
  ).toBeVisible();
  await expect(page.getByLabel("用户名", { exact: true })).toHaveValue(
    "test_researcher",
  );
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue(
    "synthetic-password",
  );
  expect(await page.evaluate(() => localStorage.getItem("wisplab.lang"))).toBe(
    "zh",
  );
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain("synthetic-password");
});

test("a cloud project link opens its version list without automatically replacing local analysis", async ({
  page,
}) => {
  await shell(page, { signedIn: true, query: "?cloudProject=" + project.id });
  await expect(
    page.getByRole("heading", { name: project.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open this version", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => (window as any).applied)).toBe(0);
  await page
    .getByRole("button", { name: "Open this version", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).applied)).toBe(1);
});

test("adapter replacement during asynchronous import blocks stale state and disables duplicate actions", async ({
  page,
}) => {
  await shell(page, { signedIn: true, query: "?cloudProject=" + project.id });
  await page.evaluate(() => {
    (window as any).holdImport = true;
  });
  await page
    .getByRole("button", { name: "Open this version", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).importStarted))
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Back to analysis ×", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "EN", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).unregister();
    (window as any).releaseImport();
  });
  await expect(
    page.getByRole("link", { name: "Open in the matching tool" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).applied)).toBe(0);
});

test("downloading a checked snapshot works while user navigation is locked", async ({
  page,
}) => {
  await shell(page, { signedIn: true, query: "?cloudProject=" + project.id });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download project file", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("synthetic.json");
  await expect(page.getByRole("status")).toHaveText(
    "Project is ready to download.",
  );
});

test("switching language on save confirmation preserves its captured package and project name", async ({
  page,
}) => {
  await shell(page, { signedIn: true });
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Save current analysis to cloud",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Unuploaded synthetic snapshot");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "确认保存项目", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "Unuploaded synthetic snapshot",
  );
  await expect(
    page.getByText("保留合成项目文件", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Save this project", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Unuploaded synthetic snapshot",
  );
  await expect(
    page.getByText("Preserves the synthetic project file", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload project", exact: true }),
  ).toBeEnabled();
});

test("a late-loading tool becomes available in an already open project dialog", async ({
  page,
}) => {
  await shell(page, { signedIn: true });
  await page.evaluate(() => (window as any).unregister());
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Save current analysis to cloud",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (window as any).WispLab.registerProjectAdapter({
      tool: "wb-single",
      exportProject: async () => ({
        blob: new Blob(["{}"]),
        name: "synthetic.zip",
      }),
      importProject: async () => {},
    }),
  );
  await expect(
    page.getByRole("button", {
      name: "Save current analysis to cloud",
      exact: true,
    }),
  ).toBeEnabled();
});

test("local-only guests make no API requests and can save/open a local project", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://wisplab.top/api/"))
      requests.push(request.url());
  });
  await shell(page, { projectStorage: "local" });
  const platform = page.locator("wisplab-platform");
  await platform
    .getByRole("button", { name: "Local project", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await platform
    .getByRole("button", { name: "Download current project", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("synthetic.zip");
  await platform
    .getByLabel("Choose a local project", { exact: true })
    .setInputFiles({
      name: "local.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await expect(platform.getByRole("status")).toHaveText("Project opened.");
  expect(await page.evaluate(() => (window as any).applied)).toBe(1);
  expect(requests).toEqual([]);
});

test("local-only sign-in offers account and local files without cloud actions, retaining work on logout", async ({
  page,
}, info) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://wisplab.top/api/"))
      paths.push(new URL(request.url()).pathname);
  });
  await shell(page, { projectStorage: "local" });
  const platform = page.locator("wisplab-platform");
  await platform
    .getByRole("button", { name: "Sign in / Register", exact: true })
    .click();
  await platform
    .getByLabel("Username", { exact: true })
    .fill(auth.record.username);
  await platform
    .getByLabel("Password", { exact: true })
    .fill("synthetic-password");
  await expect(
    platform.getByText("Review cloud version history", { exact: true }),
  ).toHaveCount(0);
  await platform.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    platform.getByRole("heading", { name: "WispLab account", exact: true }),
  ).toBeVisible();
  await expect(
    platform.getByRole("button", {
      name: /Upload|Cloud projects|Save current analysis to cloud|Versions \/ Open/,
    }),
  ).toHaveCount(0);
  await expect(
    platform.getByText("Signed in as: " + auth.record.username, {
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).applied = 7));
  for (const [lang, label] of [
    ["zh", "中文"],
    ["en", "EN"],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await platform.getByRole("button", { name: label, exact: true }).click();
    await expect(
      platform.getByRole("heading", {
        name: lang === "zh" ? "WispLab 账号" : "WispLab account",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: info.outputPath("account-local-" + lang + "-390.png"),
    });
  }
  await platform.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    platform.getByText("Guest · local analysis", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).applied)).toBe(7);
  expect(
    paths.filter(
      (path) =>
        ![
          "/api/wisplab/capabilities",
          "/api/collections/users/auth-with-password",
        ].includes(path),
    ),
  ).toEqual([]);
});

for (const capabilityStatus of [200, 503])
  test(`local-only cloud deep link never reads project or file APIs (capability ${capabilityStatus})`, async ({
    page,
  }) => {
    const paths: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://wisplab.top/api/"))
        paths.push(new URL(request.url()).pathname);
    });
    await shell(page, {
      signedIn: true,
      projectStorage: "local",
      query: "?cloudProject=" + project.id,
      capabilityStatus,
    });
    const platform = page.locator("wisplab-platform");
    await expect(
      platform.getByRole("heading", { name: "WispLab account", exact: true }),
    ).toBeVisible();
    await expect(platform.getByRole("status")).toContainText(
      "Cloud project storage and sync are unavailable",
    );
    await expect(
      platform.getByRole("button", { name: "Open this version", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).applied)).toBe(0);
    expect(paths).toEqual(["/api/wisplab/capabilities"]);
    expect(page.url()).not.toContain("cloudProject=");
  });

test("closed registration hides sign-up and local account logout-all never touches projects", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://wisplab.top/api/"))
      paths.push(new URL(request.url()).pathname);
  });
  await shell(page, {
    signedIn: true,
    projectStorage: "local",
    registration: "closed",
    query: "?account=account",
  });
  const platform = page.locator("wisplab-platform");
  await expect(
    platform.getByRole("heading", { name: "WispLab account", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await platform
    .getByRole("button", { name: "Sign out all devices", exact: true })
    .click();
  await expect(
    platform.getByText("Guest · local analysis", { exact: true }),
  ).toBeVisible();
  await platform
    .getByRole("button", { name: "Sign in / Register", exact: true })
    .click();
  await expect(
    platform.getByText(
      "Registration is currently unavailable. Existing accounts can still sign in.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    platform.getByRole("button", {
      name: "New here? Create an account",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    paths.filter(
      (path) =>
        ![
          "/api/wisplab/capabilities",
          "/api/collections/users/auth-refresh",
          "/api/wisplab/logout-all",
        ].includes(path),
    ),
  ).toEqual([]);
});
