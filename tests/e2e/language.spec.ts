import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encode } from "fast-png";

test("language follows navigation, survives reload, and URL overrides the saved choice", async ({
  page,
}) => {
  await page.goto("/?lang=en&keep=1");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Single-strip analysis", exact: true }),
  ).toBeVisible();
  for (const link of await page.locator(".suite-nav a").all())
    expect(
      new URL((await link.getAttribute("href"))!).searchParams.get("lang"),
    ).toBe("en");
  await page.locator(".home-single").click();
  expect(new URL(page.url()).searchParams.get("mode")).toBe("single");
  expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/?mode=single&lang=zh&keep=1");
  await expect(
    page.getByRole("heading", { name: "单条带识别", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  const url = new URL(page.url());
  expect(url.searchParams.get("keep")).toBe("1");
  expect(url.searchParams.get("mode")).toBe("single");
  expect(await page.evaluate(() => localStorage.getItem("wisplab.lang"))).toBe(
    "en",
  );
});

test("switching single-strip copy preserves measurements and regions; errors retranslate", async ({
  page,
}) => {
  await page.goto("/?mode=single&lang=zh");
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  const values = await page.getByTestId(/^single-relative-/).allTextContents();
  const regions = await page
    .locator(".single-image-surface svg rect")
    .evaluateAll((els) =>
      els.map((el) =>
        ["x", "y", "width", "height"].map((name) => el.getAttribute(name)),
      ),
    );
  expect(regions.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Detection results", exact: true }),
  ).toBeVisible();
  expect(await page.getByTestId(/^single-relative-/).allTextContents()).toEqual(
    values,
  );
  expect(
    await page
      .locator(".single-image-surface svg rect")
      .evaluateAll((els) =>
        els.map((el) =>
          ["x", "y", "width", "height"].map((name) => el.getAttribute(name)),
        ),
      ),
  ).toEqual(regions);
  await page
    .getByLabel("Import a single-strip image", { exact: true })
    .setInputFiles({
      name: "我的原始数据.tif",
      mimeType: "image/tiff",
      buffer: Buffer.from("II*\0invalid"),
    });
  await expect(page.getByRole("alert")).not.toContainText(/[\u3400-\u9fff]/);
  await expect(page.getByRole("alert")).toContainText("Import failed");
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("导入失败");
  expect(await page.getByTestId(/^single-relative-/).allTextContents()).toEqual(
    values,
  );
});

test("quick analysis preserves user text and values while chart export follows the language", async ({
  page,
}) => {
  await page.goto("/?mode=quick&lang=en");
  await page.getByRole("button", { name: "Try example", exact: true }).click();
  await page.getByLabel("Protein name", { exact: true }).fill("我的蛋白 α");
  await page.getByLabel("Lane 1 name", { exact: true }).fill("样本 A");
  const values = await page
    .locator(".quick-table tbody td:last-child")
    .allTextContents();
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(page.getByLabel("蛋白名称", { exact: true })).toHaveValue(
    "我的蛋白 α",
  );
  await expect(page.getByLabel("泳道 1 名称", { exact: true })).toHaveValue(
    "样本 A",
  );
  expect(
    await page.locator(".quick-table tbody td:last-child").allTextContents(),
  ).toEqual(values);
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const file = await pending;
  const svg = await readFile((await file.path())!, "utf8");
  expect(svg).toContain("Background-corrected relative intensity");
  expect(svg).toContain("我的蛋白 α");
  expect(svg).toContain("样本 A");
  expect(svg).not.toContain("自动草稿");
});

test("English controls fit at 390px and storage denial does not prevent language switching", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const mode of ["", "single", "quick"]) {
    await page.goto(`/?lang=en${mode ? `&mode=${mode}` : ""}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page
      .getByRole("button", { name: "Switch to Chinese", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  }
});

test("real-workspace errors retain their source and retranslate after an invalid archive", async ({
  page,
}) => {
  await page.goto("/?lang=en#real");
  await expect(
    page.getByRole("heading", {
      name: "Real Western blot workspace",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Import real project archive", { exact: true })
    .setInputFiles({
      name: "invalid.realwb.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("invalid archive"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "The project archive is not a valid ZIP file.",
  );
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "项目包不是有效的 ZIP 文件。",
  );
  await expect(page.getByRole("alert")).not.toContainText(
    "The project archive",
  );
});

test("automatic multi-row protein labels follow the language until the user edits them", async ({
  page,
}) => {
  const width = 360,
    height = 200;
  const pixels = new Uint8Array(width * height).fill(240);
  for (const row of [0, 1])
    for (let lane = 0; lane < 6; lane++)
      for (let y = 48 + row * 82; y < 64 + row * 82; y++)
        for (let x = 18 + lane * 60; x < 42 + lane * 60; x++)
          pixels[y * width + x] = 200 - lane * 20;
  await page.goto("/?mode=quick&lang=en");
  await page
    .getByLabel("Import band image", { exact: true })
    .setInputFiles({
      name: "我的实验.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        encode({ width, height, data: pixels, channels: 1, depth: 8 }),
      ),
    });
  await expect(page.getByLabel("Protein name", { exact: true })).toHaveValue(
    "Protein 1",
  );
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(page.getByLabel("蛋白名称", { exact: true })).toHaveValue(
    "蛋白 1",
  );
  await page.getByLabel("蛋白名称", { exact: true }).fill("手动名称 α");
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await expect(page.getByLabel("Protein name", { exact: true })).toHaveValue(
    "手动名称 α",
  );
  await expect(page.locator(".quick-source")).toContainText("我的实验.png");
});
