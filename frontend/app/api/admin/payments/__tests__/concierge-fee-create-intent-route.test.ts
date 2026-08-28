// Route tests for POST /api/admin/payments/concierge-fee/create-intent.
//
// THE DEFECT
// ----------
// Creating a PaymentIntent is not a payment — it is an invitation to pay. This
// route treated the two as the same thing and wrote settlement-shaped fields on
// the Deal the moment an intent existed:
//
//   * `stripeFeePIId` — which the rest of the codebase reads as the Stripe
//     reference for a fee that was actually charged. /buyer/billing gated its
//     "Service Fee History" section on it, so a fee nobody had paid appeared in
//     the buyer's payment history with an amount beside it; the admin refund
//     route issues refunds against it; the dealer document link reports it as
//     `transactionId`.
//   * `feeAmountCents` — the amount captured, per the webhook that writes it on
//     settlement.
//
// Worse, when Stripe itself failed the route invented `pi_fee_admin_<ts>_<deal>`
// and stored THAT as the payment reference — a fabricated identifier for a
// PaymentIntent that does not exist at Stripe, in the field everything else
// treats as proof the charge is real.
//
// THE RULE
// --------
// Only settlement writes settlement fields. The Stripe webhook already sets
// `stripeFeePIId` and `feeAmountCents` when the fee is actually paid, and it
// locates the deal by the `dealId` this route stamps into PI metadata — so
// nothing needed the early write. A Stripe failure is reported as a failure.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/payments/__tests__/concierge-fee-create-intent-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";

interface Ctrl {
  admin: { adminId: string; email: string } | null;
  deal: Record<string, unknown> | null;
  createThrows: Error | null;
  createdMetadata: Record<string, unknown> | null;
  dealUpdates: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminWithRole: async () => ctrl.admin,
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown, status = 200) => ({ __kind: "success", data, status }),
    getClientIp: () => "127.0.0.1",
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async () => ctrl.deal,
        update: async (args: Record<string, unknown>) => { ctrl.dealUpdates.push(args); return {}; },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return {}; },
      },
    },
  },
});

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      paymentIntents: {
        create: async (params: { metadata?: Record<string, unknown> }) => {
          if (ctrl.createThrows) throw ctrl.createThrows;
          ctrl.createdMetadata = params.metadata ?? null;
          return { id: "pi_real_from_stripe", client_secret: "cs_x" };
        },
      },
    }),
  },
});

mock.module("@/lib/security/rate-limit", {
  namedExports: { limitPaymentIntent: async () => ({ ok: true }) },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return (await import("@/app/api/admin/payments/concierge-fee/create-intent/route")).POST;
}

function req(body: Record<string, unknown> = { dealId: DEAL_ID, reason: "buyer asked to pay by link" }) {
  return new NextRequest("https://autolenis.com/api/admin/payments/concierge-fee/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  ctrl = {
    admin: { adminId: "admin_1", email: "admin@autolenis.com" },
    deal: { id: DEAL_ID, buyerId: "buyer_1", buyer: { plan: "PREMIUM", user: { email: "b@example.com" } } },
    createThrows: null,
    createdMetadata: null,
    dealUpdates: [],
    audits: [],
  };
});

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

test("creating an intent does NOT stamp the deal with a settlement reference", async () => {
  const POST = await load();
  const res = (await POST(req())) as unknown as { __kind: string };

  assert.equal(res.__kind, "success");
  const wroteSettlementField = ctrl.dealUpdates.some((u) => {
    const data = (u.data ?? {}) as Record<string, unknown>;
    return "stripeFeePIId" in data || "feeAmountCents" in data;
  });
  assert.equal(
    wroteSettlementField,
    false,
    "an unpaid intent must not write stripeFeePIId/feeAmountCents — those mean the fee was CHARGED",
  );
});

test("a Stripe failure is reported, never papered over with an invented id", async () => {
  ctrl.createThrows = new Error("stripe is down");

  const POST = await load();
  const res = (await POST(req())) as unknown as { __kind: string; status?: number };

  assert.equal(res.__kind, "error", "no intent exists, so this is not a success");
  assert.equal(
    ctrl.dealUpdates.length,
    0,
    "and no fabricated pi_fee_admin_* reference may be persisted as the fee's Stripe id",
  );
});

test("no audit log claims an intent that was never created", async () => {
  ctrl.createThrows = new Error("stripe is down");

  const POST = await load();
  await POST(req());

  assert.equal(ctrl.audits.length, 0, "an audit trail recording a non-existent PaymentIntent is a false record");
});

// ---------------------------------------------------------------------------
// Behaviour that must NOT regress
// ---------------------------------------------------------------------------

test("the PI still carries the dealId the webhook resolves settlement on", async () => {
  const POST = await load();
  await POST(req());

  assert.equal(ctrl.createdMetadata?.dealId, DEAL_ID, "removing the early write is only safe because metadata carries dealId");
  assert.equal(ctrl.createdMetadata?.type, "concierge_fee");
  assert.equal(ctrl.createdMetadata?.source, "admin_initiated");
});

test("the real intent id is still returned to the admin and audited", async () => {
  const POST = await load();
  const res = (await POST(req())) as unknown as { __kind: string; data?: Record<string, unknown> };

  assert.equal(res.data?.stripePaymentIntentId, "pi_real_from_stripe");
  assert.equal(ctrl.audits.length, 1, "the admin action is still recorded");
  assert.equal(ctrl.audits[0].action, "CONCIERGE_FEE_INTENT_CREATED");
  const meta = ctrl.audits[0].metadata as Record<string, unknown>;
  assert.equal(meta.intentId, "pi_real_from_stripe", "the reference lives in the audit trail, not on the Deal");
});

test("a non-Premium buyer is still rejected", async () => {
  ctrl.deal = { id: DEAL_ID, buyerId: "buyer_1", buyer: { plan: "STANDARD", user: { email: "b@example.com" } } };

  const POST = await load();
  const res = (await POST(req())) as unknown as { __kind: string; code?: string };
  assert.equal(res.code, "NOT_PREMIUM");
  assert.equal(ctrl.dealUpdates.length, 0);
});

test("a missing deal is still rejected", async () => {
  ctrl.deal = null;

  const POST = await load();
  const res = (await POST(req())) as unknown as { code?: string };
  assert.equal(res.code, "NOT_FOUND");
});

test("a non-finance admin is still rejected", async () => {
  ctrl.admin = null;

  const POST = await load();
  const res = (await POST(req())) as unknown as { code?: string };
  assert.equal(res.code, "FORBIDDEN");
});
