// BLOCKER 2 — FIX 3 removed staleness as a withholding condition and, with no
// refresh path, left no upper bound at all.
//
// The original justification assumed 31-day-old market data. Owner-verified
// production is materially worse and unbounded going forward:
//   market_data_as_of   66 days
//   dealer_data_as_of   66 days
//   vehicle_data_as_of  85 days
//
// These are vehicle-pricing and dealer pages. At 66 days the figures are aging;
// with no bound they eventually become wrong. STALE_WITHHOLD_DAYS is the
// backstop, and it is FRESHNESS_DAYS.vehicle — the age at which Gate 5 already
// refuses to GENERATE — so the invariant is "serve only what we would still be
// willing to publish".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_WITHHOLD_DAYS,
  isPastWithholdBound,
  oldestApplicableDataAsOf,
} from "@/lib/amips/tiers";
import { FRESHNESS_DAYS } from "@/lib/amips/assembler";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 31); // 2026-08-31
const daysAgo = (n: number) => new Date(NOW - n * DAY);

// The owner-verified production page shape.
const PROD_TIER_C = {
  contentTier: "C",
  vehicleDataAsOf: daysAgo(85),
  dealerDataAsOf: daysAgo(66),
  marketDataAsOf: daysAgo(66),
};

describe("the bound is the publication gate, not a new number", () => {
  test("STALE_WITHHOLD_DAYS equals FRESHNESS_DAYS.vehicle", () => {
    // Pinned so the two cannot drift. tiers.ts defines the constant locally to
    // avoid an import cycle; this test is what keeps them equal.
    assert.equal(STALE_WITHHOLD_DAYS, FRESHNESS_DAYS.vehicle);
    assert.equal(STALE_WITHHOLD_DAYS, 180);
  });

  test("it is a backstop, not a refresh trigger", () => {
    // 6x the market gate and 2x the dealer gate: a page must be six market
    // refresh cycles overdue before it goes dark. This is what stops it being a
    // re-run of the 30-day defect.
    assert.ok(STALE_WITHHOLD_DAYS >= FRESHNESS_DAYS.market * 6);
    assert.ok(STALE_WITHHOLD_DAYS >= FRESHNESS_DAYS.dealer * 2);
  });
});

describe("verified production staleness does NOT withhold today", () => {
  test("85/66/66 days is inside the bound", () => {
    // The property that matters: the backstop must not dark anything now.
    assert.equal(isPastWithholdBound(PROD_TIER_C, NOW), false);
  });

  test("~95 days of headroom remain", () => {
    const oldest = oldestApplicableDataAsOf(PROD_TIER_C);
    assert.ok(oldest);
    const ageDays = (NOW - oldest.getTime()) / DAY;
    assert.equal(Math.round(ageDays), 85);
    assert.ok(STALE_WITHHOLD_DAYS - ageDays > 90, "expected meaningful headroom");
  });
});

describe("the bound does bite past 180 days", () => {
  test("181-day-old vehicle data withholds", () => {
    assert.equal(
      isPastWithholdBound(
        { contentTier: "C", vehicleDataAsOf: daysAgo(181), dealerDataAsOf: daysAgo(1), marketDataAsOf: daysAgo(1) },
        NOW,
      ),
      true,
    );
  });

  test("exactly 180 days does not withhold (strict >)", () => {
    assert.equal(
      isPastWithholdBound(
        { contentTier: "C", vehicleDataAsOf: daysAgo(180), dealerDataAsOf: daysAgo(1), marketDataAsOf: daysAgo(1) },
        NOW,
      ),
      false,
    );
  });

  test("181-day-old MARKET data withholds a market tier", () => {
    // The bound keys on the OLDEST applicable field, not just vehicle.
    assert.equal(
      isPastWithholdBound(
        { contentTier: "C", vehicleDataAsOf: daysAgo(1), dealerDataAsOf: daysAgo(1), marketDataAsOf: daysAgo(181) },
        NOW,
      ),
      true,
    );
  });

  test("stale market data does NOT withhold a non-market tier", () => {
    // Tier B carries null dealer/market dates in production and must be
    // unaffected — applicability matches hasStaleData.
    assert.equal(
      isPastWithholdBound(
        { contentTier: "B", vehicleDataAsOf: daysAgo(10), dealerDataAsOf: daysAgo(999), marketDataAsOf: daysAgo(999) },
        NOW,
      ),
      false,
    );
  });

  test("a page with no applicable timestamp is not withheld", () => {
    // Would dark rows for an unprovable reason. The generator sets
    // vehicleDataAsOf on every path, so this case does not arise in practice.
    assert.equal(
      isPastWithholdBound(
        { contentTier: "B", vehicleDataAsOf: null, dealerDataAsOf: null, marketDataAsOf: null },
        NOW,
      ),
      false,
    );
  });
});

describe("oldestApplicableDataAsOf reports the worst case", () => {
  test("returns the OLDEST, not the first non-null", () => {
    // The disclosure defect: `marketDataAsOf ?? vehicleDataAsOf` advertised 66
    // days for a page whose oldest load-bearing figure was 85.
    const oldest = oldestApplicableDataAsOf(PROD_TIER_C);
    assert.equal(oldest?.getTime(), daysAgo(85).getTime());
  });

  test("ignores dealer/market on a non-market tier", () => {
    const oldest = oldestApplicableDataAsOf({
      contentTier: "B",
      vehicleDataAsOf: daysAgo(10),
      dealerDataAsOf: daysAgo(500),
      marketDataAsOf: daysAgo(500),
    });
    assert.equal(oldest?.getTime(), daysAgo(10).getTime());
  });

  test("includes dealer/market on Tier F (a market-data tier)", () => {
    const oldest = oldestApplicableDataAsOf({
      contentTier: "F",
      vehicleDataAsOf: daysAgo(10),
      dealerDataAsOf: daysAgo(120),
      marketDataAsOf: daysAgo(5),
    });
    assert.equal(oldest?.getTime(), daysAgo(120).getTime());
  });

  test("returns null when nothing applicable is populated", () => {
    assert.equal(
      oldestApplicableDataAsOf({
        contentTier: "B",
        vehicleDataAsOf: null,
        dealerDataAsOf: null,
        marketDataAsOf: null,
      }),
      null,
    );
  });
});
