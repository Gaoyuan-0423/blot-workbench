import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createQuickExample } from "../../src/quick/image";
import { importSingleProject } from "../../src/cloud-project";

// Explicit opt-in: synthetic data/accounts against local Vite and account-only PocketBase.
test.skip(
  process.env.WISPLAB_LIVE_ACCOUNT !== "1",
  "Set WISPLAB_LIVE_ACCOUNT=1 with dev UI :5173 and account-only service :8090.",
);
const url = "http://127.0.0.1:5173/?mode=single&lang=zh&cloudApi=local";
const platform = (page: Page) => page.locator("wisplab-platform");
const button = (page: Page, name: RegExp) =>
  platform(page).getByRole("button", { name });
async function localPackage(page: Page) {
  await button(page, /^(本地项目|Local project)$/).click();
  const download = page.waitForEvent("download");
  await button(page, /^(下载当前项目|Download current project)$/).click();
  const file = await download,
    bytes = await readFile((await file.path())!);
  await button(page, /^(返回分析 ×|Back to analysis ×)$/).click();
  return {
    bytes,
    project: (await importSingleProject(new Blob([bytes]))).project,
  };
}
async function signIn(page: Page, username: string, register: boolean) {
  await button(page, /^(登录 \/ 注册|Sign in \/ Register)$/).click();
  if (register)
    await button(
      page,
      /^(还没有账号？创建账号|New here\? Create an account)$/,
    ).click();
  await platform(page)
    .getByLabel(/^(用户名|Username)$/)
    .fill(username);
  await platform(page)
    .getByLabel(/^(密码|Password)$/)
    .fill("synthetic-account-only-2026");
  if (register)
    await platform(page)
      .getByLabel(/^(再次输入密码|Confirm password)$/)
      .fill("synthetic-account-only-2026");
  await button(
    page,
    register ? /^(注册并登录|Register and sign in)$/ : /^(登录|Sign in)$/,
  ).click();
  await expect(
    platform(page).getByRole("heading", { name: /^WispLab (账号|account)$/ }),
  ).toBeVisible();
}
test("real account-only deployment preserves local projects and never requests cloud data APIs", async ({
  browser,
  request,
}, info) => {
  const capability = await request.get(
    "http://127.0.0.1:8090/api/wisplab/capabilities",
  );
  expect(await capability.json()).toEqual({
    version: 1,
    accounts: true,
    registration: "open",
    projectStorage: "local",
  });
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [a, b] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const errors: string[] = [],
    calls: { method: string; path: string }[] = [];
  for (const page of [a, b]) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const u = new URL(request.url());
      if (
        u.origin === "http://127.0.0.1:8090" &&
        request.method() !== "OPTIONS"
      )
        calls.push({ method: request.method(), path: u.pathname });
    });
  }
  try {
    await a.goto(url);
    const source = createQuickExample();
    await a
      .getByLabel("导入单排条带图片", { exact: true })
      .setInputFiles({
        name: "synthetic-local.png",
        mimeType: "image/png",
        buffer: Buffer.from(source.original!.bytes),
      });
    await expect(a.getByTestId(/^single-relative-/)).toHaveCount(6);
    const baseline = await localPackage(a);
    expect(calls).toEqual([]);
    const username = "local_" + Date.now().toString(36);
    await signIn(a, username, true);
    await expect(
      button(
        a,
        /^(云端项目|Cloud projects|确认上传|Upload project|保存当前分析到云端|Save current analysis to cloud)$/,
      ),
    ).toHaveCount(0);
    for (const [language, label] of [
      ["zh", "中文"],
      ["en", "EN"],
    ]) {
      await a.setViewportSize({ width: 390, height: 844 });
      await button(a, new RegExp("^" + label + "$")).click();
      await expect(
        platform(a).getByRole("heading", {
          name: language === "zh" ? "WispLab 账号" : "WispLab account",
          exact: true,
        }),
      ).toBeVisible();
      await a.screenshot({
        path: info.outputPath("actual-account-local-" + language + "-390.png"),
      });
    }
    await button(a, /^(返回分析 ×|Back to analysis ×)$/).click();
    expect((await localPackage(a)).project).toEqual(baseline.project);
    await b.goto(url);
    await signIn(b, username, false);
    await button(b, /^(返回分析 ×|Back to analysis ×)$/).click();
    await expect(b.getByTestId(/^single-relative-/)).toHaveCount(0);
    await button(b, /^(本地项目|Local project)$/).click();
    b.once("dialog", (dialog) => dialog.accept());
    await platform(b)
      .getByLabel(/^(选择本地项目|Choose a local project)$/)
      .setInputFiles({
        name: "saved.wisplab.zip",
        mimeType: "application/zip",
        buffer: baseline.bytes,
      });
    await expect(platform(b).getByRole("status")).toContainText(
      /项目已打开|Project opened/,
    );
    await button(b, /^(返回分析 ×|Back to analysis ×)$/).click();
    expect((await localPackage(b)).project).toEqual(baseline.project);
    await button(a, /^(账号|Account)$/).click();
    a.once("dialog", (dialog) => dialog.accept());
    await button(a, /^(退出所有设备|Sign out all devices)$/).click();
    await expect(
      platform(a).getByText(/^(游客 · 本机分析|Guest · local analysis)$/),
    ).toBeVisible();
    expect((await localPackage(a)).project).toEqual(baseline.project);
    const allowed = [
      "/api/wisplab/capabilities",
      "/api/collections/users/records",
      "/api/collections/users/auth-with-password",
      "/api/collections/users/auth-refresh",
      "/api/wisplab/logout-all",
    ];
    expect(calls.filter((call) => !allowed.includes(call.path))).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      info.outputPath("account-only-acceptance.json"),
      JSON.stringify(
        {
          syntheticOnly: true,
          capability: "local",
          projectSha256: createHash("sha256")
            .update(baseline.bytes)
            .digest("hex"),
          apiCalls: calls,
          assertions: [
            "guest makes no API request",
            "register and sign in",
            "no cloud controls or data APIs",
            "second browser does not auto-restore",
            "local archive restores exact pixels/settings",
            "logout-all retains local analysis",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

for (const language of ['zh', 'en']) {
  test(`account deletion reauth, cancel and local project retention (${language})`, async ({ page }) => {
    await page.goto(url);
    const source = createQuickExample();
    await page.getByLabel('导入单排条带图片', {exact: true}).setInputFiles({name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(source.original!.bytes)});
    await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
    const before = await localPackage(page);
    const username = 'delete_' + language + '_' + Date.now().toString(36);
    await signIn(page, username, true);
    if (language === 'en') await platform(page).getByRole('button', {name: 'EN', exact: true}).click();
    await button(page, /^(删除账号|Delete account)$/).click();
    await expect(platform(page).getByRole('heading', {name: /删除 WispLab 账号|Delete WispLab account/})).toBeVisible();
    await button(page, /^(取消|Cancel)$/).click();
    await button(page, /^(删除账号|Delete account)$/).click();
    await platform(page).getByLabel(/输入当前用户名以确认|Confirm your current username/).fill(username);
    await platform(page).getByLabel(/当前密码|Current password/).fill('incorrect-password');
    page.once('dialog', d => d.accept());
    await button(page, /^(永久删除账号|Permanently delete account)$/).click();
    await expect(platform(page).getByRole('status')).toContainText(/用户名或密码不正确|Username or password did not match/);
    await platform(page).getByLabel(/当前密码|Current password/).fill('synthetic-account-only-2026');
    page.once('dialog', d => d.accept());
    await button(page, /^(永久删除账号|Permanently delete account)$/).click();
    await expect(platform(page).getByRole('status')).toContainText(/账号已删除|Account deleted/);
    await button(page, /^(返回分析 ×|Back to analysis ×)$/).click();
    expect((await localPackage(page)).project).toEqual(before.project);
  });
}
