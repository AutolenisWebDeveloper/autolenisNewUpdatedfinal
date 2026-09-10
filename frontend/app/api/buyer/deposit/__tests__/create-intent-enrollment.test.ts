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
  legacyCancels: string[];
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
    getRequestUser: async () => ({ email_confirmed_at: "2026-01-01T00:00:00Z" }),
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
        // Phase 3: the route calls the shared obligation check, which selects every
        // obligation-bearing row for the buyer rather than point-looking-up one.
        findMany: async (args: { where: Record<string, unknown> }) => {
          const d = ctrl.existingDeposit;
          if (!d) return [];
          const statuses = ((args.where.status as Record<string, unknown>)?.in ?? []) as string[];
          return statuses.includes(d.status as string) ? [d] : [];
        },
        findFirst: async () => ctrl.existingDeposit,
        upsert: async () => ({ id: "dep_1" }),
        create: async () => ({ id: "dep_1" }),
        update: async () => ({ id: "dep_1" }),
        updateMany: async () => ({ count: 1 }),
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

// PHASE 3: the $99 series enrols on `comms_outbox`, not on the lifecycle rail. The
// property this file pins — ONE enrolment, from ONE owner, never for concierge — is
// unchanged; only the callee moved.
mock.module("@/lib/services/payment/deposit-reminder.service", {
  namedExports: {
    enrollDepositReminders: async (input: Record<string, unknown>) => {
      ctrl.enrollCalls.push(input);
      return { emailsEnqueued: 6, smsEnqueued: 6 };
    },
  },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    cancelPreCheckoutTouches: async (buyerId: string) => { ctrl.preCheckoutCancels.push(buyerId); return { canceled: 0, status: "OK" }; },
    // Called first, so a buyer already enrolled on the retired rail does not receive
    // every touch twice.
    cancelDepositReminderTouches: async (buyerId: string) => { ctrl.legacyCancels.push(buyerId); return { canceled: 0, status: "OK" }; },
  },
});

mock.module("@/lib/events/emit", {
  namedExports: {
    emitDomainEvent: async (name: string) => { ctrl.emitCalls.push(name); },
  },
});

// Phase 3: the route now resolves the buyer's open Vehicle Request, runs the §5a
// eligibility recheck and moves the request to PAYMENT_REQUIRED before it reaches the
// duplicate-charge logic these tests are about. Those are mocked to their passing
// answers here — they have their own suites — so this file keeps testing the one thing
// it was written for.
mock.module("@/lib/services/vehicle-request/open-request.service", {
  namedExports: {
    findOpenRequest: async () => ({ id: "vr_1", buyerId: BUYER_ID, status: "SUBMITTED" }),
    OPEN_REQUEST_STATUSES: ["DRAFT", "SUBMITTED", "INTAKE", "PAYMENT_REQUIRED"],
  },
});
mock.module("@/lib/services/vehicle-request/vehicle-request.service", {
  namedExports: { enterPaymentRequired: async () => true },
});
mock.module("@/lib/services/payment/deposit-eligibility", {
  namedExports: {
    // Two verdicts from one gather: §5a decides the PAYMENT_REQUIRED transition,
    // §5a-plus-disclosures decides whether a PaymentIntent may be minted. The
    // existing-obligation check sits BETWEEN them, which is why the route needs
    // them separately and why this fake returns both.
    gatherAndCheckEligibility: async () => ({ transition: { eligible: true }, intent: { eligible: true } }),
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
    legacyCancels: [],
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
