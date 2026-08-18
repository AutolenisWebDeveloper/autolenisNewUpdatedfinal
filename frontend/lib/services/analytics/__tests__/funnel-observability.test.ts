// S5 — funnel snapshot derivation + orchestrator wiring.
//   • computeFunnelSnapshot: each stage COUNTs the right authoritative table/
//     status; the two failure counters are windowed and the auction counter
//     requires zero offers.
//   • snapshotAndAlertFunnel: persists one row per named counter, raises + routes
//     alerts, and dedupes against an already-open PlatformAlert.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/analytics/__tests__/funnel-observability.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let createManyArgs: { data: Array<Record<string, unknown>> } | null = null;
// Which alert level currently has an OPEN (unresolved) PlatformAlert. findFirst
// is level-aware, so we can prove dedup suppresses a same-level repeat but NOT a
// severity escalation.
let openAlertLevel: string | null = null;
let createAlertCalls: Array<{ level: string; title: string; body: string; source: string }> = [];
let notifyCalls: Array<{ msg: string; ctx: unknown }> = [];
let pageCalls: Array<{ msg: string; ctx: unknown }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      funnelStageSnapshot: {
        createMany: async (a: { data: Array<Record<string, unknown>> }) => {
          createManyArgs = a;
          return { count: a.data.length };
        },
      },
      platformAlert: {
        findFirst: async (args?: { where?: { level?: string } }) =>
          args?.where?.level && args.where.level === openAlertLevel ? { id: "existing" } : null,
      },
      // default-client stubs (unused — compute is injected in these tests)
      vehicleRequest: { count: async () => 0 },
      deal: { count: async () => 0 },
      auction: { count: async () => 0 },
    },
  },
});

mock.module("@/lib/services/monitoring/health-alert.service", {
  namedExports: {
    createAlert: async (level: string, title: string, body: string, source: string) => {
      createAlertCalls.push({ level, title, body, source });
      return { id: "al_1" };
    },
  },
});

mock.module("@/lib/observability/alert", {
  namedExports: {
    notifyOncall: (msg: string, ctx: unknown) => notifyCalls.push({ msg, ctx }),
    pageOnCall: (msg: string, ctx: unknown) => pageCalls.push({ msg, ctx }),
  },
});

async function load() {
  return import("@/lib/services/analytics/funnel-observability.service");
}

const HEALTHY_STAGES = [
  { metric: "requests_submitted", count: 1000 },
  { metric: "requests_active_sourcing", count: 800 },
  { metric: "requests_offer_ready", count: 600 },
  { metric: "requests_offer_accepted", count: 400 },
  { metric: "requests_deal_created", count: 300 },
  { metric: "deals_completed", count: 250 },
];
const CANNED = { stages: HEALTHY_STAGES, requestsClosedNoMatch: 0, auctionsClosedZeroOffers: 0 };

beforeEach(() => {
  createManyArgs = null;
  openAlertLevel = null;
  createAlertCalls = [];
  notifyCalls = [];
  pageCalls = [];
});

// ── computeFunnelSnapshot ────────────────────────────────────────────────────
test("computeFunnelSnapshot maps each stage to its authoritative table/status (exact enum sets)", async () => {
  const svc = await load();
  // Record every VehicleRequest where-clause in Promise.all (array) order so we
  // can assert the EXACT status sets, not merely their cardinality — a swap to a
  // same-length wrong enum must be caught.
  const vrWheres: Array<Record<string, unknown> | undefined> = [];
  let auctionWhere: Record<string, unknown> | null = null;

  const fake = {
    vehicleRequest: {
      count: async (args?: { where?: Record<string, unknown> }) => {
        vrWheres.push(args?.where);
        const w = args?.where as
          | { status?: { in?: string[] } | string; updatedAt?: { gte?: Date } }
          | undefined;
        if (!w) return 1000;
        if (Array.isArray((w.status as { in?: string[] })?.in)) {
          const n = (w.status as { in: string[] }).in.length;
          return n === 5 ? 800 : n === 4 ? 600 : 400;
        }
        if (w.status === "DEAL_CREATED") return 300;
        if (w.status === "CLOSED_NO_MATCH") return 7;
        return -1;
      },
    },
    deal: {
      count: async (args?: { where?: { status?: string } }) => {
        assert.equal(args?.where?.status, "COMPLETED");
        return 250;
      },
    },
    auction: {
      count: async (args?: { where?: Record<string, unknown> }) => {
        auctionWhere = args?.where ?? null;
        return 4;
      },
    },
  };

  const counts = await svc.computeFunnelSnapshot(fake as never, 24);

  assert.deepEqual(
    counts.stages.map((s) => [s.metric, s.count]),
    [
      ["requests_submitted", 1000],
      ["requests_active_sourcing", 800],
      ["requests_offer_ready", 600],
      ["requests_offer_accepted", 400],
      ["requests_deal_created", 300],
      ["deals_completed", 250],
    ],
  );
  // deals_completed crosses VehicleRequest→Deal → excluded from drop-off.
  const completed = counts.stages.find((s) => s.metric === "deals_completed")!;
  assert.equal(completed.dropoffEligible, false);
  assert.notEqual(
    counts.stages.find((s) => s.metric === "requests_deal_created")!.dropoffEligible,
    false,
    "VR-lifecycle stages remain drop-off eligible",
  );
  assert.equal(counts.requestsClosedNoMatch, 7);
  assert.equal(counts.auctionsClosedZeroOffers, 4);

  // Exact status sets (order-independent) per stage.
  const asSet = (i: number) =>
    [...((vrWheres[i]!.status as { in: string[] }).in)].sort();
  assert.deepEqual(vrWheres[0], undefined, "requests_submitted counts all requests");
  assert.deepEqual(asSet(1), ["ACTIVE_SOURCING", "DEAL_CREATED", "OFFER_ACCEPTED", "OFFER_READY", "OFFER_SENT"]);
  assert.deepEqual(asSet(2), ["DEAL_CREATED", "OFFER_ACCEPTED", "OFFER_READY", "OFFER_SENT"]);
  assert.deepEqual(asSet(3), ["DEAL_CREATED", "OFFER_ACCEPTED"]);
  assert.equal((vrWheres[4]!.status as string), "DEAL_CREATED");
  assert.equal((vrWheres[5]!.status as string), "CLOSED_NO_MATCH");
  assert.ok((vrWheres[5]!.updatedAt as { gte?: Date })?.gte instanceof Date, "closed_no_match windowed");

  const aw = auctionWhere as unknown as {
    status: { in: string[] };
    updatedAt?: { gte?: Date };
    offers?: unknown;
  };
  assert.deepEqual([...aw.status.in].sort(), ["CLOSED", "EXPIRED"]);
  assert.ok(aw.updatedAt?.gte instanceof Date, "zero-offers counter must be windowed");
  assert.deepEqual(aw.offers, { none: {} }, "zero-offers means no offer rows");
});

