// §26 / §23.4 — "The $99 is charged back after a Premium upgrade".
//
// The $99 is the CREDIT BASIS for the Premium upgrade: it counts toward the $499, so the
// buyer paid $400 to upgrade. A chargeback reverses part of what was paid for an entitlement
// the platform has already granted and staffed with a named concierge, and §23.4's rule is
// that the entitlement is REVIEWED, never silently withdrawn. Before Phase 10 the register row
// had no raise site, so a buyer could be demoted — or not — with nobody deciding either way.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/payment/__tests__/chargeback-after-upgrade.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let raised: Rec[];
let entitledPlan: { plan: string; reason: string };
let buyerPlan: string;
let entitledCalls: string[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: { updateMany: async () => ({ count: 1 }) },
      buyer: { findUnique: async () => ({ plan: buyerPlan, planUpgradedAt: new Date("2026-09-01T00:00:00Z") }) },
      queueItem: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Rec) => { raised.push(input); return { created: true }; },
    resolveQueueItem: async () => ({}),
    OPEN_QUEUE_STATUSES: ["OPEN", "ASSIGNED", "ESCALATED"],
  },
});

mock.module("@/lib/services/buyer/plan-snapshot.service", {
  namedExports: {
    entitledPlanForRequest: async (id: string) => { entitledCalls.push(id); return entitledPlan; },
  },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: { cancelDepositReminderTouches: async () => ({ canceled: 0 }) },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: { cancelByKey: async () => ({ cancelled: 0 }) },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  raised = [];
  entitledCalls = [];
  entitledPlan = { plan: "PREMIUM", reason: "the Premium balance has settled" };
  buyerPlan = "PREMIUM";
});

async function svc() {
  return import("../fulfillment-hold.service");
}

const dispute = {
  depositId: "dep_1",
  buyerId: "b1",
  vehicleRequestId: "vr_1",
  trigger: "dispute" as const,
  providerRef: "dp_123",
  reason: "fraudulent",
};

function codes(): string[] {
  return raised.map((r) => r.code as string);
}

test("a chargeback on the $99 of a PREMIUM buyer opens the entitlement review", async () => {
  const { applyFulfillmentHold } = await svc();
  await applyFulfillmentHold(dispute);

  assert.ok(codes().includes("PAYMENT_DISPUTED_OR_REFUNDED"), "the transaction hold still opens");
  assert.ok(codes().includes("DEPOSIT_CHARGEBACK_AFTER_UPGRADE"), "and so does the entitlement review");

  const review = raised.find((r) => r.code === "DEPOSIT_CHARGEBACK_AFTER_UPGRADE")!;
  assert.equal(review.buyerId, "b1");
  assert.equal(review.depositId, "dep_1");
  assert.equal(
    review.idempotencyKey,
    "DEPOSIT_CHARGEBACK_AFTER_UPGRADE:dp_123",
    "keyed on the dispute, so a Stripe redelivery does not open a second Finance review of the same money",
  );
});

test("the two rows are SEPARATE — they resolve independently and sit on different desks", async () => {
  const { applyFulfillmentHold } = await svc();
  await applyFulfillmentHold(dispute);
  assert.equal(
    new Set(codes()).size,
    2,
    "one is FINANCE deciding about the transaction, the other FINANCE deciding about an entitlement; " +
      "Stripe can rule the dispute won and never raise the entitlement question at all",
  );
});

test("a STANDARD buyer gets no entitlement review — there is no entitlement in question", async () => {
  entitledPlan = { plan: "STANDARD", reason: "Standard, elected and paid in full" };
  const { applyFulfillmentHold } = await svc();
  await applyFulfillmentHold(dispute);

  assert.ok(codes().includes("PAYMENT_DISPUTED_OR_REFUNDED"));
  assert.ok(!codes().includes("DEPOSIT_CHARGEBACK_AFTER_UPGRADE"));
});

test("an ELECTED but unsettled Premium is Standard — §23.1, and no review opens", async () => {
  entitledPlan = {
    plan: "STANDARD",
    reason: "Premium was elected but the balance has not settled — Standard until it does (§23.1, PAY-57)",
  };
  const { applyFulfillmentHold } = await svc();
  await applyFulfillmentHold(dispute);
  assert.ok(!codes().includes("DEPOSIT_CHARGEBACK_AFTER_UPGRADE"));
});

test("an ADMIN REFUND is not a chargeback — §23.4 names the bank reversal, not a deliberate act", async () => {
  const { applyFulfillmentHold } = await svc();
  await applyFulfillmentHold({ ...dispute, trigger: "refund", initiatedBy: "admin" });

  assert.ok(codes().includes("PAYMENT_DISPUTED_OR_REFUNDED"));
  assert.ok(
    !codes().includes("DEPOSIT_CHARGEBACK_AFTER_UPGRADE"),
    "an administrator issuing a refund can see the plan; a bank reversing a charge has nobody here in the loop",
  );
  assert.deepEqual(entitledCalls, [], "and the entitlement is not even read");
});

test("with no vehicle request the buyer's plan column answers, and says so", async () => {
  const { applyFulfillmentHold } = await svc();
  await applyFulfillmentHold({ ...dispute, vehicleRequestId: null });

  const review = raised.find((r) => r.code === "DEPOSIT_CHARGEBACK_AFTER_UPGRADE");
  assert.ok(review, "a deposit with no request still has a buyer with a plan");
  assert.deepEqual(entitledCalls, [], "the request-level derivation has nothing to read");
  assert.match(
    review!.detail as string,
    /buyers\.plan = PREMIUM/,
    "the detail names WHICH source answered — the column is the coarser backstop, not the source of truth",
  );
});

test("the entitlement check never costs the hold — a throw there leaves the hold recorded", async () => {
  const snapshot = await import("@/lib/services/buyer/plan-snapshot.service");
  void snapshot;
  entitledPlan = null as unknown as { plan: string; reason: string };
  const { applyFulfillmentHold } = await svc();
  const result = await applyFulfillmentHold(dispute);

  assert.equal(result.disputed, true, "the deposit still moved to DISPUTED");
  assert.ok(codes().includes("PAYMENT_DISPUTED_OR_REFUNDED"), "and the §26 row still opened");
});
