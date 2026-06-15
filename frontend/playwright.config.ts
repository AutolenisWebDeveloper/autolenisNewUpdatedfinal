import { defineConfig, devices } from "@playwright/test";

// Playwright config for AutoLenis e2e/browser tests.
// Run locally:  npx playwright install chromium && pnpm test:e2e
// CI sets BASE_URL to a deployed preview; locally it falls back to next dev,
// which Playwright will start automatically via `webServer` (disabled when
// PLAYWRIGHT_NO_SERVER is set, e.g. when pointing at an external BASE_URL).
const BASE_URL = process.env.BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const useExternalServer = !!process.env.BASE_URL || !!process.env.PLAYWRIGHT_NO_SERVER;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
