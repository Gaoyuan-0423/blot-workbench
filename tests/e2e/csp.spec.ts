import { expect, test } from "@playwright/test";
import { createQuickExample } from "../../src/quick/image";

for (const [name, route] of [
  ["home", "/"],
  ["single", "/?mode=single"],
  ["quick", "/?mode=quick"],
  ["real", "/#real"],
  ["demo", "/#demo"],
]) {
  test(`${name} keeps strict CSP without eval probes`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as unknown as { cspViolations: string[] }).cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        (
          window as unknown as { cspViolations: string[] }
        ).cspViolations.push(
          `${event.effectiveDirective}: ${event.blockedURI}`,
        );
      });
    });
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator("wisplab-platform")).toBeVisible();
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("'unsafe-eval'");
    if (name === "single") {
      await page
        .getByLabel("导入单排条带图片", { exact: true })
        .setInputFiles({
          name: "synthetic-csp.png",
          mimeType: "image/png",
          buffer: Buffer.from(createQuickExample().original!.bytes),
        });
      await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
      const platform = page.locator("wisplab-platform");
      await platform
        .getByRole("button", { name: "本地项目", exact: true })
        .click();
      const downloadPromise = page.waitForEvent("download");
      await platform
        .getByRole("button", { name: "下载当前项目", exact: true })
        .click();
      expect((await downloadPromise).suggestedFilename()).toMatch(/\.zip$/);
    }
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { cspViolations: string[] }).cspViolations,
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
