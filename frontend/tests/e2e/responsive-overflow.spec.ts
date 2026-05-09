// Playwright overflow regression test — asserts that no public route has
// horizontal overflow at 375px / 768px / 1280px. To run:
//   yarn add -D @playwright/test && npx playwright install chromium
//   npx playwright test tests/e2e/responsive-overflow.spec.ts
//
// Ships unwired by default — the file is self-contained and the testing-agent
// fork environment can pick it up directly. CI integration TBD.

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const PUBLIC_ROUTES = [
  "/",
  "/how-it-works",
  "/inventory",
  "/for-buyers",
  "/for-dealers",
  "/for-affiliates",
  "/pricing",
  "/refinance",
  "/about",
  "/contact",
  "/trust",
  "/contract-shield",
  "/faq",
  "/legal/buyer-terms",
  "/legal/dealer-terms",
  "/legal/privacy",
  "/auth/signin",
  "/auth/signup",
];

const BREAKPOINTS: Array<{ name: string; width: number; height: number }> = [
  { name: "mobile-375", width: 375, height: 800 },
  { name: "tablet-768", width: 768, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
];

test.describe("Responsive: no horizontal overflow on public routes", () => {
  for (const bp of BREAKPOINTS) {
    test.describe(bp.name, () => {
      test.use({ viewport: { width: bp.width, height: bp.height } });

      for (const path of PUBLIC_ROUTES) {
        test(`${path} fits viewport at ${bp.width}px`, async ({ page }) => {
          await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(800);
          const dims = await page.evaluate(() => ({
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            bodyScrollW: document.body.scrollWidth,
          }));
          // 1px tolerance for sub-pixel rounding.
          expect(
            dims.scrollW,
            `scrollWidth (${dims.scrollW}) > clientWidth (${dims.clientW}) at ${bp.width}px on ${path}`,
          ).toBeLessThanOrEqual(dims.clientW + 1);
          expect(
            dims.bodyScrollW,
            `body scrollWidth (${dims.bodyScrollW}) > clientWidth (${dims.clientW}) at ${bp.width}px on ${path}`,
          ).toBeLessThanOrEqual(dims.clientW + 1);
        });
      }
    });
  }
});
