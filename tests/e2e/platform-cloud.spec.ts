import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const origin = "http://127.0.0.1:5187";
const bytes = Buffer.from('{"synthetic":true}');

async function shell(page: Page, query = "") {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
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
  await page.route(origin + "/local-ui-test*", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main>Local analysis fixture</main><script>
      for (const store of [localStorage,sessionStorage]) {
        store.setItem('wisplab.account.v1', 'old-token-not-to-send');
        store.setItem('wisplab.account.v1@http://127.0.0.1:8090','old-test-token');
        store.setItem('experiment','preserve-pixels-and-regions');
      }
      window.applied=0; window.importStarted=false; window.holdImport=false; window.acceptImport=true;
      window.addEventListener('wisplab:ready', () => {
        window.adapter={tool:'wb-single',
          exportProject:async()=>({blob:new Blob(['synthetic local bytes']),name:'synthetic.zip'}),
          importProject:async(blob,options)=>{
            window.importStarted=true;
            if(window.holdImport)await new Promise(resolve=>window.releaseImport=resolve);
            if(!options.isCurrent())throw new DOMException('Cancelled','AbortError');
            if(!window.acceptImport)return false;
            window.applied++;return true;
          }
        };
        window.unregister=window.WispLab.registerProjectAdapter(window.adapter);
      });
    </script><script type="module" src="/platform/wisplab.js"></script></body></html>`,
    }),
  );
  await page.goto(origin + "/local-ui-test" + query);
  await expect(
    page
      .locator("wisplab-platform")
      .getByText("Local analysis · local files", { exact: true }),
  ).toBeVisible();
  return requests;
}

for (const query of [
  "",
  "?account=login",
  "?account=register&cloudApi=local",
  "?account=account",
  "?account=projects",
]) {
  test(`account-free startup ignores old tokens and account routes: ${query || "normal"}`, async ({
    page,
  }) => {
    const requests = await shell(page, query);
    const platform = page.locator("wisplab-platform");
    await expect(
      platform.getByRole("button", {
        name: /Sign in|Register|Account|Cloud|Upload|登录|注册|账号|云端/,
      }),
    ).toHaveCount(0);
    await expect(platform.locator('input[type="password"]')).toHaveCount(0);
    expect(page.url()).not.toContain("account=");
    expect(
      await page.evaluate(() =>
        [localStorage, sessionStorage].map((store) => ({
          token: store.getItem("wisplab.account.v1"),
          test: store.getItem("wisplab.account.v1@http://127.0.0.1:8090"),
          experiment: store.getItem("experiment"),
        })),
      ),
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        token: null,
        test: null,
        experiment: "preserve-pixels-and-regions",
      })),
    );
    expect(requests).toEqual([]);
  });
}

test("local files download and import without any API request", async ({
  page,
}) => {
  const requests = await shell(page);
  const platform = page.locator("wisplab-platform");
  await platform
    .getByRole("button", { name: "Local project", exact: true })
    .click();
  expect(page.url()).toContain("project=local");
  const downloading = page.waitForEvent("download");
  await platform
    .getByRole("button", { name: "Download current project", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("synthetic.zip");
  expect(await readFile((await download.path())!, "utf8")).toBe(
    "synthetic local bytes",
  );
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

test("Chinese and English local project controls retain analysis and fit mobile", async ({
  page,
}, info) => {
  const requests = await shell(page, "?project=local");
  const platform = page.locator("wisplab-platform");
  await page.evaluate(() => ((window as any).applied = 7));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [label, heading] of [
    ["中文", "本地项目"],
    ["EN", "Local project"],
  ]) {
    await platform.getByRole("button", { name: label, exact: true }).click();
    await expect(
      platform.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => (window as any).applied)).toBe(7);
    await page.screenshot({
      path: info.outputPath(`local-project-${label}-390.png`),
    });
  }
  await platform
    .getByRole("button", { name: "Back to analysis ×", exact: true })
    .click();
  await expect(platform.getByRole("dialog")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("legacy cloud links explain local import and never fetch a project", async ({
  page,
}) => {
  const requests = await shell(page, "?cloudProject=abcdefghijklmno");
  await expect(
    page.locator("wisplab-platform").getByRole("status"),
  ).toContainText("Import a downloaded project");
  expect(page.url()).not.toContain("cloudProject=");
  expect(await page.evaluate(() => (window as any).applied)).toBe(0);
  expect(requests).toEqual([]);
});

test("late adapter registration refreshes the open local dialog", async ({
  page,
}) => {
  await shell(page, "?account=local");
  const platform = page.locator("wisplab-platform");
  await page.evaluate(() => (window as any).unregister());
  await expect(platform.getByRole("status")).toHaveText(
    "Open an analysis tool first.",
  );
  await page.evaluate(() =>
    (window as any).WispLab.registerProjectAdapter((window as any).adapter),
  );
  await expect(
    platform.getByRole("button", {
      name: "Download current project",
      exact: true,
    }),
  ).toBeEnabled();
});

test("a cancelled or obsolete local import never replaces current analysis", async ({
  page,
}) => {
  const requests = await shell(page, "?project=local");
  const platform = page.locator("wisplab-platform");
  await page.evaluate(() => ((window as any).acceptImport = false));
  await platform
    .getByLabel("Choose a local project", { exact: true })
    .setInputFiles({
      name: "cancel.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await expect(platform.getByRole("status")).toContainText("Cancelled");
  expect(await page.evaluate(() => (window as any).applied)).toBe(0);
  await page.evaluate(() => {
    (window as any).holdImport = true;
    (window as any).acceptImport = true;
  });
  await platform
    .getByLabel("Choose a local project", { exact: true })
    .setInputFiles({
      name: "delayed.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await expect(platform.getByRole("dialog")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(
    platform.getByRole("button", { name: "Back to analysis ×", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).unregister();
    (window as any).releaseImport();
  });
  await expect(platform.getByRole("status")).toHaveText(
    "Open an analysis tool first.",
  );
  expect(await page.evaluate(() => (window as any).applied)).toBe(0);
  expect(requests).toEqual([]);
});
