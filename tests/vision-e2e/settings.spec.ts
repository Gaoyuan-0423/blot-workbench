import { test, expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { getFixtures } from "../../src/core/fixtures";

const LOCAL_ORIGIN = "http://127.0.0.1:4328";
const TEST_ONLY_KEY = "TEST_ONLY_SENTINEL_NOT_A_REAL_API_KEY";
const MODEL = "test-only-local-fake-vision-model";
const PROJECT_SENTINEL = "PRIVATE_PROJECT_MUST_NOT_LEAVE_BROWSER";
const SAMPLE_SENTINEL = "PRIVATE_SAMPLE_MUST_NOT_LEAVE_BROWSER";

type ProviderCall = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: string;
  closed: boolean;
  response: ServerResponse;
};

async function startFakeProvider() {
  const calls: ProviderCall[] = [];
  let hold = false;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const call: ProviderCall = {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
        closed: false,
        response,
      };
      calls.push(call);
      response.once("close", () => {
        call.closed = true;
      });
      if (hold) return;
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  // Human-authored transport fixture, never model-accuracy evidence.
                  bands: Array.from({ length: 6 }, (_, i) => ({
                    x: 48 + 104 * i,
                    y: 108,
                    width: 72,
                    height: 36,
                  })),
                }),
              },
            },
          ],
        }),
      );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fake provider port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls,
    setHold(value: boolean) {
      hold = value;
    },
    reset() {
      hold = false;
      for (const call of calls)
        if (!call.response.writableEnded) call.response.destroy();
      calls.length = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

let first: Awaited<ReturnType<typeof startFakeProvider>>;
let second: Awaited<ReturnType<typeof startFakeProvider>>;

test.beforeAll(async () => {
  first = await startFakeProvider();
  second = await startFakeProvider();
});
test.afterAll(async () => {
  await Promise.all([first?.close(), second?.close()]);
});
test.beforeEach(async ({ request, context }) => {
  first.reset();
  second.reset();
  const reset = await request.delete(`${LOCAL_ORIGIN}/api/vision/config`, {
    headers: { Origin: LOCAL_ORIGIN },
  });
  expect(reset.ok()).toBe(true);
  // Prevent an accidental browser request from reaching a remote host. The
  // hosted-mode test's page route takes precedence and fulfills .test locally.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === LOCAL_ORIGIN) await route.continue();
    else await route.abort("blockedbyclient");
  });
});
test.afterEach(async ({ request }) => {
  first.reset();
  second.reset();
  // A cancelled fetch can take a moment to release the server's single-test lock.
  await expect
    .poll(async () => {
      const reset = await request.delete(`${LOCAL_ORIGIN}/api/vision/config`, {
        headers: { Origin: LOCAL_ORIGIN },
      });
      return reset.status();
    })
    .toBe(200);
});

async function ready(page: Page, url = "/#demo") {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "项目总览", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("已保存到本机");
}

