// Regression coverage for FIX 2 (Tier F staleness), FIX 3 (Tier C refresh with
// no refresh path) and FIX 4 (the leads-ratio branch).
//
// Production state that motivated these, owner-verified 2026-08-31:
//   794 amips_pages, leads_generated = 0 and clicks = 0 on every row.
//   All 382 Tier C pages non-ACTIVE; 208 of them REFRESH_REQUIRED.
//   Tier B ACTIVE pages carry null dealer/market dates and survived, because
//   Tier B is not a market-data tier.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasStaleData, shouldFlagLowConversion } from "@/lib/amips/lifecycle-manager";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 31); // 2026-08-31
const daysAgo = (n: number) => new Date(NOW - n * DAY);

describe("FIX 2 — Tier F is no longer stale from birth", () => {
  test("a Tier F page with fresh dealer+market dates is NOT stale", () => {
    // Pre-fix, the assembler never populated these two fields for Tier F while
    // the lifecycle manager checked them, so `dAge === null` returned true on
    // the first run and every Tier F page was REFRESH_REQUIRED forever.
    assert.equal(
      hasStaleData(
        {
          contentTier: "F",
          vehicleDataAsOf: daysAgo(10),
          dealerDataAsOf: daysAgo(10),
          marketDataAsOf: daysAgo(10),
        },
        NOW,
      ),
      false,
    );
  });

  test("a Tier F page with null dealer/market dates IS stale (the check still bites)", () => {
    // The fix populates the dates at generation; it does not weaken the check.
    assert.equal(
      hasStaleData(
        { contentTier: "F", vehicleDataAsOf: daysAgo(10), dealerDataAsOf: null, marketDataAsOf: null },
        NOW,
      ),
      true,
    );
  });

  test("Tier B ignores dealer/market dates entirely", () => {
    // Matches production: 185 Tier B ACTIVE pages carry null dates and survived.
    assert.equal(
      hasStaleData(
        { contentTier: "B", vehicleDataAsOf: daysAgo(10), dealerDataAsOf: null, marketDataAsOf: null },
        NOW,
      ),
      false,
    );
  });

  test("Tier C market data past 30 days is stale", () => {
    // Unchanged behaviour, pinned: this is what demoted the 208. FIX 3 changes
    // the CONSEQUENCE (REFRESH_REQUIRED now serves), not the detection.
    assert.equal(
      hasStaleData(
        { contentTier: "C", vehicleDataAsOf: daysAgo(10), dealerDataAsOf: daysAgo(10), marketDataAsOf: daysAgo(31) },
        NOW,
      ),
      true,
    );
  });

  test("vehicle data past 180 days is stale for every tier", () => {
    for (const contentTier of ["A", "B", "C", "F"]) {
      assert.equal(
        hasStaleData(
          { contentTier, vehicleDataAsOf: daysAgo(181), dealerDataAsOf: daysAgo(1), marketDataAsOf: daysAgo(1) },
          NOW,
        ),
        true,
        contentTier,
      );
    }
  });
});

describe("FIX 4 — the leads ratio treats unmeasured as unknown, not zero", () => {
  test("no lead tracking anywhere => never flagged, whatever the age or clicks", () => {
    // The exact production shape. Pre-fix this returned true and would have
    // de-indexed every page that earned a click once ages crossed 90 days.
    assert.equal(
      shouldFlagLowConversion({
        leadsTrackingActive: false,
        clicks: 5000,
        leadsGenerated: 0,
        pubAgeDays: 400,
      }),
      false,
    );
  });

  test("lead tracking live + genuine zero conversion => flagged", () => {
    // Once a writer exists the signal is real and the branch must resume working.
    assert.equal(
      shouldFlagLowConversion({
        leadsTrackingActive: true,
        clicks: 5000,
        leadsGenerated: 0,
        pubAgeDays: 400,
      }),
      true,
    );
  });

  test("healthy conversion is never flagged", () => {
    assert.equal(
      shouldFlagLowConversion({
        leadsTrackingActive: true,
        clicks: 1000,
        leadsGenerated: 50,
        pubAgeDays: 400,
      }),
      false,
    );
  });

  test("below the 90-day age gate => never flagged", () => {
    assert.equal(
      shouldFlagLowConversion({
        leadsTrackingActive: true,
        clicks: 5000,
        leadsGenerated: 0,
        pubAgeDays: 89,
      }),
      false,
    );
  });

  test("zero clicks => no ratio, never flagged (no division by zero)", () => {
    assert.equal(
      shouldFlagLowConversion({
        leadsTrackingActive: true,
        clicks: 0,
        leadsGenerated: 0,
        pubAgeDays: 400,
      }),
      false,
    );
  });

  test("unpublished page (null age) => never flagged", () => {
    assert.equal(
      shouldFlagLowConversion({
        leadsTrackingActive: true,
        clicks: 100,
        leadsGenerated: 0,
        pubAgeDays: null,
      }),
      false,
    );
  });

  test("the 0.1% threshold boundary", () => {
    const base = { leadsTrackingActive: true, clicks: 10_000, pubAgeDays: 400 };
    assert.equal(shouldFlagLowConversion({ ...base, leadsGenerated: 9 }), true); // 0.09%
    assert.equal(shouldFlagLowConversion({ ...base, leadsGenerated: 10 }), false); // exactly 0.1%
  });
});

describe("FIX 2 — every market-data tier's assembler return populates the as-of dates", () => {
  // hasStaleData() was never the defect on its own: given fresh dates it always
  // behaved. The defect was that the assembler's Tier F branch returned WITHOUT
  // dealerDataAsOf / marketDataAsOf, so the generator persisted nulls and the
  // lifecycle manager read them as stale. That is a property of the assembler's
  // source, so this test reads it — the same approach
  // lib/admin/__tests__/nav-capability-preservation.test.ts uses to assert a
  // structural promise that no runtime call can observe cheaply.
  const SOURCE = readFileSync(
    join(process.cwd(), "lib/amips/assembler.ts"),
    "utf8",
  );

  test("the Tier F branch returns both as-of dates", () => {
    const start = SOURCE.indexOf('if (tier === "F")');
    assert.ok(start > 0, "Tier F branch not found — has the assembler been restructured?");
    // The Tier F branch ends where the non-metro (Tier B) branch begins.
    const end = SOURCE.indexOf("if (!METRO_TIERS.has(tier))", start);
    assert.ok(end > start, "could not delimit the Tier F branch");
    const branch = SOURCE.slice(start, end);

    assert.ok(
      /dealerDataAsOf:/.test(branch),
      "Tier F return omits dealerDataAsOf — lifecycle will read null as permanently stale",
    );
    assert.ok(
      /marketDataAsOf:/.test(branch),
      "Tier F return omits marketDataAsOf — lifecycle will read null as permanently stale",
    );
  });

  test("the metro-tier branch still returns both as-of dates", () => {
    const tail = SOURCE.slice(SOURCE.indexOf("if (!queueItem.metro) return null;"));
    assert.ok(/dealerDataAsOf:/.test(tail));
    assert.ok(/marketDataAsOf:/.test(tail));
  });
});
