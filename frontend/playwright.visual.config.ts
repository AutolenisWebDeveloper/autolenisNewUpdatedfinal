import { defineConfig, devices } from "@playwright/test";

// Visual-regression config (Phase 2 guardrail). Diffs screenshots of the pages
// that consume shared design-system primitives against a committed baseline, so
// token migration can't silently change rendered output.
//
// Runs against a BASE_URL (a running app: CI service-DB instance, or a deployed
// preview URL for the public marketing pages). It does NOT boot the app itself —
// point BASE_URL at a live instance. Update baselines intentionally with
// `pnpm test:visual:update` and review the image diff in the PR.
const BASE_URL = process.env.VISUAL_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/visual",
  snapshotDir: "./tests/visual/__baseline__",
  // Stable filenames across machines/OS so the committed baseline matches CI.
  snapshotPathTemplate: "{snapshotDir}/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    // 0.1% pixel tolerance — anti-aliasing noise passes, real color/layout
    // changes fail. Marketing diffs are a hard stop (see the spec's tags).
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled" },
  },
  use: {
    baseURL: BASE_URL,
    // Chromium is preinstalled in this environment; do not download.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
