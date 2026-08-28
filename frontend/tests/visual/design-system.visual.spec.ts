import { test, expect, type Page } from "@playwright/test";

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
//
// EACH PAGE IS GATED TWICE — pixels AND text. See the text assertion below for
// why the pixel gate alone is not sufficient.

const MARKETING = [
  { name: "home", path: "/" },
  { name: "for-buyers", path: "/for-buyers" },
  { name: "how-it-works", path: "/how-it-works" },
  { name: "refinance", path: "/refinance" },
  { name: "contact", path: "/contact" },
];

/**
 * The page's visible text, once it has stopped changing.
 *
 * Polls document.body.innerText until two consecutive readings match, because
 * some chrome (the cookie-consent banner) mounts client-side *after*
 * networkidle. Without this settle the capture is a race: the banner is present
 * in some runs and absent in others, a ~283-character swing that would make the
 * baseline flaky on / and /refinance. toHaveScreenshot does its own
 * stabilisation, so by the time this runs the page is usually already settled;
 * the poll makes that a guarantee rather than an assumption.
 *
 * Whitespace is collapsed so a reflow (which moves line breaks) is left to the
 * pixel gate and does not also churn the text baseline.
 */
async function settledText(pw: Page): Promise<string> {
  let previous: string | null = null;
  let current = "";
  let stableReads = 0;
  for (let i = 0; i < 40 && stableReads < 2; i++) {
    current = await pw.evaluate(() => document.body.innerText);
    stableReads = current === previous ? stableReads + 1 : 0;
    previous = current;
    if (stableReads < 2) await pw.waitForTimeout(250);
  }
  return current.replace(/\s+/g, " ").trim();
}

test.describe("marketing (frozen — any diff is a hard stop)", () => {
  for (const page of MARKETING) {
    test(`marketing:${page.name}`, async ({ page: pw }) => {
      const res = await pw.goto(page.path, { waitUntil: "networkidle" });
      // A page that fails to render (5xx) can't be a valid baseline — fail loud.
      expect(res?.status(), `${page.path} must render`).toBeLessThan(400);
      await expect(pw).toHaveScreenshot(`marketing-${page.name}.png`, { fullPage: true });

      // ── Copy freeze ───────────────────────────────────────────────────────
      // The pixel gate above runs at maxDiffPixelRatio 0.001, a tolerance that
      // exists to absorb anti-aliasing noise. That same tolerance also absorbs
      // a small IN-PLACE copy edit: swapping a few words changes glyphs without
      // moving layout, so the diff lands under 0.1% and PASSES.
      //
      // That is not hypothetical. Commit a3e4ec2 changed marketing copy on
      // /for-buyers and /how-it-works ("DocuSign E-Signing" -> "Secure
      // E-Signing"). FOUR snapshots drifted; only how-it-works [mobile]
      // reflowed enough to cross the threshold and fail. The other three went
      // green while genuinely stale, and the stale baseline sat on main for two
      // days.
      //
      // Marketing copy here carries product claims, so a silent copy drift is a
      // truthfulness risk, not just a cosmetic one. Text is compared exactly and
      // is independent of fonts and anti-aliasing, so it has no tolerance to
      // hide behind. Changing copy is fine — it just has to be an intentional,
      // reviewed baseline update, exactly like changing a pixel.
      //
      // Scope: innerText is the copy a visitor SEES. Image alt text, aria-labels,
      // <title>, meta/OG tags and JSON-LD are NOT frozen by this — see the
      // README's "What the text gate does NOT cover".
      expect(await settledText(pw)).toMatchSnapshot(`marketing-${page.name}.txt`);
    });
  }
});
