// Decision 3 — the rebuilt self-serve payout request rail.
//
// The old rail was disabled because it created orphaned PENDING payouts and
// stamped paidAt at request time. The rebuild uses the settlement CAS pattern:
//   • requestPayout: ONE transaction — eligibility (onboarding APPROVED,
//     payout method on file, no open request, claimable total ≥
//     AFFILIATE_PAYOUT_MINIMUM_CENTS) → create AffiliatePayout(PENDING) →
//     compare-and-set-claim the APPROVED unclaimed commissions (payoutId).
//     A claim-count mismatch (concurrent request) rolls the payout back.
//     Commissions stay APPROVED until settlement.
//   • settleRequestedPayout: ONE transaction — payout PENDING→PAID CAS, its
//     commissions APPROVED→PAID CAS (count-verified), settled-invariant
//     assertion. Recorded-only (no real money movement — unchanged TODO).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/payout-request.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

type Commission = {
  id: string;
  affiliateId: string;
  status: string;
  amountCents: number;
  payoutId: string | null;
  paidAt: Date | null;
  createdAt: Date;
};
type Payout = { id: string; affiliateId: string; status: string; amountCents: number; processedAt: Date | null; method?: string | null; reference?: string | null };

interface Ctrl {
  onboardingStatus: string | null;
  payoutMethod: { method: string } | null;
  commissions: Commission[];
  payouts: Payout[];
  // simulate a concurrent claim: N commissions get claimed elsewhere between
  // the read and the CAS updateMany
  stealBeforeClaim: number;
}
let ctrl: Ctrl;
let payoutSeq: number;

function makeTx() {
  return {
    affiliateOnboardingReview: {
      findUnique: async () => (ctrl.onboardingStatus ? { status: ctrl.onboardingStatus } : null),
    },
    affiliatePayoutMethod: {
      findUnique: async () => ctrl.payoutMethod,
    },
    affiliatePayout: {
      findFirst: async ({ where }: { where: { status?: string } }) =>
        ctrl.payouts.find((p) => (!where.status || p.status === where.status)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        ctrl.payouts.find((p) => p.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `payout_${++payoutSeq}`, processedAt: null, ...data } as unknown as Payout;
        ctrl.payouts.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const hits = ctrl.payouts.filter((p) => p.id === where.id && p.status === where.status);
        hits.forEach((p) => Object.assign(p, data));
        return { count: hits.length };
      },
    },
    commission: {
      findMany: async ({ where }: { where: { affiliateId?: string; status?: string; payoutId?: string | null } }) =>
        ctrl.commissions.filter(
          (c) =>
            (!where.affiliateId || c.affiliateId === where.affiliateId) &&
            (!where.status || c.status === where.status) &&
            (where.payoutId === undefined || c.payoutId === where.payoutId),
        ),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        // simulate concurrency: steal N rows right before the claim
        if (ctrl.stealBeforeClaim > 0) {
          const victims = ctrl.commissions.filter((c) => c.status === "APPROVED" && c.payoutId === null).slice(0, ctrl.stealBeforeClaim);
          victims.forEach((c) => { c.payoutId = "payout_thief"; });
          ctrl.stealBeforeClaim = 0;
        }
        const idIn = (where.id as { in?: string[] } | undefined)?.in;
        const st = where.status as string | { in?: string[] } | undefined;
        const hits = ctrl.commissions.filter((c) => {
          if (idIn && !idIn.includes(c.id)) return false;
          if ((where.payoutId === null && c.payoutId !== null)) return false;
          if (typeof where.payoutId === "string" && c.payoutId !== where.payoutId) return false;
          if (typeof st === "string" && c.status !== st) return false;
          if (st && typeof st === "object" && st.in && !st.in.includes(c.status)) return false;
          return true;
        });
        hits.forEach((c) => Object.assign(c, data));
        return { count: hits.length };
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        ctrl.commissions.find((c) => c.id === where.id) ?? null,
    },
    adminAuditLog: { create: async () => ({ id: "log_1" }) },
  };
}

