// Regression: a transaction-backed Tier F page must not read as stale merely
// because the OPTIONAL market rows are absent.
//
// Tier F qualifies on the AutoLenis transaction record alone — see
// tier-f-threshold.pipeline.ts, which seeds queue items from a >=50-transaction
// count and never consults amipsMarketScore / marketIntelligence. The assembler
// says the same in its own words: the score row is fetched "if available (not
// freshness-gated for Tier F — the proven transaction record is the source of
// authority)", and dealerCount has an explicit fallback for its absence.
//
// Adding F to MARKET_DATA_TIERS (so the assembler, Gate 5 and the lifecycle
// manager finally agree on one tier set) made both freshness paths demand
// dealerDataAsOf / marketDataAsOf for F. Left null, that combination is fatal
// twice over: Gate 5 scores 4 -> REVIEW_NEEDED at generation, and hasStaleData
// returns true forever -> REFRESH_REQUIRED on every lifecycle run. A page whose
// data is genuinely current would be withheld for missing rows it never needed.
//
// The transaction record is the right fallback, not an exemption: it is
// non-nullable (AutolenisIntelligence.lastUpdated is DateTime @default(now()))
// and the pipeline refreshes it on every aggregation, so a Tier F page still
// ages honestly if that aggregation stalls.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hasStaleData } from "../lifecycle-manager";
import { tierFDataAsOf } from "../tiers";

const NOW = new Date("2026-08-31T00:00:00Z").getTime();
const fresh = new Date("2026-08-29T00:00:00Z"); // 2 days old

describe("Tier F freshness with no market rows", () => {
  test("a fresh Tier F page with market dates present is not stale", () => {
    assert.equal(
      hasStaleData(
        {
          contentTier: "F",
          vehicleDataAsOf: fresh,
          dealerDataAsOf: fresh,
          marketDataAsOf: fresh,
        },
        NOW,
      ),
      false,
    );
  });

  test("null market dates make a Tier F page stale — why the fallback is required", () => {
    // This is the behaviour the assembler must never produce for Tier F. It is
    // correct for C/D/E, where a missing row means the page is not assembled at
    // all (assembler.ts returns null on !marketRow / !scoreRow).
    assert.equal(
      hasStaleData(
        {
          contentTier: "F",
          vehicleDataAsOf: fresh,
          dealerDataAsOf: null,
          marketDataAsOf: null,
        },
        NOW,
      ),
      true,
    );
  });
});

describe("the assembler supplies a date for Tier F even with no market rows", () => {
  // Exercises the REAL function the assembler spreads into its Tier F return,
  // so this cannot pass while the assembler does something else.
  function tierFDates(
    scoreRow: { computedAt: Date } | null,
    marketRow: { lastUpdated: Date } | null,
    al: { lastUpdated: Date },
  ) {
    return tierFDataAsOf({
      scoreComputedAt: scoreRow?.computedAt,
      marketLastUpdated: marketRow?.lastUpdated,
      transactionLastUpdated: al.lastUpdated,
    });
  }

  test("no score row and no market row still yields a fresh, non-stale page", () => {
    const dates = tierFDates(null, null, { lastUpdated: fresh });
    assert.equal(dates.dealerDataAsOf, fresh);
    assert.equal(dates.marketDataAsOf, fresh);
    assert.equal(
      hasStaleData({ contentTier: "F", vehicleDataAsOf: fresh, ...dates }, NOW),
      false,
      "a transaction-backed Tier F page must serve when its transactions are current",
    );
  });

  test("the fallback does not mask a genuinely stale transaction record", () => {
    const old = new Date("2026-01-01T00:00:00Z"); // ~242 days
    const dates = tierFDates(null, null, { lastUpdated: old });
    assert.equal(
      hasStaleData({ contentTier: "F", vehicleDataAsOf: fresh, ...dates }, NOW),
      true,
      "Tier F must still age out when its own transaction aggregation stalls",
    );
  });

  test("a present score row still wins over the fallback", () => {
    const scoreAt = new Date("2026-08-30T00:00:00Z");
    const dates = tierFDates({ computedAt: scoreAt }, null, { lastUpdated: fresh });
    assert.equal(dates.dealerDataAsOf, scoreAt, "real data must not be overridden");
    assert.equal(dates.marketDataAsOf, fresh);
  });
});
