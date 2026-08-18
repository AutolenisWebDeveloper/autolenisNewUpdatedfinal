// S5 — pure funnel-alert evaluator. Given the derived snapshot counts + tuned
// thresholds, decide which alerts to raise — no DB, no network, fully
// deterministic. The two failure counters are evaluated INDEPENDENTLY (never
// unioned) and drop-off is evaluated per adjacent funnel stage.
//
// Run with:
//   npx tsx --test lib/services/analytics/__tests__/funnel-alerts.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFunnelAlerts,
  DEFAULT_FUNNEL_ALERT_THRESHOLDS,
  type FunnelSnapshotCounts,
} from "@/lib/services/analytics/funnel-observability.service";

const HEALTHY_STAGES = [
  { metric: "requests_submitted", count: 1000 },
  { metric: "requests_active_sourcing", count: 800 },
  { metric: "requests_offer_ready", count: 600 },
  { metric: "requests_offer_accepted", count: 400 },
  { metric: "requests_deal_created", count: 300 },
  { metric: "deals_completed", count: 250 },
];

function counts(over: Partial<FunnelSnapshotCounts> = {}): FunnelSnapshotCounts {
  return {
    stages: HEALTHY_STAGES,
    requestsClosedNoMatch: 0,
    auctionsClosedZeroOffers: 0,
    ...over,
  };
}

const T = DEFAULT_FUNNEL_ALERT_THRESHOLDS;

test("a fully healthy funnel raises no alerts", () => {
  assert.deepEqual(evaluateFunnelAlerts(counts(), T), []);
});

test("requests_closed_no_match fires at (not below) the threshold", () => {
  const below = evaluateFunnelAlerts(
    counts({ requestsClosedNoMatch: T.requestsClosedNoMatchPer24h - 1 }),
    T,
  );
  assert.equal(below.length, 0, "one below threshold → no alert");

  const at = evaluateFunnelAlerts(
    counts({ requestsClosedNoMatch: T.requestsClosedNoMatchPer24h }),
    T,
  );
  assert.equal(at.length, 1);
  assert.equal(at[0]!.metric, "requests_closed_no_match");
});

test("auctions_closed_zero_offers fires independently of requests_closed_no_match", () => {
  const alerts = evaluateFunnelAlerts(
    counts({ auctionsClosedZeroOffers: T.auctionsClosedZeroOffersPer24h }),
    T,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.metric, "auctions_closed_zero_offers");
});

test("both failure counters fire as TWO separate alerts (never unioned)", () => {
  const alerts = evaluateFunnelAlerts(
    counts({
      requestsClosedNoMatch: T.requestsClosedNoMatchPer24h,
      auctionsClosedZeroOffers: T.auctionsClosedZeroOffersPer24h,
    }),
    T,
  );
  const metrics = alerts.map((a) => a.metric).sort();
  assert.deepEqual(metrics, ["auctions_closed_zero_offers", "requests_closed_no_match"]);
});

test("a failure counter at >= 3x threshold escalates to severe (page)", () => {
  const normal = evaluateFunnelAlerts(
    counts({ requestsClosedNoMatch: T.requestsClosedNoMatchPer24h }),
    T,
  );
  assert.equal(normal[0]!.severe, false);
  assert.equal(normal[0]!.level, "P2");

  const severe = evaluateFunnelAlerts(
    counts({ requestsClosedNoMatch: T.requestsClosedNoMatchPer24h * 3 }),
    T,
  );
  assert.equal(severe[0]!.severe, true);
  assert.equal(severe[0]!.level, "P1");
});

test("a stage-to-stage collapse below the drop-off floor raises a drop-off alert", () => {
  const collapsed = [
    { metric: "requests_submitted", count: 1000 },
    { metric: "requests_active_sourcing", count: 20 }, // 2% conversion, floor is higher
    { metric: "requests_offer_ready", count: 15 },
    { metric: "requests_offer_accepted", count: 10 },
    { metric: "requests_deal_created", count: 8 },
    { metric: "deals_completed", count: 6 },
  ];
  const alerts = evaluateFunnelAlerts(counts({ stages: collapsed }), T);
  const dropoff = alerts.find((a) => a.metric.startsWith("dropoff:"));
  assert.ok(dropoff, "a drop-off alert is raised for the collapsed stage");
  assert.equal(dropoff!.metric, "dropoff:requests_submitted->requests_active_sourcing");
});

test("drop-off is ignored when upstream volume is below the minimum (noise floor)", () => {
  const tiny = [
    { metric: "requests_submitted", count: T.dropoffMinUpstream - 1 },
    { metric: "requests_active_sourcing", count: 0 }, // 0% but upstream too small to matter
    { metric: "requests_offer_ready", count: 0 },
    { metric: "requests_offer_accepted", count: 0 },
    { metric: "requests_deal_created", count: 0 },
    { metric: "deals_completed", count: 0 },
  ];
  const alerts = evaluateFunnelAlerts(counts({ stages: tiny }), T);
  assert.equal(alerts.filter((a) => a.metric.startsWith("dropoff:")).length, 0);
});

test("a drop-off pair ENDING at a dropoffEligible:false stage is skipped (no cross-table false-page)", () => {
  // Mirrors the real snapshot: deals_completed (in-flight deals) sits at ~0 over
  // a high requests_deal_created denominator. Without the exclusion this would
  // be a severe P1 page on a perfectly healthy pipeline.
  const stages = [
    { metric: "requests_deal_created", count: 100 },
    { metric: "deals_completed", count: 0, dropoffEligible: false },
  ];
  const alerts = evaluateFunnelAlerts(counts({ stages }), T);
  assert.equal(
    alerts.filter((a) => a.metric.startsWith("dropoff:")).length,
    0,
    "the cross-table pair must not raise a drop-off alert",
  );
});

test("a total-collapse stage (downstream 0 at high upstream) escalates to severe", () => {
  const dead = [
    { metric: "requests_submitted", count: 1000 },
    { metric: "requests_active_sourcing", count: 0 }, // hard stop
    { metric: "requests_offer_ready", count: 0 },
    { metric: "requests_offer_accepted", count: 0 },
    { metric: "requests_deal_created", count: 0 },
    { metric: "deals_completed", count: 0 },
  ];
  const alerts = evaluateFunnelAlerts(counts({ stages: dead }), T);
  const first = alerts.find((a) => a.metric === "dropoff:requests_submitted->requests_active_sourcing");
  assert.ok(first);
  assert.equal(first!.severe, true);
  assert.equal(first!.level, "P1");
});
