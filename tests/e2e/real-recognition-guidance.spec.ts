import { test, expect } from "@playwright/test";
import { encode as encodePng } from "fast-png";

function image(name: string, withBands: boolean) {
  const width = 120,
    height = 64;
  const data = new Uint8Array(width * height).fill(220);
  if (withBands)
    for (const left of [20, 75])
      for (let y = 24; y < 32; y++)
        for (let x = left; x < left + 20; x++) data[y * width + x] = 90;
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(
      encodePng({ width, height, depth: 8, channels: 1, data }),
    ),
  };
}

test("original import states the next step and distinguishes successful candidates from a failed image", async ({
  page,
}) => {
  await page.goto("/?lang=en#real");
  await page
    .getByLabel("Choose original WB images", { exact: true })
    .setInputFiles([
      image("Target_rep1.png", true),
      image("Target_rep2.png", false),
    ]);
  const progress = page.getByTestId("real-recognition-progress");
  await expect(progress).toContainText("recognition not started");
  await expect(progress).toContainText("2 awaiting recognition");
  await expect(progress).toContainText(
    "3 lane labels configured; 2 included in quantification",
  );
  await page
    .getByLabel("Lane description", { exact: true })
    .fill("1=NC; 2=Drug; 3=marker");
  await expect(progress).toContainText("unapplied changes");
  await expect(
    page.getByRole("button", { name: "Recognize & view bands", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run all & report", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Parse & preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm for all images", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recognize & view bands", exact: true })
    .click();
  await expect(progress).toContainText(
    "0 awaiting recognition · 1 with candidates · 1 incomplete",
  );
  await expect(page.locator(".real-editor-toolbar strong")).toHaveText(
    "Target_rep2.png",
  );
  await expect(page.locator(".real-recognition-error")).toContainText(
    "No band row has sufficient contrast",
  );
  await expect(
    page
      .locator(".real-recognition-error")
      .getByRole("button", { name: "Place regions manually", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".real-recognition-error")
      .getByRole("link", { name: "Use single-strip recognition", exact: true }),
  ).toHaveAttribute("href", /mode=single.*lang=en/);
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(progress).toContainText("已有候选 1 张 · 未完成 1 张");
  await expect(page.locator(".real-notice")).toContainText(
    "已有候选区域 1 张，识别未完成 1 张",
  );
  await expect(page.locator(".real-recognition-error")).toContainText(
    "没有找到对比度足够的条带行",
  );
  await expect(page.locator(".real-mapping-table tbody tr")).toHaveCount(2);
});

test("the empty region example action loads the example instead of exporting an empty project", async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.goto("/?lang=en#real");
  await page
    .getByRole("button", { name: "Load the built-in example", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "Replace the current real workspace?",
  );
  expect(downloads).toEqual([]);
});
