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


/**
 * The page's machine-facing copy — the surfaces a visitor never sees rendered
 * but search engines and screen readers consume directly: <title>, meta
 * description, canonical, OG/Twitter tags, robots, image alt text, aria-labels,
 * and JSON-LD structured data.
 *
 * A change to any of these is a 0.000% pixel diff and is invisible to
 * innerText, so BOTH existing gates are blind to it — strictly blinder than the
 * a3e4ec2 in-place copy edit that motivated the text gate. These surfaces carry
 * product claims (FAQ answers in JSON-LD, business identity in LocalBusiness,
 * page claims in descriptions), so they are frozen the same way: exactly, with
 * a reviewed baseline update as the only way to change them.
 *
 * Determinism choices, each deliberate:
 *  - Values are whitespace-collapsed; extraction is DOM order for alt/aria
 *    (order changes are structural changes and should fail) and attribute-
 *    sorted for og/twitter meta (Next.js emits them from an object, so relying
 *    on emission order would couple the baseline to framework internals).
 *  - JSON-LD is parsed and re-serialised with 2-space indentation so a diff
 *    shows the changed FIELD, not a 1-line blob. Key order is preserved as
 *    authored — reordering keys changes bytes crawlers see cached, and a
 *    reorder failing the gate is acceptable.
 *  - Same settle discipline as settledText: client-mounted chrome (the
 *    cookie-consent banner) adds aria-labels after networkidle, so poll until
 *    two consecutive extractions match.
 */
async function settledMetadata(pw: Page): Promise<string> {
  const extract = () =>
    pw.evaluate(() => {
      const ws = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
      const lines: string[] = [];

      lines.push("[title]", ws(document.title), "");

      const desc = document.querySelector('meta[name="description"]');
      lines.push("[meta:description]", ws(desc?.getAttribute("content")), "");

      const canonical = document.querySelector('link[rel="canonical"]');
      lines.push("[canonical]", ws(canonical?.getAttribute("href")), "");

      const robots = document.querySelector('meta[name="robots"]');
      lines.push("[robots]", ws(robots?.getAttribute("content")), "");

      const social: string[] = [];
      for (const m of document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')) {
        const key = m.getAttribute("property") ?? m.getAttribute("name") ?? "";
        social.push(`${key} = ${ws(m.getAttribute("content"))}`);
      }
      lines.push("[social]", ...social.sort(), "");

      const alts: string[] = [];
      for (const img of document.querySelectorAll("img")) {
        alts.push(`- ${ws(img.getAttribute("alt"))}`);
      }
      lines.push("[img:alt]", ...alts, "");

      const arias: string[] = [];
      for (const el of document.querySelectorAll("[aria-label]")) {
        arias.push(`- ${el.tagName.toLowerCase()}: ${ws(el.getAttribute("aria-label"))}`);
      }
      lines.push("[aria-label]", ...arias, "");

      const lds: string[] = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          lds.push(JSON.stringify(JSON.parse(s.textContent ?? ""), null, 2));
        } catch {
          // Unparseable JSON-LD is itself a defect worth surfacing in the diff.
          lds.push(`UNPARSEABLE: ${ws(s.textContent)}`);
        }
      }
      lines.push("[json-ld]", ...lds);

      // The app's own origin (NEXT_PUBLIC_APP_URL) appears in canonical, og:url,
      // og:image and JSON-LD ids. It is deployment CONFIG, not copy: locally it
      // is http://localhost:3000, on a preview it is the preview URL. Freezing
      // it would make the baseline assert where the app is deployed rather than
      // what it says, and would break the moment CI supplies a real
      // NEXT_PUBLIC_APP_URL secret. Normalise it to a placeholder; the PATH part
      // of every URL stays frozen.
      return lines.join("\n").split(location.origin).join("{origin}");
    });

  let previous: string | null = null;
  let current = "";
  let stableReads = 0;
  for (let i = 0; i < 40 && stableReads < 2; i++) {
    current = await extract();
    stableReads = current === previous ? stableReads + 1 : 0;
    previous = current;
    if (stableReads < 2) await pw.waitForTimeout(250);
  }
  return current;
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
      // <title>, meta/OG tags and JSON-LD are frozen by the METADATA gate below.
      expect(await settledText(pw)).toMatchSnapshot(`marketing-${page.name}.txt`);

      // ── Metadata freeze ───────────────────────────────────────────────────
      // The third gate. Alt text, aria-labels, <title>, meta description,
      // canonical, OG/Twitter and JSON-LD change ZERO pixels and are invisible
      // to innerText — the two gates above cannot see them at all. They carry
      // product claims to crawlers and screen readers, so they get the same
      // freeze: exact comparison, no tolerance, reviewed baseline updates only.
      expect(await settledMetadata(pw)).toMatchSnapshot(`marketing-${page.name}.meta.txt`);
    });
  }
});
