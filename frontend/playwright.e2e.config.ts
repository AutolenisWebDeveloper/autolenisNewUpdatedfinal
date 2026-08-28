import { defineConfig, devices } from "@playwright/test";

// Functional (behavioural) E2E config for the buyer portal.
//
// This is the SAME Playwright runner and the same conventions as
// playwright.visual.config.ts — a second config, not a second test framework.
// It is separate only because the two suites answer different questions and
// gate differently: the visual suite diffs pixels against a committed baseline
// (marketing diffs are a hard stop), while this one asserts behaviour and has no
// baseline at all.
//
// Like the visual harness, it does NOT boot the app: point E2E_BASE_URL at a
// running instance (a CI job with a seeded service-container Postgres, or a
// deployed preview). Auth-gated buyer flows additionally need a signed-in
// storage state — set E2E_STORAGE_STATE to a Playwright storageState JSON.
//
// Specs SKIP themselves with an explicit reason when their prerequisites are
// absent rather than passing vacuously: a suite that reports green because it
// checked nothing is worse than one that reports skipped.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Chromium is preinstalled in the CI/agent image; never run
    // `playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
    ...(process.env.E2E_STORAGE_STATE ? { storageState: process.env.E2E_STORAGE_STATE } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
