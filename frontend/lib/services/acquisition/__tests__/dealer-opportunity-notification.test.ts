// notifyActiveDealersOfOpportunity — RETIRED by §13-D44 (owner ruling, 2026-09-11).
//
// WHAT THESE TESTS USED TO PIN, AND WHY THEY CHANGED RATHER THAN BEING DELETED. They pinned
// the $99-gated fan-out: unpaid buyer → gated with zero emails, PAID buyer → one email per
// ACTIVE dealer with an address. The $99 gate was correct and it worked; what the owner retired
// is the fan-out itself, because it emailed the first 20 ACTIVE dealers with no `orderBy`, no
// radius, no invitation record and no place in the eight-invitation budget §33 step 29 says one
// deposit buys.
//
// So the assertions now pin the RETIREMENT, which is a stronger statement than the ones they
// replace: it does not matter whether the buyer has paid, whether dealers exist, or whether
// they have addresses — NOTHING is ever sent. A test that merely stopped asserting the old
// behaviour would leave the retirement unprotected, and the next person to "restore" the
// broadcast would find no test in their way.
//
// The transport mock is kept deliberately. Its whole job now is to prove it is never called.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/acquisition/__tests__/dealer-opportunity-notification.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  unlocked: boolean;
  dealers: Array<{ dealershipName: string; user: { email: string } | null }>;
  findManyCalls: number;
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
          ctrl.findManyCalls += 1;
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
  ctrl = { unlocked: false, dealers: [], findManyCalls: 0, sent: [] };
});

const base = { opportunityId: "opp_1", vehicleInterest: "Toyota Camry", buyerCity: "Dallas", buyerState: "TX" };

test("§13-D44: a PAID buyer with ACTIVE dealers sends NOTHING — the broadcast is retired", async () => {
  // The case that used to send. An unpaid buyer being gated proves little about a retirement;
  // a PAID buyer with two reachable dealers is the case where the old code DID fan out, so it
  // is the one that proves the retirement holds.
  ctrl.unlocked = true;
  ctrl.dealers = [
    { dealershipName: "D1", user: { email: "d1@x.com" } },
    { dealershipName: "D3", user: { email: "d3@x.com" } },
  ];
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: "b1", ...base });
  assert.equal(r.retired, true);
  assert.equal(r.notified, 0);
  assert.equal(ctrl.sent.length, 0, "no dealer may be emailed by the retired broadcast");
});

test("§13-D44: it does not even query for dealers — no untargeted pool is assembled", async () => {
  // Stronger than "sends nothing": the retired path must not read the dealer table either.
  // A version that still selected twenty dealers and then declined to mail them would be one
  // edit away from mailing them again.
  ctrl.unlocked = true;
  ctrl.dealers = [{ dealershipName: "D1", user: { email: "d1@x.com" } }];
  const { notifyActiveDealersOfOpportunity } = await load();
  await notifyActiveDealersOfOpportunity({ buyerId: "b1", ...base });
  assert.equal(ctrl.findManyCalls, 0, "the retired broadcast must not assemble a dealer pool");
});

test("§13-D44: an unpaid buyer also sends nothing, and reports retired rather than gated", async () => {
  // The pre-payment case. `gated` is false now — not because the boundary moved, but because
  // there is no send for a gate to hold. The $99 boundary itself is pinned by
  // `fulfillment-gate`'s own tests and by every dealer-facing path that still uses it.
  ctrl.unlocked = false;
  ctrl.dealers = [{ dealershipName: "D1", user: { email: "d1@x.com" } }];
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: "b1", ...base });
  assert.equal(r.retired, true);
  assert.equal(r.notified, 0);
  assert.equal(ctrl.sent.length, 0);
});

test("§13-D44: a null buyerId is handled without throwing", async () => {
  // The anonymous-lead case the public route can still produce. It must not throw, because the
  // caller is on the public request-submission path and a throw there would fail a buyer's
  // submission over a notification that no longer exists.
  const { notifyActiveDealersOfOpportunity } = await load();
  const r = await notifyActiveDealersOfOpportunity({ buyerId: null, ...base });
  assert.equal(r.retired, true);
  assert.equal(r.notified, 0);
  assert.equal(ctrl.sent.length, 0);
});
