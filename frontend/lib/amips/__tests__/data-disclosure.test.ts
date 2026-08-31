// BLOCKER 2(a) — a visible, machine-readable as-of date on every page carrying
// market, dealer or vehicle data.
//
// PRE-EXISTING (verified, not added by this batch):
//   app/(public)/intelligence/[slug]/page.tsx  — "Last Updated … · Data as of …"
//     freshness footer, data-testid="intelligence-freshness"
//   components/amips/MarketScoreTable.tsx      — "Computed from market data,
//     never estimated. Data as of {asOfLabel}." (market tiers only)
//
// TWO GAPS this batch closes:
//   1. Neither was MACHINE-READABLE — both rendered the date as plain text
//      inside a <p>. Now both use <time dateTime="YYYY-MM-DD">.
//   2. The page-level date was WRONG. `marketDataAsOf ?? vehicleDataAsOf` took
//      the first non-null by priority, not the oldest. Against owner-verified
//      production (market 66d, vehicle 85d) it advertised 66 days for a page
//      whose oldest load-bearing figure was 85 — understating staleness by 19
//      days on a pricing page.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = readFileSync(
  join(process.cwd(), "app/(public)/intelligence/[slug]/page.tsx"),
  "utf8",
);
const SCORE_TABLE = readFileSync(
  join(process.cwd(), "components/amips/MarketScoreTable.tsx"),
  "utf8",
);

describe("the as-of date is machine-readable", () => {
  test("the page freshness footer emits <time dateTime>", () => {
    assert.ok(/<time dateTime=\{asOf\}/.test(ROUTE), "data as-of must be a <time> element");
    assert.ok(/<time dateTime=\{lastUpdated\}/.test(ROUTE), "last-updated must be a <time> element");
  });

  test("the market score table emits <time dateTime>", () => {
    assert.ok(/<time dateTime=\{asOfLabel\}/.test(SCORE_TABLE));
  });

  test("both remain human-visible", () => {
    // Machine-readable must not mean hidden.
    assert.ok(/Data as of/.test(ROUTE));
    assert.ok(/Last Updated/.test(ROUTE));
    assert.ok(/Computed from market data, never estimated/.test(SCORE_TABLE));
  });

  test("the disclosure is addressable for testing", () => {
    assert.ok(/data-testid="intelligence-freshness"/.test(ROUTE));
    assert.ok(/data-testid="intelligence-data-as-of"/.test(ROUTE));
    assert.ok(/data-testid="market-score-as-of"/.test(SCORE_TABLE));
  });
});

describe("the disclosed date is the worst case", () => {
  test("the page uses oldestApplicableDataAsOf, not a ?? priority chain", () => {
    assert.ok(
      /const asOf = \(oldestApplicableDataAsOf\(page\)/.test(ROUTE),
      "must disclose the oldest applicable timestamp",
    );
    assert.ok(
      !/page\.marketDataAsOf \?\? page\.vehicleDataAsOf/.test(ROUTE),
      "the first-non-null chain understates staleness and must be gone",
    );
  });
});

describe("the withhold bound is enforced where pages are served and listed", () => {
  const TIER_SITEMAP = readFileSync(join(process.cwd(), "lib/amips/sitemap.ts"), "utf8");
  const INTEL_SITEMAP = readFileSync(
    join(process.cwd(), "app/sitemap-intelligence.xml/route.ts"),
    "utf8",
  );

  test("the route applies it", () => {
    assert.ok(/isPastWithholdBound\(page, Date\.now\(\)\)/.test(ROUTE));
  });

  test("both sitemaps apply it, so a withheld page is never advertised", () => {
    assert.ok(/isPastWithholdBound/.test(TIER_SITEMAP), "tier sitemap");
    assert.ok(/isPastWithholdBound/.test(INTEL_SITEMAP), "intelligence sitemap");
  });

  test("serving and listing use the same predicate", () => {
    // The discipline established with SERVABLE_LIFECYCLE_STATUSES: a page can
    // never be live-but-unlisted or listed-but-404.
    for (const [name, src] of [["route", ROUTE], ["tier", TIER_SITEMAP], ["intel", INTEL_SITEMAP]] as const) {
      assert.ok(/SERVABLE_LIFECYCLE_STATUSES/.test(src), `${name} status filter`);
      assert.ok(/isPastWithholdBound/.test(src), `${name} staleness bound`);
    }
  });
});
