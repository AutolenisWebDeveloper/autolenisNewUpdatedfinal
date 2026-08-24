// Route tests for POST /api/admin/payments/deposit/[depositId]/refund — the FS-K
// fix (Batch 6). A deposit with no REAL captured Stripe charge (no PaymentIntent,
// or a synthetic `pi_admin_` id) must NOT be flipped to REFUNDED or trigger the
// "your refund has been processed" buyer notification — no money ever moved.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/payments/__tests__/deposit-refund-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  admin: { adminId: string; email: string } | null;
  deposit: Record<string, unknown> | null;
  pi: { status: string };
  refundThrows: { code?: string; message?: string } | null;
  flipCount: number;
  flipWhere: Record<string, unknown> | null;
  notifications: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  refundsCreated: number;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminWithRole: async () => ctrl.admin,
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown) => ({ __kind: "success", data }),
    getClientIp: () => "127.0.0.1",
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findUnique: async () => ctrl.deposit,
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.flipWhere = where;
          return { count: ctrl.flipCount };
        },
      },
      notification: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.notifications.push(data); return {}; } },
      adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return {}; } },
    },
  },
});

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      paymentIntents: { retrieve: async () => ctrl.pi },
      refunds: {
        create: async () => {
          if (ctrl.refundThrows) { const e = Object.assign(new Error(ctrl.refundThrows.message ?? "stripe"), ctrl.refundThrows); throw e; }
          ctrl.refundsCreated += 1;
          return { id: "re_1" };
        },
      },
    }),
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  const mod = await import("@/app/api/admin/payments/deposit/[depositId]/refund/route");
  return mod.POST;
}

function req() {
  return { json: async () => ({ reason: "no-offer refund" }) } as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];
}
const params = Promise.resolve({ depositId: "dep_1" });

beforeEach(() => {
  ctrl = {
    admin: { adminId: "adm_1", email: "admin@autolenis.com" },
    deposit: { id: "dep_1", buyerId: "b1", status: "PAID", stripePaymentIntentId: "pi_real_1", amountCents: 9900, refundedAt: null },
    pi: { status: "succeeded" },
    refundThrows: null,
    flipCount: 1,
    flipWhere: null,
    notifications: [],
    audits: [],
    refundsCreated: 0,
  };
});

test("FS-K: a deposit with NO PaymentIntent is rejected — no flip, no buyer notification", async () => {
  ctrl.deposit = { ...ctrl.deposit!, stripePaymentIntentId: null };
  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { __kind: string; code: string; status: number };
  assert.equal(res.__kind, "error");
  assert.equal(res.code, "NO_STRIPE_CHARGE");
  assert.equal(res.status, 400);
  assert.equal(ctrl.flipWhere, null, "status is never flipped to REFUNDED");
  assert.equal(ctrl.notifications.length, 0, "buyer is never told a refund was processed");
  assert.equal(ctrl.refundsCreated, 0);
});

test("FS-K: a synthetic pi_admin_ deposit is rejected the same way", async () => {
  ctrl.deposit = { ...ctrl.deposit!, stripePaymentIntentId: "pi_admin_seed1" };
  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { code: string; status: number };
  assert.equal(res.code, "NO_STRIPE_CHARGE");
  assert.equal(res.status, 400);
  assert.equal(ctrl.flipWhere, null);
  assert.equal(ctrl.notifications.length, 0);
});

test("a real, succeeded PI refunds: Stripe refund issued, status-guarded flip, buyer notified", async () => {
  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { __kind: string; data: { status: string } };
  assert.equal(res.__kind, "success");
  assert.equal(ctrl.refundsCreated, 1, "a real Stripe refund was issued");
  assert.deepEqual(ctrl.flipWhere, { id: "dep_1", status: "PAID" }, "flip is guarded on still-PAID");
  assert.equal(ctrl.notifications.length, 1);
  assert.equal(ctrl.audits.length, 1);
  assert.equal(ctrl.audits[0]!.action, "DEPOSIT_REFUNDED");
});

test("a non-succeeded PI is refused (no refund, no flip)", async () => {
  ctrl.pi = { status: "requires_payment_method" };
  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { code: string; status: number };
  assert.equal(res.code, "STRIPE_PI_NOT_SUCCEEDED");
  assert.equal(res.status, 400);
  assert.equal(ctrl.refundsCreated, 0);
  assert.equal(ctrl.flipWhere, null);
});

test("an already-REFUNDED deposit is rejected up front", async () => {
  ctrl.deposit = { ...ctrl.deposit!, status: "REFUNDED" };
  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { code: string; status: number };
  assert.equal(res.code, "ALREADY_REFUNDED");
  assert.equal(res.status, 400);
  assert.equal(ctrl.flipWhere, null);
});

test("a concurrent refund (flip count 0) returns 409, not a false success", async () => {
  ctrl.flipCount = 0;
  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { code: string; status: number };
  assert.equal(res.code, "ALREADY_REFUNDED");
  assert.equal(res.status, 409);
});
