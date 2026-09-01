// Playwright end-to-end config.
//
// Boots the REAL Next.js server against a REAL PostgreSQL database and drives it
// over HTTP. Chromium ships in the image at PLAYWRIGHT_BROWSERS_PATH
// (/opt/pw-browsers) — never run `playwright install`.
//
// SCOPE NOTE: buyer/dealer authentication is Supabase Auth, so an authenticated
// deep-journey E2E requires a live Supabase project. Where that is unavailable the
// specs assert the boundaries that ARE genuinely observable end to end (security
// surface removal, authorization enforcement, server health) rather than faking a
// session — see e2e/deal-autopilot.spec.ts.
//
// Run: pnpm test:e2e   (requires DATABASE_URL)

import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PINNED_CHROMIUM =
  process.env.E2E_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  // The image ships a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH that may not
  // match the build this @playwright/test version expects (it looks for a
  // chromium_headless_shell revision that isn't present). Point at the browser that
  // IS installed rather than downloading one — `playwright install` is unavailable
  // here. Falls back to Playwright's own resolution when the pinned path is absent,
  // so this config still works on a normal developer machine.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          ...(existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {}),
        },
      },
    },
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