async function openSettings(page: Page, english = false) {
  await page
    .getByRole("button", {
      name: english ? "Vision API settings" : "视觉 API 设置",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Base URL", { exact: true })).toBeEnabled();
}

async function saveSettings(
  page: Page,
  baseUrl: string,
  key?: string,
  english = false,
) {
  await page.getByLabel("Base URL", { exact: true }).fill(baseUrl);
  await page
    .getByLabel(english ? "Model ID" : "模型 ID", { exact: true })
    .fill(MODEL);
  if (key !== undefined)
    await page.getByLabel("API Key", { exact: true }).fill(key);
  await page
    .getByRole("button", {
      name: english ? "Save to local service" : "保存到本机服务",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText: english
        ? "Configuration saved in the local service"
        : "配置已保存在本机服务中",
    }),
  ).toBeVisible();
}

async function publicConfig(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/vision/config", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
}

test("saving sends nothing; explicit testing sends only the built-in PNG and exports omit the key", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill(PROJECT_SENTINEL);
  await page.getByRole("button", { name: "样本与分组", exact: true }).click();
  await page
    .getByRole("textbox", { name: "sample-1 label", exact: true })
    .fill(SAMPLE_SENTINEL);
  await openSettings(page);
  await saveSettings(page, first.baseUrl, TEST_ONLY_KEY);
  expect(first.calls).toHaveLength(0);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");

  const config = await publicConfig(page);
  expect(config.status).toBe(200);
  expect(config.body).toMatchObject({
    baseUrl: first.baseUrl,
    model: MODEL,
    keyConfigured: true,
  });
  expect(Object.keys(config.body).sort()).toEqual([
    "baseUrl",
    "keyConfigured",
    "model",
    "protocol",
    "revision",
  ]);
  expect(JSON.stringify(config.body)).not.toContain(TEST_ONLY_KEY);

  await page
    .getByRole("button", { name: "发送合成图并测试", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "接口返回了合法候选", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".vision-result-count strong")).toHaveText("6");
  await expect(page.locator(".vision-result-limit")).toContainText(
    "不是算法验证",
  );
  expect(first.calls).toHaveLength(1);
  const call = first.calls[0];
  expect(call).toMatchObject({
    method: "POST",
    url: "/v1/chat/completions",
    authorization: `Bearer ${TEST_ONLY_KEY}`,
  });
  expect(call.body).not.toContain(PROJECT_SENTINEL);
  expect(call.body).not.toContain(SAMPLE_SENTINEL);
  expect(call.body).not.toContain(TEST_ONLY_KEY);
  const upstream = JSON.parse(call.body);
  expect(upstream.model).toBe(MODEL);
  const image = upstream.messages
    .flatMap((message: { content: unknown }) =>
      Array.isArray(message.content) ? message.content : [],
    )
    .filter((part: { type: string }) => part.type === "image_url");
  expect(image).toHaveLength(1);
  expect(image[0].image_url.url).toBe(
    getFixtures().find((fixture) => fixture.image.id === "a-target-1000")!.image
      .dataUrl,
  );
  const png = Buffer.from(image[0].image_url.url.split(",")[1], "base64");
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([720, 280]);

  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await openSettings(page);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(
    page.getByText("已保存在服务内存中", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已保存到本机");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const download = await downloading;
  const entries = unzipSync(
    new Uint8Array(await readFile((await download.path())!)),
  );
  const archiveText = Object.values(entries)
    .map((bytes) => strFromU8(bytes))
    .join("\n");
  expect(archiveText).toContain(PROJECT_SENTINEL);
  expect(archiveText).toContain(SAMPLE_SENTINEL);
  expect(archiveText).not.toContain(TEST_ONLY_KEY);
  expect(archiveText).not.toContain(first.baseUrl);
  expect(archiveText).not.toContain(MODEL);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain(TEST_ONLY_KEY);
  expect(first.calls).toHaveLength(1);
});

test("unsaved edits block testing and changing provider origin cannot forward the old key", async ({
  page,
}) => {
  await ready(page);
  await openSettings(page);
  await saveSettings(page, first.baseUrl, TEST_ONLY_KEY);
  await page.getByLabel("Base URL", { exact: true }).fill(second.baseUrl);
  await expect(
    page.getByRole("button", { name: "发送合成图并测试", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("有未保存的修改。先保存配置，再发送测试图。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  expect(first.calls).toHaveLength(0);
  expect(second.calls).toHaveLength(0);
  await saveSettings(page, second.baseUrl);
  expect((await publicConfig(page)).body.keyConfigured).toBe(false);
  await page
    .getByRole("button", { name: "发送合成图并测试", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "接口返回了合法候选", exact: true }),
  ).toBeVisible();
  expect(first.calls).toHaveLength(0);
  expect(second.calls).toHaveLength(1);
  expect(second.calls[0].authorization).toBeUndefined();
  expect(second.calls[0].body).not.toContain(TEST_ONLY_KEY);
});

test("English settings recover after cancellation and clearing removes the in-memory configuration", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("button", { name: "Switch language", exact: true })
    .click();
  await openSettings(page, true);
  await saveSettings(page, first.baseUrl, TEST_ONLY_KEY, true);
  first.setHold(true);
  await page
    .getByRole("button", { name: "Send synthetic image & test", exact: true })
    .click();
  await expect.poll(() => first.calls.length).toBe(1);
  await page.getByRole("button", { name: "Cancel test", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Local waiting was cancelled" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Send synthetic image & test",
      exact: true,
    }),
  ).toBeEnabled();
  await expect.poll(() => first.calls[0].closed).toBe(true);
  first.setHold(false);
  await page
    .getByRole("button", { name: "Send synthetic image & test", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "The API returned valid candidates",
      exact: true,
    }),
  ).toBeVisible();
  expect(first.calls).toHaveLength(2);
  await page
    .getByRole("button", { name: "Clear configuration & key", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Local configuration and key cleared." }),
  ).toBeVisible();
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Model ID", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", {
      name: "Send synthetic image & test",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await publicConfig(page)).body).toMatchObject({
    baseUrl: "",
    model: "",
    keyConfigured: false,
  });
});

test("a hosted page shows local startup guidance and never reads or submits API configuration", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  // Simulate an HTTPS hosted origin without DNS, internet or a remote server.
  // Every asset response is fetched from the dedicated loopback webServer.
  await page.route("https://blot-workbench.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(url.pathname);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      });
      return;
    }
    const local = await page.request.get(
      `${LOCAL_ORIGIN}${url.pathname}${url.search}`,
    );
    await route.fulfill({ response: local });
  });
  await ready(page, "https://blot-workbench.test/#demo");
  await page
    .getByRole("button", { name: "视觉 API 设置", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "在本机运行后配置", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存到本机服务", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("npm run local");
  expect(apiRequests).toEqual([]);
  expect(first.calls).toHaveLength(0);
  expect(second.calls).toHaveLength(0);
});
