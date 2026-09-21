import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // Specs use isolated browser contexts and output paths. Two workers keep
  // the expanded R3/R4 suite within CI's limit without shortening game waits.
  ...(isCi ? { workers: 2 } : {}),
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    locale: "ja-JP",
    timezoneId: "UTC",
    colorScheme: "dark",
    screenshot: "on",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], hasTouch: true },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], hasTouch: true },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
});