const prismaMock = {
  $transaction: async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
    // snapshot/rollback semantics
    const snapshot = JSON.parse(JSON.stringify({ commissions: ctrl.commissions, payouts: ctrl.payouts }));
    try {
      return await cb(makeTx());
    } catch (err) {
      ctrl.commissions = snapshot.commissions.map((c: Commission) => ({ ...c, createdAt: new Date(c.createdAt), paidAt: c.paidAt ? new Date(c.paidAt) : null }));
      ctrl.payouts = snapshot.payouts;
      throw err;
    }
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

const OLD = new Date("2026-08-01T00:00:00Z");

beforeEach(() => {
  payoutSeq = 0;
  ctrl = {
    onboardingStatus: "APPROVED",
    payoutMethod: { method: "ACH" },
    commissions: [
      { id: "c1", affiliateId: "aff_1", status: "APPROVED", amountCents: 2000, payoutId: null, paidAt: null, createdAt: OLD },
      { id: "c2", affiliateId: "aff_1", status: "APPROVED", amountCents: 1500, payoutId: null, paidAt: null, createdAt: OLD },
      { id: "c3", affiliateId: "aff_1", status: "PENDING", amountCents: 9999, payoutId: null, paidAt: null, createdAt: OLD },
    ],
    payouts: [],
    stealBeforeClaim: 0,
  };
});

async function svc() {
  return import("@/lib/services/affiliate/affiliate-payout.service");
}

test("happy path: PENDING payout created, APPROVED commissions claimed, statuses unchanged until settlement", async () => {
  const { requestPayout } = await svc();
  const result = await requestPayout("aff_1");
  assert.equal(result.amountCents, 3500);
  assert.equal(result.commissionCount, 2);
  const payout = ctrl.payouts[0];
  assert.equal(payout.status, "PENDING");
  assert.equal(payout.amountCents, 3500);
  assert.equal(ctrl.commissions.find((c) => c.id === "c1")!.payoutId, payout.id);
  assert.equal(ctrl.commissions.find((c) => c.id === "c1")!.status, "APPROVED", "claimed but not yet paid");
  assert.equal(ctrl.commissions.find((c) => c.id === "c3")!.payoutId, null, "PENDING commissions are never claimed");
});

test("below minimum → BELOW_MINIMUM, nothing written", async () => {
  const { requestPayout, PayoutRequestError } = await svc();
  ctrl.commissions = [
    { id: "c1", affiliateId: "aff_1", status: "APPROVED", amountCents: 2000, payoutId: null, paidAt: null, createdAt: OLD },
  ];
  await assert.rejects(requestPayout("aff_1"), (e: unknown) => (e as InstanceType<typeof PayoutRequestError>).code === "BELOW_MINIMUM");
  assert.equal(ctrl.payouts.length, 0);
});

test("no payout method → NO_PAYOUT_METHOD", async () => {
  const { requestPayout, PayoutRequestError } = await svc();
  ctrl.payoutMethod = null;
  await assert.rejects(requestPayout("aff_1"), (e: unknown) => (e as InstanceType<typeof PayoutRequestError>).code === "NO_PAYOUT_METHOD");
});

test("onboarding not APPROVED → ONBOARDING_REQUIRED", async () => {
  const { requestPayout, PayoutRequestError } = await svc();
  ctrl.onboardingStatus = "SUBMITTED";
  await assert.rejects(requestPayout("aff_1"), (e: unknown) => (e as InstanceType<typeof PayoutRequestError>).code === "ONBOARDING_REQUIRED");
});

test("nothing claimable → NOTHING_TO_PAY", async () => {
  const { requestPayout, PayoutRequestError } = await svc();
  ctrl.commissions = [];
  await assert.rejects(requestPayout("aff_1"), (e: unknown) => (e as InstanceType<typeof PayoutRequestError>).code === "NOTHING_TO_PAY");
});

test("an open PENDING request blocks a second one", async () => {
  const { requestPayout, PayoutRequestError } = await svc();
  await requestPayout("aff_1");
  ctrl.commissions.push({ id: "c9", affiliateId: "aff_1", status: "APPROVED", amountCents: 9000, payoutId: null, paidAt: null, createdAt: OLD });
  await assert.rejects(requestPayout("aff_1"), (e: unknown) => (e as InstanceType<typeof PayoutRequestError>).code === "REQUEST_PENDING");
});

test("concurrent claim: CAS count mismatch rolls the payout back — no double-claim", async () => {
  const { requestPayout } = await svc();
  ctrl.stealBeforeClaim = 1; // one commission is claimed elsewhere mid-transaction
  await assert.rejects(requestPayout("aff_1"));
  assert.equal(ctrl.payouts.length, 0, "the payout row must roll back with the failed claim");
});

test("settleRequestedPayout: payout PENDING→PAID and its commissions APPROVED→PAID, count-verified", async () => {
  const { requestPayout, settleRequestedPayout } = await svc();
  const { payoutId } = await requestPayout("aff_1");
  const result = await settleRequestedPayout({ payoutId, paymentMethod: "ACH Transfer", paymentReference: "REF-9" });
  assert.equal(result.amountCents, 3500);
  const payout = ctrl.payouts.find((p) => p.id === payoutId)!;
  assert.equal(payout.status, "PAID");
  assert.ok(payout.processedAt instanceof Date);
  for (const id of ["c1", "c2"]) {
    const c = ctrl.commissions.find((x) => x.id === id)!;
    assert.equal(c.status, "PAID");
    assert.ok(c.paidAt);
    assert.equal(c.payoutId, payoutId);
  }
});

test("settleRequestedPayout: a non-PENDING payout is rejected (double-settle safe)", async () => {
  const { requestPayout, settleRequestedPayout } = await svc();
  const { payoutId } = await requestPayout("aff_1");
  await settleRequestedPayout({ payoutId, paymentMethod: "ACH Transfer", paymentReference: "REF-9" });
  await assert.rejects(settleRequestedPayout({ payoutId, paymentMethod: "ACH Transfer", paymentReference: "REF-9" }));
});
