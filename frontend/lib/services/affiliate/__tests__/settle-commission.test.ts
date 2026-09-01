// settleApprovedCommission — the concurrency-safe single-commission settlement
// unit (F-002/F-003). These tests prove the settlement invariants Program 5
// requires structurally:
//   • an eligible (APPROVED) commission settles exactly once, creating exactly
//     one AffiliatePayout(PAID) linked back to the commission;
//   • the APPROVED→PAID compare-and-set is the guard, not the initial read — when
//     a concurrent settlement has already claimed the row (updateMany matches 0),
//     the second attempt throws CommissionNotClaimableError so its just-created
//     payout is rolled back by the enclosing transaction. This is what stops a
//     double-click / two admins from producing two payouts for one commission
//     (invariant: one commission can never belong to two payouts; a retry can
//     never double-pay);
//   • a missing or non-APPROVED commission is rejected before any payout is
//     created (no orphaned money-out record).
//
// The multi-connection serialization itself is a Postgres READ COMMITTED
// row-lock guarantee; here we prove the code STRUCTURE that relies on it by
// driving the compare-and-set outcome directly.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/settle-commission.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

interface Ctrl {
  commission:
    | { id: string; status: string; affiliateId: string; amountCents: number; createdAt: Date; paidAt?: Date | null; payoutId?: string | null }
    | null;
  // number of rows the compare-and-set updateMany reports as claimed
  claimCount: number;
  // T1.10: simulate a corrupted claim — the CAS "succeeds" but the persisted
  // row does not satisfy the settled invariant (e.g. payoutId never linked)
  corruptClaim: boolean;
  payoutsCreated: Array<Record<string, unknown>>;
  updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
}
let ctrl: Ctrl;
let payoutSeq: number;

const tx = {
  commission: {
    findUnique: async () => ctrl.commission,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      ctrl.updateManyCalls.push({ where, data });
      // Reflect the write so a post-claim read-back sees the persisted state,
      // exactly as Postgres would inside the same transaction.
      if (ctrl.claimCount === 1 && ctrl.commission) {
        ctrl.commission = {
          ...ctrl.commission,
          status: data.status as string,
          paidAt: (data.paidAt as Date) ?? ctrl.commission.paidAt ?? null,
          payoutId: ctrl.corruptClaim ? null : ((data.payoutId as string) ?? null),
        };
      }
      return { count: ctrl.claimCount };
    },
  },
  affiliatePayout: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `payout_${++payoutSeq}`, ...data };
      ctrl.payoutsCreated.push(row);
      return row;
    },
  },
};

const prismaMock = {
  // Interactive transaction: run the callback, propagating throws (a throw is a
  // rollback — exactly what we assert on the concurrency-loss path).
  $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

beforeEach(() => {
  payoutSeq = 0;
  ctrl = {
    commission: { id: "c_1", status: "APPROVED", affiliateId: "aff_1", amountCents: 4990, createdAt: new Date("2026-01-01") },
    claimCount: 1,
    corruptClaim: false,
    payoutsCreated: [],
    updateManyCalls: [],
  };
});

async function settle() {
  const { settleApprovedCommission } = await import("@/lib/services/affiliate/affiliate-payout.service");
  return settleApprovedCommission({ commissionId: "c_1", paymentMethod: "ACH Transfer", paymentReference: "REF-1" });
}

test("APPROVED commission settles exactly once: one PAID payout linked back", async () => {
  const result = await settle();

  assert.equal(ctrl.payoutsCreated.length, 1, "exactly one payout created");
  assert.equal(ctrl.payoutsCreated[0].status, "PAID");
  assert.equal(ctrl.payoutsCreated[0].amountCents, 4990);
  assert.equal(result.payoutId, "payout_1");

  // The claim is a compare-and-set on status = APPROVED, and links the payout.
  assert.equal(ctrl.updateManyCalls.length, 1);
  assert.equal(ctrl.updateManyCalls[0].where.status, "APPROVED");
  assert.equal(ctrl.updateManyCalls[0].data.status, "PAID");
  assert.equal(ctrl.updateManyCalls[0].data.payoutId, "payout_1");
  assert.ok(ctrl.updateManyCalls[0].data.paidAt instanceof Date);
});

test("concurrency loss: the compare-and-set matches 0 → throws, payout rolled back", async () => {
  // The row was APPROVED when we read it, but a concurrent settlement claimed it
  // before our updateMany ran — Postgres re-evaluates status = APPROVED against
  // the committed PAID row and matches 0.
  ctrl.claimCount = 0;

  const { CommissionNotClaimableError } = await import("@/lib/services/affiliate/affiliate-payout.service");
  await assert.rejects(settle(), (e: unknown) => e instanceof CommissionNotClaimableError);

  // A payout row was created inside the transaction, but the throw rolls the
  // whole transaction back — so it never persists and is never linked. Proven
  // here by the function REJECTING (the route maps that to a 409, no success).
  assert.equal(ctrl.updateManyCalls.length, 1, "the claim was attempted");
});

test("non-APPROVED commission is rejected before any payout is created", async () => {
  ctrl.commission = { id: "c_1", status: "PAID", affiliateId: "aff_1", amountCents: 4990, createdAt: new Date() };

  const { CommissionNotClaimableError } = await import("@/lib/services/affiliate/affiliate-payout.service");
  await assert.rejects(settle(), (e: unknown) => e instanceof CommissionNotClaimableError);

  assert.equal(ctrl.payoutsCreated.length, 0, "no money-out record for a non-APPROVED commission");
  assert.equal(ctrl.updateManyCalls.length, 0);
});

test("M11: post-claim settled-invariant assertion — a corrupted claim rolls the settlement back", async () => {
  // The CAS "succeeds" but the persisted row violates isCommissionSettled
  // (payoutId never linked — the exact corruption shape the invariant exists
  // to reject). The settlement must throw so the transaction rolls back.
  ctrl.corruptClaim = true;
  await assert.rejects(settle());
});

test("missing commission is rejected before any payout is created", async () => {
  ctrl.commission = null;

  const { CommissionNotClaimableError } = await import("@/lib/services/affiliate/affiliate-payout.service");
  await assert.rejects(settle(), (e: unknown) => e instanceof CommissionNotClaimableError);

  assert.equal(ctrl.payoutsCreated.length, 0);
  assert.equal(ctrl.updateManyCalls.length, 0);
});
