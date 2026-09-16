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
      // P9-00. `financing.updateMany` MUTATES the fixture rather than returning a count, so a
      // test can prove a deal moves from blocked to clear through the writer instead of being
      // handed a fixture that already looks cleared. The distinction is the whole point of
      // P9-00: the pre-existing "all six pass" test below is green only because its fixture
      // hand-sets three columns that no production code could write.
      financing: {
        updateMany: async ({ where, data }: { where: { dealId: string }; data: Record<string, unknown> }) => {
          const fin = (dealRow as { financing?: Record<string, unknown> } | null)?.financing;
          if (!fin || where.dealId !== (dealRow as { id: string }).id) return { count: 0 };
          Object.assign(fin, data);
          return { count: 1 };
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  },
});
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => true } });
mock.module("@/lib/services/financing/financing-checkpoint.service", {
  namedExports: { recordFinancingCheckpoint: async () => ({}) },
});
mock.module("@/lib/services/operations/queue-item.service", { namedExports: { raiseException: async () => ({}) } });
const audits: Array<Record<string, unknown>> = [];
mock.module("@/lib/services/admin/admin-audit.service", {
  namedExports: { writeAdminAuditLog: async (entry: Record<string, unknown>) => { audits.push(entry); } },
});
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// P9-00 — THE WRITER GAP. Phase 8 built the gate; nothing could satisfy it.
//
// `clearFunding` refuses unless every item passes, and three of the facts its items read had
// NO PRODUCTION WRITER: `financing.lenderConditionsClearedAt` (item 2, FINANCE),
// `financing.downPaymentMethod` (item 3, DEALERSHIP) and `financing.dealerFundingConfirmedAt`
// (item 4, DEALERSHIP). Every reference to each was a read. So `deals.funding_cleared_at`
// could never be stamped, and every non-forced completion hit the release gate.
//
// THE TEST ABOVE IS THE EVIDENCE. "clearFunding succeeds only when all six pass" is green,
// and has always been green, because `clearDeal()` hand-sets those three columns. A fixture
// that writes what production cannot is a gate passing because it was never exercised — the
// architecture-scale form of the §8.1h defect class. These tests close that by driving the
// same state through the writer instead of asserting it into the fixture.

/** The realistic starting point: financing complete, but the three facts unrecorded. */
function unrecordedDeal() {
  return clearDeal({
    financing: {
      ...clearDeal().financing,
      lenderConditionsClearedAt: null,
      downPaymentMethod: null,
      dealerFundingConfirmedAt: null,
    },
  });
}

test("P9-00 BASELINE: with the three facts unrecorded, clearance is blocked on exactly items 2-4", async () => {
  dealRow = unrecordedDeal();
  const { evaluateFundingClearance } = await mod();
  const evaluation = await evaluateFundingClearance("d1");

  assert.equal(evaluation.clear, false);
  assert.deepEqual(
    evaluation.outstanding.map((i) => i.key).sort(),
    ["dealer_funding", "down_payment", "lender_conditions"],
    "the ONLY things blocking a fully-financed deal are the three facts nothing could write",
  );
});

test("P9-00: the writer records all three facts and the deal becomes clearable", async () => {
  dealRow = unrecordedDeal();
  const { recordClearanceFacts, clearFunding } = await mod();

  await recordClearanceFacts({
    dealId: "d1",
    actorId: "admin_1",
    actorEmail: "finance@autolenis.com",
    reason: "Lender stips cleared, cashier's cheque seen, dealership confirmed funding",
    facts: {
      lenderConditionsCleared: true,
      downPaymentMethod: "cashier's cheque",
      dealerFundingConfirmed: true,
    },
  });

  // THE PROOF: the same deal, driven through the writer, now clears. Nothing was asserted
  // into the fixture between these two lines.
  const result = await clearFunding({ dealId: "d1", actorId: "admin_1", reason: "All six confirmed against evidence" });
  assert.equal(result.cleared, true, "the gate must be satisfiable through the writer, not only through a fixture");
  assert.deepEqual(result.outstanding, []);
});

