// §23.2 — the upgrade window, and what Premium costs.
//
// TWO RULES, and both were money defects rather than gaps:
//
//   THE WINDOW. "Opens the moment the $99 settles." The upgrade route had no deposit
//   check at all and the card rendered before any payment, so a buyer could hold Premium
//   before paying the $99 the plan is built on.
//
//   THE PRICE. "Always the $400 balance, shown as $499 total less the $99 already paid…
//   Where it was refunded or charged back there is no credit, and Premium is $499
//   gross." `writeServiceFeePayment` recorded a $99 credit unconditionally, with no
//   deposit lookup — so for a buyer whose $99 was refunded or charged back the
//   settlement ledger asserted a credit that did not exist. The display side had already
//   been corrected to check for a real PAID deposit; the ledger had not, so the two
//   disagreed and the ledger was the one that was wrong (PAY-52).
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/plan/__tests__/upgrade-window.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  request: Record<string, unknown> | null;
  deposits: Array<Record<string, unknown>>;
  deals: Array<{ id: string; vehicleRequestId: string; fundingClearedAt: Date | null }>;
  feePayment: { netAmountCents: number } | null;
  depositWhere: Record<string, unknown> | null;
}
let ctrl: Ctrl;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as Array<Record<string, unknown>>).some((c) => matches(row, c))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && "not" in (v as object)) {
      if (row[k] === (v as { not: unknown }).not) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && "in" in (v as object)) {
      if (!(v as { in: unknown[] }).in.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findUnique: async () => ctrl.request,
      },
      buyer: { findUnique: async () => ({ plan: "STANDARD" }) },
      planSnapshot: { findFirst: async () => null },
      deposit: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.depositWhere = where;
          return ctrl.deposits.filter((d) => matches(d, where));
        },
      },
      deal: {
        findMany: async () => ctrl.deals,
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          ctrl.deals.find((d) => matches(d as unknown as Record<string, unknown>, where)) ?? null,
      },
      serviceFeePayment: { findFirst: async () => ctrl.feePayment },
    },
  },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/plan/upgrade-window.service");
}

const SETTLED = {
  vehicleRequestId: "vr_1",
  amountCents: 9900,
  status: "PAID",
  refundedAt: null,
  disputedAt: null,
  holdReleasedAt: null,
};

beforeEach(() => {
  ctrl = {
    request: { buyerId: "buyer_1", currentPlanSnapshot: null },
    deposits: [SETTLED],
    deals: [],
    feePayment: null,
    depositWhere: null,
  };
});

// ── the window ───────────────────────────────────────────────────────────────

test("a settled $99 opens the window", async () => {
  const { isUpgradeWindowOpen } = await load();
  assert.deepEqual(await isUpgradeWindowOpen("vr_1"), { open: true });
});

test("no settled $99 means the window has NOT opened", async () => {
  ctrl.deposits = [];
  const { isUpgradeWindowOpen } = await load();
  const w = await isUpgradeWindowOpen("vr_1");
  assert.equal(w.open, false);
  assert.equal((w as { reason: string }).reason, "deposit_not_settled");
});

test("a PENDING deposit does not open it — election is not payment", async () => {
  ctrl.deposits = [{ ...SETTLED, status: "PENDING" }];
  const { isUpgradeWindowOpen } = await load();
  assert.equal((await isUpgradeWindowOpen("vr_1")).open, false);
});

test("a DISPUTED $99 closes the window: the credit basis is gone", async () => {
  ctrl.deposits = [{ ...SETTLED, status: "PAID", disputedAt: new Date(), holdReleasedAt: null }];
  const { isUpgradeWindowOpen } = await load();
  const w = await isUpgradeWindowOpen("vr_1");
  assert.equal(w.open, false);
  assert.equal(
    (w as { reason: string }).reason,
    "deposit_not_settled",
    "a held deposit is not a settled one — the hold clause is in the same query, not a fourth rule",
  );
});

test("a dispute WON re-opens it — hold_released_at is what makes the deposit count again", async () => {
  ctrl.deposits = [{ ...SETTLED, disputedAt: new Date(), holdReleasedAt: new Date() }];
  const { isUpgradeWindowOpen } = await load();
  assert.equal((await isUpgradeWindowOpen("vr_1")).open, true);
});

