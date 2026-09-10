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
      // The fee is per DEAL and the plan rules are per REQUEST, so pricing the credit
      // crosses this one join.
      deal: { findUnique: async () => ({ vehicleRequestId: "vr_1" }) },
    },
  },
});

// service-fee.service imports getStripe + advanceDealStatus at module load; stub
// both so importing the module is side-effect free (writeServiceFeePayment uses neither).
mock.module("@/lib/stripe", { namedExports: { getStripe: () => ({}) } });
// PAY-52: the fee amount and the recorded credit are now the LEDGER's answer, not a
// constant — $499 less whatever $99 actually settled and was not refunded, disputed or
// charged back. The rule itself is pinned in
// `lib/services/plan/__tests__/upgrade-window.test.ts`; here it is held to the ordinary
// case so these tests stay about the duplicate-charge guard.
mock.module("@/lib/services/plan/upgrade-window.service", {
  namedExports: {
    quotePremiumBalance: async () => ({
      grossCents: 49900,
      creditCents: 9900,
      dueCents: 40000,
      creditBasis: "settled_deposit",
      explanation: "test quote",
    }),
  },
});

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
