// The staleness runway — the signal that the withhold bound fires with warning
// rather than silently.
//
// Owner-verified production shape: all 393 servable pages share a withhold date
// of 2026-12-04. Tier B is included — its market and dealer dates are null but
// vehicle_data_as_of is populated for all 185 ACTIVE Tier B pages, and vehicle
// data applies to every tier. So the corpus does not decay page by page; it goes
// to 404 in one day.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeStalenessRunway,
  daysToWithhold,
  runwaySeverity,
  runwayAlertBody,
  runwayAlertTitle,
  RUNWAY_NOTICE_DAYS,
  RUNWAY_WARN_DAYS,
  RUNWAY_CRITICAL_DAYS,
} from "@/lib/amips/staleness-runway";
import { STALE_WITHHOLD_DAYS } from "@/lib/amips/tiers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 31); // 2026-08-31
const daysAgo = (n: number) => new Date(NOW - n * DAY);

// Vehicle data 85 days old, market/dealer 66 — the verified Tier C page.
const tierC = () => ({
  contentTier: "C",
  vehicleDataAsOf: daysAgo(85),
  dealerDataAsOf: daysAgo(66),
  marketDataAsOf: daysAgo(66),
});
// Tier B: vehicle populated, market/dealer null. Still withholds on vehicle.
const tierB = () => ({
  contentTier: "B",
  vehicleDataAsOf: daysAgo(85),
  dealerDataAsOf: null,
  marketDataAsOf: null,
});

describe("the verified production corpus", () => {
  const corpus = [
    ...Array.from({ length: 185 }, tierB), // ACTIVE Tier B
    ...Array.from({ length: 208 }, tierC), // REFRESH_REQUIRED Tier C
  ];

  test("393 servable pages, all withholding on the same day", () => {
    const r = computeStalenessRunway(corpus, NOW);
    assert.equal(r.servablePages, 393);
    assert.equal(r.minDaysToWithhold, STALE_WITHHOLD_DAYS - 85); // 95
    assert.equal(r.firstWithholdDate, "2026-12-04");
  });

  test("it is reported as a single-day cliff, not a ramp", () => {
    // The distinguishing fact. A ramp can be absorbed; a cliff cannot, and the
    // operator needs to know which one they are looking at.
    const r = computeStalenessRunway(corpus, NOW);
    assert.equal(r.isSingleDayCliff, true);
  });

  test("Tier B is included despite null market/dealer dates", () => {
    // The trap: Tier B looks exempt because two of its three dates are null.
    // Vehicle data applies to every tier, so all 185 withhold too.
    const r = computeStalenessRunway(Array.from({ length: 185 }, tierB), NOW);
    assert.equal(r.servablePages, 185);
    assert.equal(r.undatedPages, 0);
    assert.equal(r.minDaysToWithhold, 95);
  });

  test("at 95 days the severity is OK — the ladder has not fired yet", () => {
    const r = computeStalenessRunway(corpus, NOW);
    assert.equal(r.severity, "OK");
    assert.equal(r.within90, 0);
  });

  test("five days later it crosses into NOTICE", () => {
    // 90 days out. The first rung fires almost immediately, which is correct
    // given the cliff is real and dated — no fabricated urgency needed.
    const r = computeStalenessRunway(corpus, NOW + 5 * DAY);
    assert.equal(r.minDaysToWithhold, 90);
    assert.equal(r.severity, "NOTICE");
    assert.equal(r.within90, 393);
  });
});

describe("the escalation ladder", () => {
  test("thresholds are ordered and distinct", () => {
    assert.ok(RUNWAY_NOTICE_DAYS > RUNWAY_WARN_DAYS);
    assert.ok(RUNWAY_WARN_DAYS > RUNWAY_CRITICAL_DAYS);
    assert.ok(RUNWAY_CRITICAL_DAYS > 0);
  });

  test("each rung maps to the documented severity", () => {
    assert.equal(runwaySeverity(120), "OK");
    assert.equal(runwaySeverity(91), "OK");
    assert.equal(runwaySeverity(90), "NOTICE");
    assert.equal(runwaySeverity(46), "NOTICE");
    assert.equal(runwaySeverity(45), "WARN");
    assert.equal(runwaySeverity(22), "WARN");
    assert.equal(runwaySeverity(21), "CRITICAL");
    assert.equal(runwaySeverity(1), "CRITICAL");
  });

  test("past the cliff is CRITICAL, not silently OK", () => {
    assert.equal(runwaySeverity(0), "CRITICAL");
    assert.equal(runwaySeverity(-30), "CRITICAL");
  });

  test("CRITICAL leaves room for a two-week absence plus a week to act", () => {
    // The justification for 21 rather than 14: a standard two-week absence must
    // not consume the entire window before anyone can run the manual seed.
    assert.ok(RUNWAY_CRITICAL_DAYS >= 14 + 7);
  });

  test("WARN leaves more than one monthly planning cycle", () => {
    // 45 rather than 30: exactly one cycle would leave zero slack if that cycle
    // is already committed.
    assert.ok(RUNWAY_WARN_DAYS > 30);
  });

  test("nothing dated => OK, never a false alarm", () => {
    assert.equal(runwaySeverity(null), "OK");
  });
});