test("an already-settled Premium balance closes it", async () => {
  ctrl.deals = [{ id: "deal_1", vehicleRequestId: "vr_1", fundingClearedAt: null }];
  ctrl.feePayment = { netAmountCents: 40000 };
  const { isUpgradeWindowOpen } = await load();
  const w = await isUpgradeWindowOpen("vr_1");
  assert.equal(w.open, false);
  assert.equal((w as { reason: string }).reason, "already_premium");
});

// PAY-59a. The close predicate reads `deals.funding_cleared_at`, which nothing writes
// until Phase 8's clearance service. It is correct now and inert now — pinned here so
// that when Phase 8 ships, the behaviour is already proven rather than newly written.
test("funding cleared closes the window (Phase 8 writes the column this reads)", async () => {
  ctrl.deals = [{ id: "deal_1", vehicleRequestId: "vr_1", fundingClearedAt: new Date() }];
  const { isUpgradeWindowOpen } = await load();
  const w = await isUpgradeWindowOpen("vr_1");
  assert.equal(w.open, false);
  assert.equal((w as { reason: string }).reason, "funding_cleared");
  assert.match((w as { detail: string }).detail, /audited approval/, "PAY-76's late exception is named, not hidden");
});

test("a request that does not exist is closed, not open", async () => {
  ctrl.request = null;
  const { isUpgradeWindowOpen } = await load();
  const w = await isUpgradeWindowOpen("vr_missing");
  assert.equal(w.open, false);
  assert.equal((w as { reason: string }).reason, "request_not_found");
});

// ── the price ────────────────────────────────────────────────────────────────

test("with a settled $99, Premium is $499 less $99 — never a second $99", async () => {
  const { quotePremiumBalance } = await load();
  const q = await quotePremiumBalance("vr_1");
  assert.deepEqual(
    { gross: q.grossCents, credit: q.creditCents, due: q.dueCents, basis: q.creditBasis },
    { gross: 49900, credit: 9900, due: 40000, basis: "settled_deposit" },
  );
});

// PAY-52 / PAY-61 — the defect this file exists for.
test("a REFUNDED $99 is no credit: Premium is $499 GROSS", async () => {
  ctrl.deposits = [{ ...SETTLED, status: "REFUNDED", refundedAt: new Date() }];
  const { quotePremiumBalance } = await load();
  const q = await quotePremiumBalance("vr_1");
  assert.equal(q.creditCents, 0);
  assert.equal(q.dueCents, 49900, "the ledger recorded a $99 credit here before, and there was no $99");
  assert.equal(q.creditBasis, "none");
  assert.match(q.explanation, /no credit/);
});

test("a CHARGED-BACK $99 is no credit either", async () => {
  ctrl.deposits = [{ ...SETTLED, disputedAt: new Date(), holdReleasedAt: null }];
  const { quotePremiumBalance } = await load();
  assert.equal((await quotePremiumBalance("vr_1")).dueCents, 49900);
});

test("the gross never moves — never re-quoted, never prorated, never discounted by stage", async () => {
  const { quotePremiumBalance } = await load();
  const withCredit = await quotePremiumBalance("vr_1");
  ctrl.deposits = [];
  const without = await quotePremiumBalance("vr_1");
  assert.equal(withCredit.grossCents, 49900);
  assert.equal(without.grossCents, 49900);
  assert.equal(
    withCredit.dueCents + withCredit.creditCents,
    without.dueCents,
    "the only variable is whether the credit exists; there is no third answer",
  );
});

test("the credit is scoped to THIS request — §23.1: a new request means a new $99", async () => {
  const { quotePremiumBalance } = await load();
  await quotePremiumBalance("vr_1");
  assert.equal(ctrl.depositWhere?.vehicleRequestId, "vr_1");
  assert.equal(ctrl.depositWhere?.status, "PAID");
  assert.equal(ctrl.depositWhere?.refundedAt, null);
  assert.ok(Array.isArray(ctrl.depositWhere?.OR), "and the hold clause reaches the database with it");
});
