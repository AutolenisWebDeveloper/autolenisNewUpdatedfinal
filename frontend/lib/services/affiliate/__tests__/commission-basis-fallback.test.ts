// M4 + M8 — the commission money contract across surfaces.
//
// M4: walkCommissionTree's defensive fallback (missing/zero basis) must use
// PREMIUM_FEE_REMAINING_CENTS ($400 — the amount actually captured after the
// $99 deposit credit), not PREMIUM_FEE_CENTS ($499). The old fallback overpaid
// a metadata-gap commission by ~25% ($74.85 vs $60.00). The buyer-facing
// "commission per deal" advertisement must be computed from the SAME constant
// the ledger pays on.
//
// M8: getBuyerReferralStats must count actual referred buyers
// (AffiliateReferral rows), never `children` (sub-AFFILIATES — a different
// relationship), and its earned total must follow the shared ledger rule
// (countsTowardEarned), not an ad-hoc "everything except REVERSED" that
// includes REJECTED.
//
// Lives under affiliate __tests__ (npm test glob) because it pins the affiliate
// money contract, even though one consumer is the buyer surface.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/commission-basis-fallback.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });

const PREMIUM_FEE_REMAINING_CENTS = 40000;
const LEVEL_1 = 0.15;

interface Ctrl {
  created: Array<Record<string, unknown>>;
  affiliate: Record<string, unknown> | null;
  buyerReferralCount: number;
  commissions: Array<{ amountCents: number; status: string }>;
  childrenCount: number;
}
let ctrl: Ctrl;

const prismaMock = {
  affiliate: {
    findUnique: async () => ctrl.affiliate,
    findFirst: async () => ({
      referralCode: "ALTEST1",
      commissions: ctrl.commissions,
      children: Array.from({ length: ctrl.childrenCount }, (_, i) => ({ id: `child_${i}` })),
    }),
  },
  affiliateReferral: {
    count: async () => ctrl.buyerReferralCount,
  },
  buyer: {
    findUnique: async () => ({ userId: "user_1" }),
  },
  commission: {
    findUnique: async () => null, // no existing commission — creation proceeds
    create: async ({ data }: { data: Record<string, unknown> }) => {
      ctrl.created.push(data);
      return data;
    },
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

beforeEach(() => {
  ctrl = {
    created: [],
    affiliate: { id: "aff_1", status: "ACTIVE", parent: null },
    buyerReferralCount: 0,
    commissions: [],
    childrenCount: 0,
  };
});

test("M4: zero/missing basis falls back to the captured $400, not the $499 sticker", async () => {
  const { walkCommissionTree } = await import("@/lib/services/affiliate/commission.service");
  await walkCommissionTree("deal_1", "aff_1", "pi_gap", 0);
  assert.equal(ctrl.created.length, 1);
  assert.equal(ctrl.created[0].basisCents, PREMIUM_FEE_REMAINING_CENTS);
  assert.equal(
    ctrl.created[0].amountCents,
    Math.round(PREMIUM_FEE_REMAINING_CENTS * LEVEL_1),
    "fallback commission must be 15% of $400 = $60.00, not 15% of $499",
  );
});

test("M4: a real basis is used as-is (fallback only for missing/zero)", async () => {
  const { walkCommissionTree } = await import("@/lib/services/affiliate/commission.service");
  await walkCommissionTree("deal_1", "aff_1", "pi_real", 40000);
  assert.equal(ctrl.created[0].basisCents, 40000);
});

test("M4+M8: advertised commissionPerDeal equals what the ledger actually pays on the standard fee", async () => {
  const { getBuyerReferralStats } = await import("@/lib/services/buyer/referral.service");
  const stats = await getBuyerReferralStats("buyer_1");
  assert.ok(stats);
  assert.equal(
    stats!.commissionPerDeal,
    Math.round(PREMIUM_FEE_REMAINING_CENTS * LEVEL_1),
    "buyer surface must advertise 6000¢ (15% of the $400 captured fee)",
  );
});

test("M8: referralCount counts AffiliateReferral rows, not sub-affiliate children", async () => {
  const { getBuyerReferralStats } = await import("@/lib/services/buyer/referral.service");
  ctrl.buyerReferralCount = 3;
  ctrl.childrenCount = 9; // must NOT be what's reported
  const stats = await getBuyerReferralStats("buyer_1");
  assert.equal(stats!.referralCount, 3);
});

test("M14: a SUSPENDED level skips its own commission; other levels still earn", async () => {
  const { walkCommissionTree } = await import("@/lib/services/affiliate/commission.service");
  ctrl.affiliate = {
    id: "aff_l1",
    status: "SUSPENDED", // the referring affiliate is suspended
    parent: { id: "aff_l2", status: "ACTIVE", parent: { id: "aff_l3", status: "REJECTED" } },
  };
  await walkCommissionTree("deal_1", "aff_l1", "pi_m14", 40000);
  const earners = ctrl.created.map((c) => c.affiliateId);
  assert.deepEqual(earners, ["aff_l2"], "only the ACTIVE L2 parent earns; SUSPENDED L1 and REJECTED L3 are skipped");
});

test("M14: PENDING affiliates still earn (activation model keeps PENDING quasi-active)", async () => {
  const { walkCommissionTree } = await import("@/lib/services/affiliate/commission.service");
  ctrl.affiliate = { id: "aff_p", status: "PENDING", parent: null };
  await walkCommissionTree("deal_1", "aff_p", "pi_m14b", 40000);
  assert.equal(ctrl.created.length, 1);
});

test("M8: earned total follows the shared ledger rule (REJECTED excluded, clawback offsets net)", async () => {
  const { getBuyerReferralStats } = await import("@/lib/services/buyer/referral.service");
  ctrl.commissions = [
    { amountCents: 6000, status: "PAID" },
    { amountCents: -6000, status: "REVERSED" }, // clawback offset — nets
    { amountCents: 999, status: "REJECTED" }, // never earned
    { amountCents: 1000, status: "PENDING" },
  ];
  const stats = await getBuyerReferralStats("buyer_1");
  assert.equal(stats!.totalEarnedCents, 1000);
});
