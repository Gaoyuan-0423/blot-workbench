import { test, expect } from "@playwright/test";

test("home connects the independent strip workflow and preserves existing workspaces", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('.home a[href="?mode=single"]')).toBeVisible();
  await expect(page.locator('.home a[href="?mode=quick"]')).toBeVisible();
  await expect(page.locator(".suite-nav a")).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("home-desktop.png"),
    fullPage: true,
  });
  await page.locator('.home a[href="?mode=single"]').click();
  await expect(
    page.getByRole("heading", { name: "单条带识别", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await page.getByRole("link", { name: "返回工作台", exact: true }).click();
  await page.locator('.home a[href="#real"]').click();
  await expect(page.locator(".real-header")).toBeVisible();
  await page.goto("/#demo");
  await expect(
    page.getByRole("heading", { name: "项目总览", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile home keeps the primary entry visible and language navigation usable", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('.home a[href="?mode=single"]')).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("home-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await expect(page.locator(".home")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.locator(".home")).toHaveAttribute("lang", "en");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
