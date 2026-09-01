import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

// Visual-regression config (Phase 2 guardrail). Diffs screenshots of the pages
// that consume shared design-system primitives against a committed baseline, so
// token migration can't silently change rendered output.
//
// Runs against a BASE_URL (a running app: CI service-DB instance, or a deployed
// preview URL for the public marketing pages). It does NOT boot the app itself —
// point BASE_URL at a live instance. Update baselines intentionally with
// `pnpm test:visual:update` and review the image diff in the PR.
const BASE_URL = process.env.VISUAL_BASE_URL ?? "http://localhost:3000";

// Same pinned-Chromium fallback playwright.config.ts uses. The image ships a
// Chromium build under PLAYWRIGHT_BROWSERS_PATH that this @playwright/test
// version does not resolve to (it looks for a chromium_headless_shell revision
// that is not present), and `playwright install` is unavailable here — so without
// this the visual suite cannot launch a browser at all. PW_CHROMIUM_PATH still
// wins, and both fall back to Playwright's own resolution on a machine where the
// pinned path is absent.
const PINNED_CHROMIUM =
  process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

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
    launchOptions: existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
