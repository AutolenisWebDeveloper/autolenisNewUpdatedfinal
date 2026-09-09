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
  intentStatus: string;
  retrieved: string[];
}
let ctrl: Ctrl;

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    refundPaymentIntent: async () => {
      if (ctrl.refundThrows) { const e = Object.assign(new Error("stripe"), ctrl.refundThrows); throw e; }
      ctrl.refundsCreated += 1;
      return { id: "re_1" };
    },
    // Phase 3: the primitive now asks the provider whether the intent actually
    // succeeded before moving money. That check came from the admin refund route,
    // which was the only one of the three implementations that had it.
    retrievePaymentIntent: async (id: string) => {
      ctrl.retrieved.push(id);
      return { id, status: ctrl.intentStatus };
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
  ctrl = {
    refundThrows: null,
    refundsCreated: 0,
    flipCount: 1,
    flipWhere: null,
    intentStatus: "succeeded",
    retrieved: [],
  };
});

test("NO_CHARGE for a null PaymentIntent — no Stripe call, no flip", async () => {
  const { refundDepositCharge } = await load();
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: null });
  assert.equal(out, "NO_CHARGE");
  assert.equal(ctrl.refundsCreated, 0);
  assert.equal(ctrl.flipWhere, null);
});

test("NO_CHARGE for a synthetic pi_admin_ id — no Stripe call, no flip", async () => {
  const { refundDepositCharge } = await load();
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_admin_seed1" });
  assert.equal(out, "NO_CHARGE");
  assert.equal(ctrl.refundsCreated, 0);
  assert.equal(ctrl.flipWhere, null);
});

test("REFUNDED for a real PI — issues one refund and flips (status-guarded)", async () => {
  const { refundDepositCharge } = await load();
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });
  assert.equal(out, "REFUNDED");
  assert.equal(ctrl.refundsCreated, 1);
  // The predecessor SET is asserted once, in its own test below; here we only care
  // that the flip targeted this deposit and was status-guarded at all.
  assert.equal((ctrl.flipWhere as { id: string }).id, "dep_1");
  assert.ok((ctrl.flipWhere as { status?: unknown }).status, "the flip must stay status-guarded");
});

test("ALREADY_REFUNDED when a concurrent path won the flip (count 0)", async () => {
  ctrl.flipCount = 0;
  const { refundDepositCharge } = await load();
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });
  assert.equal(out, "ALREADY_REFUNDED");
});

test("charge_already_refunded is treated as money-already-gone → syncs to REFUNDED", async () => {
  ctrl.refundThrows = { code: "charge_already_refunded" };
  const { refundDepositCharge } = await load();
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });
  assert.equal(out, "REFUNDED");
  // The predecessor SET is asserted once, in its own test below; here we only care
  // that the flip targeted this deposit and was status-guarded at all.
  assert.equal((ctrl.flipWhere as { id: string }).id, "dep_1");
  assert.ok((ctrl.flipWhere as { status?: unknown }).status, "the flip must stay status-guarded");
});

test("an unexpected Stripe error propagates (no flip)", async () => {
  ctrl.refundThrows = { code: "card_error" };
  const { refundDepositCharge } = await load();
  await assert.rejects(() => refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" }));
  assert.equal(ctrl.flipWhere, null, "no flip when the refund did not succeed");
});

// Phase 3 additions: the checks the other two implementations carried, now in the one
// primitive so every caller gets them.

test("NOT_SUCCEEDED when Stripe says the intent never succeeded — no refund, no flip", async () => {
  const { refundDepositCharge } = await load();
  ctrl.intentStatus = "requires_payment_method";
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });

  assert.equal(out, "NOT_SUCCEEDED");
  assert.equal(ctrl.refundsCreated, 0, "refunding a non-succeeded intent 4xxs at Stripe");
  assert.equal(ctrl.flipWhere, null, "and our row must not claim a refund that never happened");
});

test("a sandbox mock id is NO_CHARGE — the old check knew only about pi_admin_", async () => {
  const { refundDepositCharge } = await load();
  const { outcome: out } = await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_sandbox_mock_17" });

  assert.equal(out, "NO_CHARGE");
  assert.deepEqual(ctrl.retrieved, [], "Stripe is never asked about an id it did not issue");
  assert.equal(ctrl.refundsCreated, 0);
});

test("the flip is matrix-scoped and admits a lost dispute", async () => {
  const { refundDepositCharge } = await load();
  await refundDepositCharge({ id: "dep_1", stripePaymentIntentId: "pi_real_1" });

  const where = ctrl.flipWhere as { status: { in: string[] } };
  assert.deepEqual(
    [...where.status.in].sort(),
    ["DISPUTED", "PAID"],
    "a dispute the platform loses returns the funds and Stripe reports the charge refunded, so the " +
      "row must be able to follow it — while PENDING and REFUNDED stay unreachable",
  );
});
