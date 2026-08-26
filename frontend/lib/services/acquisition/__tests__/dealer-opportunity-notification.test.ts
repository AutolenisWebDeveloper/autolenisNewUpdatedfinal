// Unit tests for notifyActiveDealersOfOpportunity — the $99-gated ACTIVE-dealer
// "new buyer opportunity" fan-out extracted from the public request-vehicle route.
//
// Pins: dealer-facing notification is held behind the $99 pre-activation gate —
//   • unpaid buyer (isFulfillmentUnlocked=false) -> gated, ZERO emails;
//   • null buyerId -> gated, ZERO emails;
//   • PAID buyer -> notifies each ACTIVE dealer that has an email (skips those without);
//   • a dealer-lookup failure degrades to zero, never throws.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/acquisition/__tests__/dealer-opportunity-notification.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  unlocked: boolean;
  dealers: Array<{ dealershipName: string; user: { email: string } | null }>;
  findThrows: boolean;
  sent: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/services/payment/fulfillment-gate", {
  namedExports: { isFulfillmentUnlocked: async () => ctrl.unlocked },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealer: {
        findMany: async () => {
          if (ctrl.findThrows) throw new Error("db down");
          return ctrl.dealers;
        },
      },
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerNewBuyerOpportunityEmail: async (p: Record<string, unknown>) => { ctrl.sent.push(p); },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() {
  return import("@/lib/services/acquisition/dealer-opportunity-notification.service");
}

beforeEach(() => {
  ctrl = { unlocked: false, dealers: [], findThrows: false, sent: [] };
});

const base = { opportunityId: "opp_1", vehicleInterest: "Toyota Camry", buyerCity: "Dallas", buyerState: "TX" };

test("unpaid buyer -> gated, no dealer emails (pre-payment boundary held)", async () => {
  ctrl.unlocked = false;
  ctrl.dealers = [{ dealershipName: "D1", user: { email: "d1@x.com" } }];
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: "b1", ...base });
  assert.equal(r.gated, true);
  assert.equal(r.notified, 0);
  assert.equal(ctrl.sent.length, 0);
});

test("null buyerId -> gated (anonymous lead can't have paid)", async () => {
  ctrl.unlocked = false; // isFulfillmentUnlocked(null) is false
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: null, ...base });
  assert.equal(r.gated, true);
  assert.equal(ctrl.sent.length, 0);
});

test("PAID buyer -> notifies each ACTIVE dealer with an email; skips those without", async () => {
  ctrl.unlocked = true;
  ctrl.dealers = [
    { dealershipName: "D1", user: { email: "d1@x.com" } },
    { dealershipName: "D2", user: null },
    { dealershipName: "D3", user: { email: "d3@x.com" } },
  ];
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: "b1", ...base });
  assert.equal(r.gated, false);
  assert.equal(r.notified, 2);
  assert.equal(ctrl.sent.length, 2);
  assert.equal(ctrl.sent[0].to, "d1@x.com");
  assert.equal(ctrl.sent[0].opportunityId, "opp_1");
  assert.equal(ctrl.sent[0].vehicleInterest, "Toyota Camry");
});

test("dealer lookup failure degrades to zero (never throws)", async () => {
  ctrl.unlocked = true;
  ctrl.findThrows = true;
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: "b1", ...base });
  assert.equal(r.gated, false);
  assert.equal(r.notified, 0);
  assert.equal(ctrl.sent.length, 0);
});