test("P9-00: a partial recording moves only the items it names", async () => {
  dealRow = unrecordedDeal();
  const { recordClearanceFacts, evaluateFundingClearance } = await mod();

  await recordClearanceFacts({
    dealId: "d1",
    actorId: "admin_1",
    reason: "Only the lender stipulations are cleared so far",
    facts: { lenderConditionsCleared: true },
  });

  const evaluation = await evaluateFundingClearance("d1");
  assert.deepEqual(
    evaluation.outstanding.map((i) => i.key).sort(),
    ["dealer_funding", "down_payment"],
    "recording one fact must not imply the other two",
  );
});

test("P9-00: a fact recorded in error can be withdrawn", async () => {
  // Reversibility is deliberate. The alternative to withdrawing a mis-recorded fact is a
  // hand-written database update, which is exactly what the per-run protocol forbids — and a
  // wrongly-recorded fact otherwise unblocks a vehicle release permanently.
  dealRow = unrecordedDeal();
  const { recordClearanceFacts, evaluateFundingClearance } = await mod();

  await recordClearanceFacts({
    dealId: "d1", actorId: "admin_1", reason: "Dealership confirmed funding by telephone",
    facts: { dealerFundingConfirmed: true },
  });
  await recordClearanceFacts({
    dealId: "d1", actorId: "admin_1", reason: "Withdrawn — the confirmation was for a different deal",
    facts: { dealerFundingConfirmed: false },
  });

  const evaluation = await evaluateFundingClearance("d1");
  assert.equal(item(evaluation, "dealer_funding").satisfied, false, "a withdrawn fact must stop satisfying its item");
});

test("P9-00: the writer REFUSES once funding has already cleared", async () => {
  // After the stamp the facts are history. Editing them afterwards makes the record disagree
  // with the release that was already granted on the strength of it.
  dealRow = clearDeal({ fundingClearedAt: new Date() });
  const { recordClearanceFacts, FundingClearanceError } = await mod();

  await assert.rejects(
    () => recordClearanceFacts({
      dealId: "d1", actorId: "admin_1", reason: "Trying to amend a cleared deal",
      facts: { dealerFundingConfirmed: false },
    }),
    (err: unknown) => err instanceof FundingClearanceError,
  );
});

test("P9-00: the writer REFUSES when the deal has no financing record", async () => {
  dealRow = clearDeal({ financing: null });
  const { recordClearanceFacts, FundingClearanceError } = await mod();

  await assert.rejects(
    () => recordClearanceFacts({
      dealId: "d1", actorId: "admin_1", reason: "No financing row exists for this deal",
      facts: { lenderConditionsCleared: true },
    }),
    (err: unknown) => err instanceof FundingClearanceError,
    "fail closed rather than creating a financing record as a side effect of recording a fact",
  );
});

test("P9-00: recording nothing is refused rather than treated as a no-op success", async () => {
  // A call that names no fact and returns success is a screen that shows a green tick for a
  // recording that never happened — §8.1h's defect class, in the smallest possible form.
  dealRow = unrecordedDeal();
  const { recordClearanceFacts, FundingClearanceError } = await mod();

  await assert.rejects(
    () => recordClearanceFacts({ dealId: "d1", actorId: "admin_1", reason: "Recording nothing at all", facts: {} }),
    (err: unknown) => err instanceof FundingClearanceError,
  );
});

test("P9-00: every recording is audited with its actor and reason", async () => {
  dealRow = unrecordedDeal();
  audits.length = 0;
  const { recordClearanceFacts } = await mod();

  await recordClearanceFacts({
    dealId: "d1", actorId: "admin_7", actorEmail: "finance@autolenis.com",
    reason: "Dealership confirmed funding authorization in writing",
    facts: { dealerFundingConfirmed: true },
  });

  assert.equal(audits.length, 1, "a MONEY-tier recording that is not audited did not happen");
  assert.equal(audits[0]!.adminId, "admin_7");
  assert.match(String(audits[0]!.reason), /Dealership confirmed funding/);
});
