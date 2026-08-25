// Unit tests for refundDepositCharge — the shared FS-K primitive every admin
// deposit-refund path uses so a no-real-charge deposit is treated identically
// (NO_CHARGE, no money moved, no status flip). Batch 6 review fix: the three
// sibling refund paths (DEAL_CANCELLED, REFUND_TRIGGERED, AUCTION_REFUND_TRIGGERED)
// now route through this helper.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/refund-deposit-charge.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  refundThrows: { code?: string } | null;
  refundsCreated: number;
  flipCount: number;
  flipWhere: Record<string, unknown> | null;
}
let ctrl: Ctrl;

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    refundPaymentIntent: async () => {
      if (ctrl.refundThrows) { const e = Object.assign(new Error("stripe"), ctrl.refundThrows); throw e; }
      ctrl.refundsCreated += 1;
      return { id: "re_1" };
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.flipWhere = where;
          return { count: ctrl.flipCount };
        },
      },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/services/payment/refund.service"); }

beforeEach(() => {
  ctrl = { refundThrows: null, refundsCreated: 0, flipCount: 1, flipWhere: null };
});

test("NO_CHARGE for a null PaymentIntent — no Stripe call, no flip", async () => {
  const { refundDepositCharge } = await load();
  const out = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: null });
  assert.equal(out, "NO_CHARGE");
  assert.equal(ctrl.refundsCreated, 0);
  assert.equal(ctrl.flipWhere, null);
});

test("NO_CHARGE for a synthetic pi_admin_ id — no Stripe call, no flip", async () => {
  const { refundDepositCharge } = await load();
  const out = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_admin_seed1" });
  assert.equal(out, "NO_CHARGE");
  assert.equal(ctrl.refundsCreated, 0);
  assert.equal(ctrl.flipWhere, null);
});

test("REFUNDED for a real PI — issues one refund and flips (status-guarded)", async () => {
  const { refundDepositCharge } = await load();
  const out = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });
  assert.equal(out, "REFUNDED");
  assert.equal(ctrl.refundsCreated, 1);
  assert.deepEqual(ctrl.flipWhere, { id: "dep_1", status: "PAID" });
});

test("ALREADY_REFUNDED when a concurrent path won the flip (count 0)", async () => {
  ctrl.flipCount = 0;
  const { refundDepositCharge } = await load();
  const out = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });
  assert.equal(out, "ALREADY_REFUNDED");
});

test("charge_already_refunded is treated as money-already-gone → syncs to REFUNDED", async () => {
  ctrl.refundThrows = { code: "charge_already_refunded" };
  const { refundDepositCharge } = await load();
  const out = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });
  assert.equal(out, "REFUNDED");
  assert.deepEqual(ctrl.flipWhere, { id: "dep_1", status: "PAID" });
});

test("an unexpected Stripe error propagates (no flip)", async () => {
  ctrl.refundThrows = { code: "card_error" };
  const { refundDepositCharge } = await load();
  await assert.rejects(() => refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" }));
  assert.equal(ctrl.flipWhere, null, "no flip when the refund did not succeed");
});
