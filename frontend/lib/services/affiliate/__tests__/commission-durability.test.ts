// processFeeCommission — the single idempotent recovery unit for fee-driven
// affiliate commissions, called inline by the Stripe fee webhook AND replayed by
// the DLQ drainer (autolenis/affiliate.commission_walk). These tests prove the
// routing + idempotency guarantees the durable-recovery path depends on:
//   • no buyer / no referral → clean no-op (a replay for a non-referred buyer
//     never fabricates a commission);
//   • a referred buyer → exactly one commission per level, keyed on the
//     qualifying event, at the actual fee basis;
//   • a replay after the commission already exists creates nothing (safe to
//     re-drive any number of times).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/commission-durability.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });

interface PrismaCtrl {
  buyer: { userId: string } | null;
  referral: { affiliateId: string } | null;
  existingCommissionKeys: Set<string>;
  created: Array<Record<string, unknown>>;
}
let ctrl: PrismaCtrl;

const prismaMock = {
  buyer: { findUnique: async () => ctrl.buyer },
  affiliateReferral: { findFirst: async () => ctrl.referral },
  affiliate: {
    // Serves both walkCommissionTree lookups: the tree walk (parent chain) and
    // the earner lookup (user/profile for the CRM emit). A flat leaf affiliate
    // with no parents satisfies both shapes.
    findUnique: async () => ({ id: "aff_1", parent: null, user: { email: "aff@example.com" }, profile: { firstName: "A", lastName: "B" } }),
  },
  commission: {
    findUnique: async ({ where }: { where: { qualifyingEventId: string } }) =>
      ctrl.existingCommissionKeys.has(where.qualifyingEventId) ? { id: "c_exist" } : null,
    create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.created.push(data); return data; },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

beforeEach(() => {
  ctrl = { buyer: { userId: "user_1" }, referral: { affiliateId: "aff_1" }, existingCommissionKeys: new Set(), created: [] };
});

async function run(params: { dealId: string; buyerId: string; qualifyingEventId: string; feeBasisCents?: number }) {
  const { processFeeCommission } = await import("@/lib/services/affiliate/commission.service");
  await processFeeCommission(params);
}

test("no buyer → no commission created", async () => {
  ctrl.buyer = null;
  await run({ dealId: "d1", buyerId: "missing", qualifyingEventId: "pi_1", feeBasisCents: 40000 });
  assert.equal(ctrl.created.length, 0);
});

test("buyer with no referral → clean no-op (never fabricates a commission)", async () => {
  ctrl.referral = null;
  await run({ dealId: "d1", buyerId: "user_1", qualifyingEventId: "pi_1", feeBasisCents: 40000 });
  assert.equal(ctrl.created.length, 0);
});

test("referred buyer → one L1 commission keyed on the qualifying event at the actual basis", async () => {
  await run({ dealId: "d1", buyerId: "user_1", qualifyingEventId: "pi_1", feeBasisCents: 40000 });
  assert.equal(ctrl.created.length, 1);
  assert.equal(ctrl.created[0].qualifyingEventId, "pi_1-L1");
  assert.equal(ctrl.created[0].dealId, "d1");
  assert.equal(ctrl.created[0].basisCents, 40000);
  assert.equal(ctrl.created[0].status, "PENDING");
});

test("idempotent replay: the commission already exists → nothing created", async () => {
  ctrl.existingCommissionKeys = new Set(["pi_1-L1"]);
  await run({ dealId: "d1", buyerId: "user_1", qualifyingEventId: "pi_1", feeBasisCents: 40000 });
  assert.equal(ctrl.created.length, 0, "a re-drive after success must not double-pay");
});

test("missing identifiers → no-op (malformed replay never writes garbage)", async () => {
  await run({ dealId: "", buyerId: "user_1", qualifyingEventId: "pi_1", feeBasisCents: 40000 });
  assert.equal(ctrl.created.length, 0);
});
