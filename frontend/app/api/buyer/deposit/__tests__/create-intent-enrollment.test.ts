// Tests for POST /api/buyer/deposit/create-intent — $99 deposit-conversion
// enrollment + CONCIERGE EXCLUSION (Sections 2, 10 tests #1/#2).
//
// Pins:
//   • the normal COMPETITIVE path (no reviewToken) enrolls the buyer in the
//     deposit-conversion reminder sequence exactly once;
//   • the CONCIERGE path (valid reviewToken bound to the buyer) does NOT enroll —
//     a concierge buyer must never receive both the review-link CTA and the
//     generic "$99 deposit" reminder sequence.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/deposit/__tests__/create-intent-enrollment.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const BUYER_ID = "11111111-1111-4111-8111-111111111111";
const BUYER_EMAIL = "buyer@example.com";
const REVIEW_TOKEN = "rev_tok_123";

interface Ctrl {
  enrollCalls: Array<Record<string, unknown>>;
  preCheckoutCancels: string[];
  emitCalls: string[];
  reviewRow: Record<string, unknown> | null;
  existingDeposit: Record<string, unknown> | null;
  shortlistCount: number;
  prequalValid: boolean;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({
      id: BUYER_ID,
      preQualification: { decision: "APPROVED" },
    }),
    successResponse: (data: unknown) => ({ ok: true, data }),
    errorResponse: (code: string, message: string, status: number) => ({ ok: false, code, message, status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOfferReview: { findUnique: async () => ctrl.reviewRow },
      buyer: {
        findUnique: async () => ({
          firstName: "Sam",
          lastName: "Buyer",
          phone: null,
          user: { email: BUYER_EMAIL },
        }),
      },
      shortlistItem: { count: async () => ctrl.shortlistCount },
      deposit: {
        findFirst: async () => ctrl.existingDeposit,
        upsert: async () => ({ id: "dep_1" }),
        create: async () => ({ id: "dep_1" }),
        update: async () => ({ id: "dep_1" }),
      },
    },
  },
});

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      paymentIntents: {
        create: async (args: Record<string, unknown>) => ({
          id: "pi_1",
          client_secret: "pi_1_secret",
          metadata: args.metadata,
        }),
        retrieve: async () => ({ status: "requires_payment_method", client_secret: "x", metadata: {} }),
      },
    }),
  },
});

mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitPaymentIntent: async () => ({ ok: true }),
    clientIpKey: () => "ip",
  },
});

mock.module("@/lib/services/prequal/prequal.service", {
  namedExports: { isPrequalValid: () => ctrl.prequalValid },
});

mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: {
    scheduleLifecycleWorkload: async (input: Record<string, unknown>) => { ctrl.enrollCalls.push(input); },
  },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    cancelPreCheckoutTouches: async (buyerId: string) => { ctrl.preCheckoutCancels.push(buyerId); return { canceled: 0, status: "OK" }; },
  },
});

mock.module("@/lib/events/emit", {
  namedExports: {
    emitDomainEvent: async (name: string) => { ctrl.emitCalls.push(name); },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() {
  return (await import("@/app/api/buyer/deposit/create-intent/route")).POST;
}

function req(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("https://autolenis.com/api/buyer/deposit/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  ctrl = {
    enrollCalls: [],
    preCheckoutCancels: [],
    emitCalls: [],
    reviewRow: null,
    existingDeposit: null,
    shortlistCount: 1,
    prequalValid: true,
  };
  // Ensure the non-production sandbox short-circuit (live key) is NOT taken.
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});

test("COMPETITIVE path enrolls the buyer exactly once (#1)", async () => {
  const POST = await load();
  const res = (await POST(req({}))) as { ok: boolean };
  assert.equal(res.ok, true);
  assert.equal(ctrl.enrollCalls.length, 1, "competitive buyer enrolled once");
  assert.equal(ctrl.enrollCalls[0].buyerId, BUYER_ID);
  assert.equal(ctrl.enrollCalls[0].email, BUYER_EMAIL);
  assert.ok(ctrl.emitCalls.includes("deposit_pending"), "competitive emits deposit_pending nurture event");
  // HANDOFF: a competitive PENDING deposit now exists → pre-checkout stage cancelled.
  assert.deepEqual(ctrl.preCheckoutCancels, [BUYER_ID], "pre-checkout handed off to deposit_reminder");
});

test("CONCIERGE path does NOT enroll (#2) — no reminder, no deposit_pending", async () => {
  ctrl.reviewRow = {
    buyerEmail: BUYER_EMAIL,
    expiresAt: new Date(Date.now() + 86400000),
    vehicleOfferId: "vo_1",
  };
  const POST = await load();
  const res = (await POST(req({ reviewToken: REVIEW_TOKEN }))) as { ok: boolean };
  assert.equal(res.ok, true);
  assert.equal(ctrl.enrollCalls.length, 0, "concierge buyer must NOT get the generic reminder");
  assert.equal(ctrl.emitCalls.length, 0, "concierge buyer must NOT feed the abandoned-deposit nurture");
  assert.equal(ctrl.preCheckoutCancels.length, 0, "concierge path does not touch the pre-checkout funnel");
});

test("already-paid buyer is rejected before any enrollment (#19 guard at intake)", async () => {
  ctrl.existingDeposit = { status: "PAID" };
  const POST = await load();
  const res = (await POST(req({}))) as { ok: boolean; code?: string };
  assert.equal(res.ok, false);
  assert.equal(res.code, "ALREADY_PAID");
  assert.equal(ctrl.enrollCalls.length, 0);
});
