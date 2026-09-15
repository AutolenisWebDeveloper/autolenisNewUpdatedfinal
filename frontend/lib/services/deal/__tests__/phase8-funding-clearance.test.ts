// §Stage 14 — the six-item funding-clearance list, each item exercised OUTSTANDING on its own.
//
// WHY EACH ITEM GETS ITS OWN CASE. Stage 14 lists six conditions and the phase brief is
// explicit that a summary will not do. A test that only checked "all six satisfied clears"
// and "nothing satisfied blocks" would pass with an item that never evaluates anything —
// which is exactly how four Contract Shield rule types sat in an enum for months being
// listed and never run.
//
// THE RULE UNDER TEST: "A vehicle is never released on the expectation that financing will
// complete later ... enforced STRUCTURALLY: release requires funding cleared, and funding
// clearance requires completed financing."
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/deal/__tests__/phase8-funding-clearance.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

let dealRow: Record<string, unknown> | null = null;
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => dealRow, updateMany: async () => ({ count: 1 }) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  },
});
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => true } });
mock.module("@/lib/services/financing/financing-checkpoint.service", {
  namedExports: { recordFinancingCheckpoint: async () => ({}) },
});
mock.module("@/lib/services/operations/queue-item.service", { namedExports: { raiseException: async () => ({}) } });
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: { enqueueTransactional: async () => ({}) },
});

const mod = () => import("../funding-clearance.service");

const FUTURE = new Date(Date.now() + 30 * 24 * 3600_000);
const PAST = new Date(Date.now() - 24 * 3600_000);

/** A deal where all six items are satisfied and no trade lien exists. */
function clearDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    financingPath: "EXTERNAL",
    downPaymentCents: 300_000,
    feePaidAt: new Date(),
    feeRefundedAt: null,
    financing: {
      status: "COMPLETED",
      expiresAt: FUTURE,
      downPaymentCents: 300_000,
      verifiedAt: new Date(),
      lenderConditionsClearedAt: new Date(),
      downPaymentMethod: "cashier's cheque",
      dealerFundingConfirmedAt: new Date(),
    },
    deposit: { status: "PAID" },
    dealRecaps: [{ payoffGoodThroughDate: FUTURE }],
    tradeInSubmissions: [],
    ...overrides,
  };
}

const item = (e: { items: { key: string; satisfied: boolean; owner: string; detail: string; notApplicable?: boolean }[] }, key: string) =>
  e.items.find((i) => i.key === key)!;

test("all six items satisfied — the evaluation is clear", async () => {
  dealRow = clearDeal();
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(evaluation.items.length, 6, "Stage 14 lists SIX conditions — all six must be evaluated");
  assert.equal(evaluation.clear, true);
  assert.deepEqual(evaluation.outstanding, []);
});

test("ITEM 1 — financing that is not COMPLETED blocks clearance", async () => {
  const { evaluateFundingClearance } = await mod();
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "TERMS_LOCKED", "FAILED", "EXPIRED"]) {
    dealRow = clearDeal({ financing: { ...clearDeal().financing, status } });
    const evaluation = await evaluateFundingClearance("d1");
    assert.equal(item(evaluation, "financing_current").satisfied, false, `${status} must not satisfy item 1`);
    assert.equal(evaluation.clear, false);
  }
});

test("ITEM 1 — an EXPIRED approval blocks even when the status says COMPLETED", async () => {
  // "Financing approval is CURRENT and unexpired" — two conditions, not one.
  dealRow = clearDeal({ financing: { ...clearDeal().financing, expiresAt: PAST } });
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "financing_current").satisfied, false);
  assert.match(item(evaluation, "financing_current").detail, /expired/i);
});

test("ITEM 2 — unsatisfied lender stipulations block, and are the DEALERSHIP's or FINANCE's", async () => {
  dealRow = clearDeal({ financing: { ...clearDeal().financing, lenderConditionsClearedAt: null } });
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "lender_conditions").satisfied, false);
  assert.equal(item(evaluation, "lender_conditions").owner, "FINANCE");
});

test("ITEM 2 — a CASH purchase has no lender, so it is notApplicable rather than satisfied", async () => {
  // The distinction is the point: the list must stay honest about what was actually checked.
  dealRow = clearDeal({
    financing: { ...clearDeal().financing, status: "NOT_REQUIRED_CASH", lenderConditionsClearedAt: null },
  });
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "lender_conditions").satisfied, true);
  assert.equal(item(evaluation, "lender_conditions").notApplicable, true);
  assert.equal(evaluation.clear, true, "a cash deal must still be able to clear");
});