// ── snapshotAndAlertFunnel ───────────────────────────────────────────────────
test("persists one snapshot row per stage + both failure counters", async () => {
  const svc = await load();
  const res = await svc.snapshotAndAlertFunnel({ compute: async () => CANNED });

  const data = createManyArgs!.data;
  assert.equal(data.length, 8, "6 funnel stages + 2 failure counters");
  const metrics = data.map((d) => d.metric);
  assert.ok(metrics.includes("requests_closed_no_match"));
  assert.ok(metrics.includes("auctions_closed_zero_offers"));
  // windowed counters carry the window; cumulative stages do not
  assert.equal(data.find((d) => d.metric === "requests_closed_no_match")!.windowHours, 24);
  assert.equal(data.find((d) => d.metric === "auctions_closed_zero_offers")!.windowHours, 24);
  assert.equal(data.find((d) => d.metric === "requests_submitted")!.windowHours, null);

  assert.equal(res.snapshotted, 8);
  assert.equal(res.alerts, 0);
  assert.equal(createAlertCalls.length, 0, "healthy funnel raises nothing");
});

test("a breached counter creates ONE PlatformAlert (source funnel-observability) + notifies", async () => {
  const svc = await load();
  const counts = { ...CANNED, requestsClosedNoMatch: 5 }; // == default threshold
  const res = await svc.snapshotAndAlertFunnel({ compute: async () => counts });

  assert.equal(createAlertCalls.length, 1);
  assert.equal(createAlertCalls[0]!.source, "funnel-observability");
  assert.equal(createAlertCalls[0]!.level, "P2");
  assert.equal(notifyCalls.length, 1);
  assert.equal(pageCalls.length, 0);
  assert.equal(res.alerts, 1);
});

test("a severe (>=3x) breach pages instead of notifying", async () => {
  const svc = await load();
  const counts = { ...CANNED, requestsClosedNoMatch: 15 };
  await svc.snapshotAndAlertFunnel({ compute: async () => counts });

  assert.equal(createAlertCalls[0]!.level, "P1");
  assert.equal(pageCalls.length, 1);
  assert.equal(notifyCalls.length, 0);
});

test("an already-open alert of the same title AND level is not duplicated or re-routed", async () => {
  openAlertLevel = "P2"; // a P2 for this condition is already open
  const svc = await load();
  const counts = { ...CANNED, requestsClosedNoMatch: 5 }; // == threshold → P2
  const res = await svc.snapshotAndAlertFunnel({ compute: async () => counts });

  assert.equal(createAlertCalls.length, 0, "no duplicate PlatformAlert row");
  assert.equal(notifyCalls.length, 0, "no re-notify while unresolved");
  assert.equal(res.alerts, 0);
  // the snapshot is still persisted every run regardless of alert dedupe
  assert.equal(createManyArgs!.data.length, 8);
});

test("a severity ESCALATION (P2 open → P1) is NOT swallowed — it creates a P1 and pages", async () => {
  openAlertLevel = "P2"; // only a P2 is open…
  const svc = await load();
  const counts = { ...CANNED, requestsClosedNoMatch: 15 }; // 3x threshold → P1
  const res = await svc.snapshotAndAlertFunnel({ compute: async () => counts });

  assert.equal(createAlertCalls.length, 1, "the P1 escalation is still created");
  assert.equal(createAlertCalls[0]!.level, "P1");
  assert.equal(pageCalls.length, 1, "the escalation pages on-call");
  assert.equal(notifyCalls.length, 0);
  assert.equal(res.alerts, 1);
});

test("both failure counters breaching create TWO separate alerts", async () => {
  const svc = await load();
  const counts = { ...CANNED, requestsClosedNoMatch: 5, auctionsClosedZeroOffers: 3 };
  const res = await svc.snapshotAndAlertFunnel({ compute: async () => counts });

  assert.equal(createAlertCalls.length, 2);
  const titles = createAlertCalls.map((c) => c.title).sort();
  assert.deepEqual(titles, [
    "Funnel: auctions closing with zero offers",
    "Funnel: buyer requests closing with no match",
  ]);
  assert.equal(res.alerts, 2);
});
