import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function ready(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "项目总览", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存到本机" }),
  ).toBeVisible();
}
async function analysis(page: Page) {
  await page.getByRole("button", { name: "继续分析", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "条带分析", exact: true }),
  ).toBeVisible();
}

test("example opens bilingually and sample units do not increase with exposures", async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator(".image-card")).toHaveCount(8);
  await page
    .getByRole("combobox", { name: "筛选批次" })
    .selectOption("batch-b");
  await expect(page.locator(".image-card")).toHaveCount(4);
  await page.getByRole("button", { name: "样本与分组", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await expect(page.getByText("6 个独立单位", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(
    page.getByRole("heading", { name: "Samples", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Both example batches measure the same 6 samples/),
  ).toBeVisible();
  await expect(page.locator(".demo-banner")).toContainText(
    "Not validated for research quantification",
  );
});

test("display changes preserve values, ROI edits invalidate results and survive reload", async ({
  page,
}) => {
  await ready(page);
  await analysis(page);
  const values = await page.locator(".measurement-panel tbody").innerText();
  await page.getByRole("slider", { name: "Display contrast" }).fill("160");
  await expect(page.locator(".measurement-panel tbody")).toHaveText(values, {
    useInnerText: true,
  });
  await expect(page.locator(".canvas-heading .status-tag")).toHaveText(
    "待复核",
  );
  await page.getByRole("spinbutton", { name: "ROI x", exact: true }).fill("55");
  await expect(page.locator(".canvas-heading .status-tag")).toHaveText(
    "待重算",
  );
  await expect(
    page.getByRole("button", { name: "确认复核", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".measurement-panel tbody")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "已保存到本机" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "ROI x", exact: true }),
  ).toHaveValue("55");
  await expect(page.locator(".canvas-heading .status-tag")).toHaveText(
    "待重算",
  );
  await page.getByRole("button", { name: "恢复示例参数", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "ROI x", exact: true }),
  ).toHaveValue("48");
  await expect(page.locator(".measurement-panel tbody")).toHaveText(values, {
    useInnerText: true,
  });
  await page
    .getByRole("button", { name: "band lane-1", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("spinbutton", { name: "ROI x", exact: true }),
  ).toHaveValue("49");
});

test("template versions are independent until explicitly batch-applied", async ({
  page,
}) => {
  await ready(page);
  await analysis(page);
  await page.getByRole("button", { name: "编辑新版本", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "bandWidth", exact: true })
    .fill("80");
  await page.getByRole("button", { name: "保存为 v2", exact: true }).click();
  await expect(
    page.locator(".inspector-meta").filter({ hasText: "项目模板" }),
  ).toContainText("v2");
  await expect(
    page.locator(".inspector-meta").filter({ hasText: "当前图像快照" }),
  ).toContainText("v1");
  await expect(page.locator(".canvas-heading .status-tag")).toHaveText(
    "待复核",
  );
  await page
    .getByRole("checkbox", { name: "Select a-target-1000", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select b-target-1000", exact: true })
    .check();
  await page
    .getByRole("button", { name: "应用到选中 2 张", exact: true })
    .click();
  await expect(
    page.locator(".inspector-meta").filter({ hasText: "当前图像快照" }),
  ).toContainText("v2");
  await expect(
    page.getByRole("spinbutton", { name: "ROI width", exact: true }),
  ).toHaveValue("80");
  await expect(page.locator(".canvas-heading .status-tag")).toHaveText(
    "待重算",
  );
});

test("review notes, confirmation, CSV and project migration work across isolated browser storage", async ({
  page,
  browser,
}, testInfo) => {
  await ready(page);
  await analysis(page);
  await page
    .getByRole("textbox", { name: "复核备注", exact: true })
    .fill("Synthetic review only — save and migrate");
  await page.getByRole("button", { name: "确认复核", exact: true }).click();
  await page
    .locator(".film-item")
    .filter({
      has: page.getByRole("checkbox", {
        name: "Select a-reference-1000",
        exact: true,
      }),
    })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "确认复核", exact: true }).click();
  await page.getByRole("button", { name: "结果与记录", exact: true }).click();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出示例 CSV/ }).click();
  const csv = await csvDownload;
  const csvText = await readFile((await csv.path())!, "utf8");
  expect(csvText).toContain("DEMO_ONLY_NOT_RESEARCH");
  expect(csvText).toContain("TRUE_SYNTHETIC_PRESET");
  expect(csvText.trim().split(/\r?\n/)).toHaveLength(7);
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const download = await exported;
  const path = testInfo.outputPath("migration.wbproj.zip");
  await download.saveAs(path);
  const other = await browser.newContext();
  const destination = await other.newPage();
  await ready(destination);
  await destination
    .getByLabel("Import project archive", { exact: true })
    .setInputFiles(path);
  await expect(
    destination.getByRole("heading", { name: "结果与记录", exact: true }),
  ).toBeVisible();
  await destination.getByRole("button", { name: /^条带分析/ }).click();
  await destination
    .locator(".film-item")
    .filter({
      has: destination.getByRole("checkbox", {
        name: "Select a-target-1000",
        exact: true,
      }),
    })
    .getByRole("button")
    .click();
  await expect(
    destination.getByRole("textbox", { name: "复核备注", exact: true }),
  ).toHaveValue("Synthetic review only — save and migrate");
  await expect(destination.locator(".canvas-heading .status-tag")).toHaveText(
    "已确认",
  );
  await other.close();
});

test("invalid archives preserve current project and empty projects round-trip", async ({
  page,
}, testInfo) => {
  await ready(page);
  await page
    .getByLabel("Import project archive", { exact: true })
    .setInputFiles({
      name: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("not a zip"),
    });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".image-card")).toHaveCount(8);
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("My multi-batch project");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "项目名称", exact: true }),
  ).toHaveValue("My multi-batch project");
  await expect(page.locator(".image-card")).toHaveCount(0);
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const download = await exported;
  const path = testInfo.outputPath("empty.wbproj.zip");
  await download.saveAs(path);
  await page
    .getByLabel("Import project archive", { exact: true })
    .setInputFiles(path);
  await expect(
    page.getByRole("textbox", { name: "项目名称", exact: true }),
  ).toHaveValue("My multi-batch project");
});

test("project actions make no network requests and emit no application errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173/") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  await ready(page);
  const operations: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) operations.push(request.url());
  });
  await analysis(page);
  await page.getByRole("spinbutton", { name: "ROI x", exact: true }).fill("60");
  await page.getByRole("button", { name: "恢复示例参数", exact: true }).click();
  await page.getByRole("button", { name: "确认复核", exact: true }).click();
  await page.getByRole("button", { name: "结果与记录", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存到本机" }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(operations).toEqual([]);
  expect(errors).toEqual([]);
});