test("ITEM 3 — an amount with NO METHOD is not a recorded arrangement", async () => {
  // Stage 14 asks for the arrangement to be complete "AND ITS METHOD RECORDED BY THE
  // DEALERSHIP". An amount alone is a number nobody can reconcile against anything.
  dealRow = clearDeal({ financing: { ...clearDeal().financing, downPaymentMethod: null } });
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "down_payment").satisfied, false);
  assert.equal(item(evaluation, "down_payment").owner, "DEALERSHIP");
  assert.match(item(evaluation, "down_payment").detail, /how it was collected/i);
});

test("ITEM 4 — no dealership funding confirmation blocks", async () => {
  dealRow = clearDeal({ financing: { ...clearDeal().financing, dealerFundingConfirmedAt: null } });
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "dealer_funding").satisfied, false);
  assert.equal(item(evaluation, "dealer_funding").owner, "DEALERSHIP");
});

test("ITEM 5 — a stale payoff quote blocks ONLY when a trade carries a lien", async () => {
  const { evaluateFundingClearance } = await mod();

  // No trade at all — notApplicable, and the deal still clears.
  dealRow = clearDeal({ dealRecaps: [{ payoffGoodThroughDate: null }] });
  let evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "trade_payoff").notApplicable, true);
  assert.equal(evaluation.clear, true);

  // A trade WITH a lien and an expired quote — blocked.
  dealRow = clearDeal({
    tradeInSubmissions: [{ verifiedPayoffCents: 1_200_000, loanBalanceCents: 1_200_000 }],
    dealRecaps: [{ payoffGoodThroughDate: PAST }],
  });
  evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "trade_payoff").satisfied, false);
  assert.match(item(evaluation, "trade_payoff").detail, /expired/i);

  // A trade owned OUTRIGHT — no lien, so no payoff and nothing to go stale.
  dealRow = clearDeal({
    tradeInSubmissions: [{ verifiedPayoffCents: 0, loanBalanceCents: 0 }],
    dealRecaps: [{ payoffGoodThroughDate: null }],
  });
  evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "trade_payoff").notApplicable, true);
});

test("ITEM 6 — a disputed $99 or a reversed Premium fee blocks release", async () => {
  const { evaluateFundingClearance } = await mod();
  for (const status of ["DISPUTED", "REFUNDED", "CHARGEBACK", "HELD", "FAILED"]) {
    dealRow = clearDeal({ deposit: { status } });
    const evaluation = await evaluateFundingClearance("d1");
    assert.equal(item(evaluation, "no_payment_hold").satisfied, false, `a ${status} deposit must block`);
    assert.equal(item(evaluation, "no_payment_hold").owner, "FINANCE");
  }
  dealRow = clearDeal({ feeRefundedAt: new Date() });
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "no_payment_hold").satisfied, false, "a reversed concierge fee must block");
});

test("FAIL CLOSED: an unreadable deal is never clear", async () => {
  dealRow = null;
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(evaluation.clear, false);
  assert.equal(evaluation.outstanding.length, 1);
});

test("clearFunding REFUSES while any item is outstanding — there is no override", async () => {
  // An override would be conditional delivery with a different name. This is the structural
  // half of the no-spot-delivery rule and it has no escape hatch by design.
  dealRow = clearDeal({ financing: { ...clearDeal().financing, status: "TERMS_LOCKED" } });
  const { clearFunding } = await mod();
  const result = await clearFunding({ dealId: "d1", actorId: "admin_1", reason: "Attempting clearance" });
  assert.equal(result.cleared, false);
  assert.ok(result.outstanding.some((i) => i.key === "financing_current"));
});

test("clearFunding succeeds only when all six pass", async () => {
  dealRow = clearDeal();
  const { clearFunding } = await mod();
  const result = await clearFunding({ dealId: "d1", actorId: "admin_1", reason: "All six confirmed against evidence" });
  assert.equal(result.cleared, true);
  assert.deepEqual(result.outstanding, []);
});

test("every item names an OWNER — Stage 14's buyer copy needs one", async () => {
  dealRow = clearDeal();
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");
  for (const i of evaluation.items) {
    assert.ok(["FINANCE", "DEALERSHIP", "BUYER", "OPERATIONS"].includes(i.owner), `${i.key} must name an owner`);
    assert.ok(i.detail.length > 0, `${i.key} must say WHY, not just whether`);
  }
});
