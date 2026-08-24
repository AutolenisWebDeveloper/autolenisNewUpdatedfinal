// Unit tests for writeServiceFeePayment — the single idempotent writer of the
// service_fee_payments ledger row (Batch 6: recordFeePayment was dead, so the
// table never populated even after a real fee; the writer is now called from the
// Stripe webhook fee path).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/service-fee.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  existing: Record<string, unknown> | null;
  created: Array<Record<string, unknown>>;
  createThrows: { code: string } | null;
  findAfterConflict: Record<string, unknown> | null;
  findCalls: number;
}
let ctrl: Ctrl;

class FakeKnownRequestError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

mock.module("@prisma/client", {
  namedExports: { Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      serviceFeePayment: {
        findUnique: async () => {
          ctrl.findCalls += 1;
          // The post-conflict re-fetch (2nd+ call while a create threw P2002)
          // returns the concurrent winner's row.
          if (ctrl.findCalls > 1 && ctrl.createThrows) return ctrl.findAfterConflict;
          return ctrl.existing;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (ctrl.createThrows) { const e = new FakeKnownRequestError(ctrl.createThrows.code); throw e; }
          ctrl.created.push(data);
          return { id: "sfp_1", ...data };
        },
      },
    },
  },
});

// service-fee.service imports getStripe + advanceDealStatus at module load; stub
// both so importing the module is side-effect free (writeServiceFeePayment uses neither).
mock.module("@/lib/stripe", { namedExports: { getStripe: () => ({}) } });
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => {} } });

async function load() { return import("@/lib/services/deal/service-fee.service"); }

beforeEach(() => {
  ctrl = { existing: null, created: [], createThrows: null, findAfterConflict: null, findCalls: 0 };
});

test("creates a row with the correct $499/$99/$400 breakdown when none exists", async () => {
  const { writeServiceFeePayment } = await load();
  const row = await writeServiceFeePayment("deal_1", "pi_real_1");
  assert.equal(ctrl.created.length, 1);
  const d = ctrl.created[0]!;
  assert.equal(d.dealId, "deal_1");
  assert.equal(d.amountCents, 49900, "gross $499");
  assert.equal(d.depositCreditCents, 9900, "deposit credit $99");
  assert.equal(d.netAmountCents, 40000, "net $400");
  assert.equal(d.stripePaymentIntentId, "pi_real_1");
  assert.ok(d.paidAt instanceof Date);
  assert.equal((row as { dealId: string }).dealId, "deal_1");
});

test("idempotent — an existing row returns without a second create", async () => {
  ctrl.existing = { id: "sfp_existing", dealId: "deal_1" };
  const { writeServiceFeePayment } = await load();
  const row = await writeServiceFeePayment("deal_1", "pi_real_1");
  assert.equal(ctrl.created.length, 0, "no create when a row already exists");
  assert.equal((row as { id: string }).id, "sfp_existing");
});

test("a P2002 race returns the concurrent winner's row (no throw)", async () => {
  ctrl.createThrows = { code: "P2002" };
  ctrl.findAfterConflict = { id: "sfp_winner", dealId: "deal_1" };
  const { writeServiceFeePayment } = await load();
  const row = await writeServiceFeePayment("deal_1", "pi_real_1");
  assert.equal((row as { id: string }).id, "sfp_winner");
});

test("a non-P2002 create error propagates", async () => {
  ctrl.createThrows = { code: "P1000" };
  const { writeServiceFeePayment } = await load();
  await assert.rejects(() => writeServiceFeePayment("deal_1", "pi_real_1"));
});