describe("buckets and edge cases", () => {
  test("buckets are cumulative and count the right pages", () => {
    const r = computeStalenessRunway(
      [
        { contentTier: "B", vehicleDataAsOf: daysAgo(STALE_WITHHOLD_DAYS - 10), dealerDataAsOf: null, marketDataAsOf: null },
        { contentTier: "B", vehicleDataAsOf: daysAgo(STALE_WITHHOLD_DAYS - 40), dealerDataAsOf: null, marketDataAsOf: null },
        { contentTier: "B", vehicleDataAsOf: daysAgo(STALE_WITHHOLD_DAYS - 75), dealerDataAsOf: null, marketDataAsOf: null },
        { contentTier: "B", vehicleDataAsOf: daysAgo(STALE_WITHHOLD_DAYS - 200), dealerDataAsOf: null, marketDataAsOf: null },
      ],
      NOW,
    );
    assert.equal(r.within30, 1);   // 10d
    assert.equal(r.within60, 2);   // 10d, 40d
    assert.equal(r.within90, 3);   // 10d, 40d, 75d
    assert.equal(r.isSingleDayCliff, false);
    assert.equal(r.severity, "CRITICAL"); // min is 10d
  });

  test("pages already past the bound are counted separately", () => {
    const r = computeStalenessRunway(
      [{ contentTier: "C", vehicleDataAsOf: daysAgo(200), dealerDataAsOf: daysAgo(200), marketDataAsOf: daysAgo(200) }],
      NOW,
    );
    assert.equal(r.alreadyWithheld, 1);
    assert.equal(r.severity, "CRITICAL");
    assert.ok((r.minDaysToWithhold ?? 0) < 0);
  });

  test("undated pages are excluded, not treated as expiring", () => {
    const r = computeStalenessRunway(
      [
        { contentTier: "B", vehicleDataAsOf: null, dealerDataAsOf: null, marketDataAsOf: null },
        tierC(),
      ],
      NOW,
    );
    assert.equal(r.undatedPages, 1);
    assert.equal(r.servablePages, 2);
    assert.equal(r.minDaysToWithhold, 95);
  });

  test("an empty corpus is OK with nulls, not a crash", () => {
    const r = computeStalenessRunway([], NOW);
    assert.equal(r.severity, "OK");
    assert.equal(r.minDaysToWithhold, null);
    assert.equal(r.firstWithholdDate, null);
    assert.equal(r.isSingleDayCliff, false);
  });

  test("daysToWithhold derives from the OLDEST applicable date", () => {
    // Tier C: vehicle 85d is older than market/dealer 66d, so it governs.
    assert.equal(daysToWithhold(tierC(), NOW), 95);
  });
});

describe("the alert names the manual remedy", () => {
  test("escalation lives in the title so a higher rung breaks through", () => {
    // health-alert.service.ts dedupes on source+title while unresolved, and
    // documents that escalation must therefore be expressed in the title.
    assert.notEqual(runwayAlertTitle("WARN"), runwayAlertTitle("CRITICAL"));
    assert.match(runwayAlertTitle("CRITICAL"), /CRITICAL/);
  });

  test("the body states the cliff, the date and the manual remedy", () => {
    const body = runwayAlertBody(computeStalenessRunway([tierC(), tierB()], NOW));
    assert.match(body, /2026-12-04/);
    assert.match(body, /one day, not gradually/);
    assert.match(body, /vehicle-intelligence\.seed\.ts/);
    assert.match(body, /sync-market-intelligence/);
    // The trap worth naming explicitly in the alert itself.
    assert.match(body, /Regenerating pages will NOT clear this/);
  });

  test("once dark, the body says so in the present tense", () => {
    const r = computeStalenessRunway(
      [{ contentTier: "C", vehicleDataAsOf: daysAgo(200), dealerDataAsOf: daysAgo(200), marketDataAsOf: daysAgo(200) }],
      NOW,
    );
    assert.match(runwayAlertBody(r), /returning 404 now/);
  });
});
