import { defineConfig } from "@playwright/test";

// This suite deliberately uses an isolated local service: its configuration is
// process-wide and must never replace credentials in a developer's running app.
export default defineConfig({
  testDir: "./tests/vision-e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  outputDir: "test-results-vision",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-vision" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4328",
    browserName: "chromium",
    channel: process.env.BROWSER_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run local:preview",
    env: { WB_PORT: "4328" },
    url: "http://127.0.0.1:4328",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
