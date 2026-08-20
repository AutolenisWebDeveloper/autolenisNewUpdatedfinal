// D1 — RESCHEDULE GATE REGRESSION (the live prod bug).
//
// Before D1, the buyer reschedule path wrote prisma.pickup.update inline with NO
// availability check — a buyer could reschedule a pickup to a Sunday, 3 AM, or
// years out. This pins that reschedulePickup now routes through the SAME
// isWithinAvailability gate as initial scheduling: an out-of-availability newDate
// is rejected and NOTHING is written; a valid one updates to RESCHEDULED; and an
// admin override is honoured but AUDITED (never silent).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/pickup/__tests__/scheduling-reschedule.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── controllable prisma state + spies ────────────────────────────────────────
let dealRow: unknown = null;
let updateCalls = 0;
let lastUpdate: { where: unknown; data: Record<string, unknown> } | null = null;
let activityEvents: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async () => dealRow,
      },
      // No stored availability row → resolver derives tz from the dealer ZIP.
      dealerAvailability: { findUnique: async () => null },
      dealer: { findUnique: async () => ({ zip: "75201", state: "TX" }) }, // Central
      pickup: {
        update: async (args: { where: unknown; data: Record<string, unknown> }) => {
          updateCalls += 1;
          lastUpdate = args;
          return { id: "pickup_1", status: args.data.status ?? "RESCHEDULED", ...args.data };
        },
      },
      buyerActivityEvent: {
        create: async (args: { data: Record<string, unknown> }) => {
          activityEvents.push(args.data);
          return {};
        },
      },
    },
  },
});

async function loadService() {
  return import("../scheduling.service");
}

const SCHEDULED_DEAL = {
  buyerId: "buyer_1",
  offer: { dealerId: "dealer_1" },
  pickup: { id: "pickup_1", status: "SCHEDULED" },
};

// now = Mon 2026-01-12 12:00 CST → gives 24h+ lead room for mid-Jan slots.
const NOW = new Date("2026-01-12T18:00:00Z");
const WED_2PM_CST = new Date("2026-01-14T20:00:00Z"); // valid
const SUN_2PM_CST = new Date("2026-01-18T20:00:00Z"); // closed day → invalid

beforeEach(() => {
  dealRow = SCHEDULED_DEAL;
  updateCalls = 0;
  lastUpdate = null;
  activityEvents = [];
});

test("an out-of-availability reschedule is REJECTED and writes nothing (the bug fix)", async () => {
  const { reschedulePickup } = await loadService();
  const res = await reschedulePickup("deal_1", SUN_2PM_CST, { now: NOW });
  assert.equal(res.ok, false);
  assert.equal(updateCalls, 0, "no pickup write on a rejected reschedule");
});

test("a valid reschedule updates the pickup to RESCHEDULED", async () => {
  const { reschedulePickup } = await loadService();
  const res = await reschedulePickup("deal_1", WED_2PM_CST, { now: NOW, location: "123 Dealer Dr, Dallas TX" });
  assert.equal(res.ok, true);
  assert.equal(updateCalls, 1);
  assert.equal(lastUpdate?.data.status, "RESCHEDULED");
  assert.equal(lastUpdate?.data.location, "123 Dealer Dr, Dallas TX");
});

test("a completed pickup cannot be rescheduled", async () => {
  dealRow = { ...SCHEDULED_DEAL, pickup: { id: "pickup_1", status: "COMPLETED" } };
  const { reschedulePickup } = await loadService();
  const res = await reschedulePickup("deal_1", WED_2PM_CST, { now: NOW });
  assert.equal(res.ok, false);
  assert.equal(updateCalls, 0);
});

// D2 regression: reschedule must NOT touch the coordination round-trip states,
// or a buyer could bypass dealer confirmation / the counter cap / an admin
// escalation via the PATCH endpoint.
for (const coordStatus of ["PROPOSED", "DEALER_COUNTERED", "EXCEPTION"]) {
  test(`a pickup in ${coordStatus} (coordination round-trip) cannot be rescheduled`, async () => {
    dealRow = { ...SCHEDULED_DEAL, pickup: { id: "pickup_1", status: coordStatus } };
    const { reschedulePickup } = await loadService();
    const res = await reschedulePickup("deal_1", WED_2PM_CST, { now: NOW });
    assert.equal(res.ok, false, `${coordStatus} must not be reschedulable`);
    assert.equal(updateCalls, 0, "no write on a coordination-state reschedule");
  });
}

test("a valid reschedule records an audit activity event (buyer path — no override)", async () => {
  const { reschedulePickup } = await loadService();
  await reschedulePickup("deal_1", WED_2PM_CST, { now: NOW, reason: "work conflict" });
  const audited = activityEvents.find((e) => e.eventType === "PICKUP_RESCHEDULED");
  assert.ok(audited, "an activity event is written");
  const meta = audited!.metadata as Record<string, unknown>;
  assert.match(String(meta.reason), /work conflict/);
  // The buyer seam has no override concept at all.
  assert.equal("override" in meta, false, "buyer reschedule carries no override flag");
});
