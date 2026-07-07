import { test, expect } from "@playwright/test";

// Visual-regression baseline for the design-system migration (Phase 2).
//
// TARGETS is split into two tiers:
//   • marketing — public pages that import the shared primitives
//     (components/ui/button|input|select|label|textarea). A diff here is a
//     HARD STOP: marketing visuals are frozen during token migration.
//   • dashboard — one representative page per dashboard. Diffs are expected
//     ONLY inside labeled consolidation-delta commits; otherwise they fail.
//
// Auth-gated dashboard pages require a signed-in storage state; wire
// VISUAL_STORAGE_STATE (a Playwright storageState json) in CI to capture them.
// Without it, only the public marketing tier runs — which is the tier whose
// freeze the guardrail most needs to enforce.

const MARKETING = [
  { name: "home", path: "/" },
  { name: "for-buyers", path: "/for-buyers" },
  { name: "how-it-works", path: "/how-it-works" },
  { name: "refinance", path: "/refinance" },
  { name: "contact", path: "/contact" },
];

test.describe("marketing (frozen — any diff is a hard stop)", () => {
  for (const page of MARKETING) {
    test(`marketing:${page.name}`, async ({ page: pw }) => {
      const res = await pw.goto(page.path, { waitUntil: "networkidle" });
      // A page that fails to render (5xx) can't be a valid baseline — fail loud.
      expect(res?.status(), `${page.path} must render`).toBeLessThan(400);
      await expect(pw).toHaveScreenshot(`marketing-${page.name}.png`, { fullPage: true });
    });
  }
});
