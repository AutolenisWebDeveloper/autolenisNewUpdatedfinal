// Regression tests for POST /api/buyer/deposit/create-intent — the duplicate
// $99 charge path.
//
// THE DEFECT THESE PIN
// --------------------
// The intake guard only rejected `existingDeposit?.status === "PAID"`. But the
// live production condition is that a real payment leaves the Deposit row
// PENDING, because no Stripe webhook has ever been delivered — the webhook is
// the only writer that flips PENDING → PAID. So a buyer who genuinely paid
// still has status PENDING and sails straight past that guard.
//
// What used to happen next, in order:
//   1. the reuse branch retrieves the PaymentIntent and finds it `succeeded`;
//      `isReusable` covers only requires_payment_method / requires_confirmation
//      / requires_action, so a succeeded PI is NOT reusable and is skipped;
//   2. the terminal-state block does nothing — the PI is not `canceled`, and the
//      deposit IS "PENDING" so `existingDeposit.status !== "PENDING"` is false;
//   3. execution falls through to `paymentIntents.create`.
//
// Same calendar day the UTC-bucketed idempotency key masks it. The NEXT day the
// key changes, Stripe mints a genuinely new $99 PaymentIntent, the upsert writes
// a SECOND PENDING Deposit row, and the page renders a live card form to someone
// who has already been charged $99.
//
// The guarantee these tests hold is narrow and absolute: when the newest deposit
// is PENDING and its PaymentIntent already succeeded or is still processing,
// `paymentIntents.create` MUST NOT be called, and the caller must receive a
// distinct CHARGE_UNSETTLED code carrying the PaymentIntent id so the UI can
// tell the buyer not to pay again.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/deposit/__tests__/create-intent-duplicate-charge.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const BUYER_ID = "11111111-1111-4111-8111-111111111111";
const PAID_PI = "pi_already_charged_99";

interface Ctrl {
  existingDeposit: Record<string, unknown> | null;
  retrievedPi: Record<string, unknown>;
  createCalls: Array<Record<string, unknown>>;
  depositUpdates: Array<Record<string, unknown>>;
  upsertCalls: number;
  enrollCalls: number;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: BUYER_ID, preQualification: { decision: "APPROVED" } }),
    successResponse: (data: unknown) => ({ ok: true, data }),
    // Mirrors the real helper's optional 4th `details` argument so the tests can
    // assert the PaymentIntent id actually reaches the client.
    errorResponse: (code: string, message: string, status: number, details?: unknown) => ({
      ok: false,
      code,
      message,
      status,
      details,
    }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOfferReview: { findUnique: async () => null },
      buyer: {
        findUnique: async () => ({
          firstName: "Sam",
          lastName: "Buyer",
          phone: null,
          user: { email: "buyer@example.com" },
        }),
      },
      shortlistItem: { count: async () => 1 },
      deposit: {
        // Phase 3: the route no longer point-looks-up one row. It calls the shared
        // obligation check, which selects EVERY obligation-bearing row for the buyer
        // and asks Stripe about each. The fake models that selection rather than
        // returning the fixture unconditionally, so a test that sets a REFUNDED
        // fixture really does exercise "no obligation".
        findMany: async (args: { where: Record<string, unknown> }) => {
          const d = ctrl.existingDeposit;
          if (!d) return [];
          const statuses = ((args.where.status as Record<string, unknown>)?.in ?? []) as string[];
          return statuses.includes(d.status as string) ? [d] : [];
        },
        findFirst: async () => ctrl.existingDeposit,
        upsert: async () => { ctrl.upsertCalls += 1; return { id: "dep_1" }; },
        create: async () => ({ id: "dep_1" }),
        update: async (args: Record<string, unknown>) => { ctrl.depositUpdates.push(args); return { id: "dep_1" }; },
        updateMany: async (args: Record<string, unknown>) => { ctrl.depositUpdates.push(args); return { count: 1 }; },
      },
    },
  },
});

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      paymentIntents: {
        create: async (args: Record<string, unknown>) => {
          ctrl.createCalls.push(args);
          return { id: "pi_BRAND_NEW", client_secret: "pi_BRAND_NEW_secret_x", metadata: args.metadata };
        },
        retrieve: async () => ctrl.retrievedPi,
      },
    }),
  },
});

mock.module("@/lib/security/rate-limit", {
  namedExports: { limitPaymentIntent: async () => ({ ok: true }), clientIpKey: () => "ip" },
});
mock.module("@/lib/services/prequal/prequal.service", {
  namedExports: { isPrequalValid: () => true },
});
mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: { scheduleLifecycleWorkload: async () => { ctrl.enrollCalls += 1; } },
});
mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: { cancelPreCheckoutTouches: async () => ({ canceled: 0, status: "OK" }) },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return (await import("@/app/api/buyer/deposit/create-intent/route")).POST;
}

function req(): NextRequest {
  return new NextRequest("https://autolenis.com/api/buyer/deposit/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  ctrl = {
    existingDeposit: null,
    retrievedPi: { status: "requires_payment_method", client_secret: "cs_reusable", metadata: {} },
    createCalls: [],
    depositUpdates: [],
    upsertCalls: 0,
    enrollCalls: 0,
  };
  // Keep the non-production live-key sandbox short-circuit out of the way.
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});

// ---------------------------------------------------------------------------
// The defect itself
// ---------------------------------------------------------------------------

test("succeeded PaymentIntent + PENDING deposit → CHARGE_UNSETTLED, and NO new intent", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: PAID_PI };
  ctrl.retrievedPi = { status: "succeeded", client_secret: `${PAID_PI}_secret_x`, metadata: { type: "deposit" } };

  const POST = await load();
  const res = (await POST(req())) as {
    ok: boolean;
    code?: string;
    status?: number;
    details?: { paymentIntentId?: string; intentStatus?: string };
  };

  assert.equal(res.ok, false);
  assert.equal(res.code, "CHARGE_UNSETTLED", "must be its own code, not ALREADY_PAID or STRIPE_ERROR");
  assert.equal(
    ctrl.createCalls.length,
    0,
    "THE MONEY GUARANTEE: a buyer who already paid must never have a second PaymentIntent minted",
  );
  assert.equal(ctrl.upsertCalls, 0, "and no second PENDING Deposit row may be written");
  assert.equal(
    res.details?.paymentIntentId,
    PAID_PI,
    "the reference must travel to the client so the buyer can be shown it and quote it to support",
  );
});

test("the succeeded PI is reported as such, so the UI can pick the right honest copy", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: PAID_PI };
  ctrl.retrievedPi = { status: "succeeded", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  const res = (await POST(req())) as { details?: { intentStatus?: string } };
  assert.equal(res.details?.intentStatus, "succeeded");
});

test("processing PaymentIntent + PENDING deposit → CHARGE_UNSETTLED, and NO new intent", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: "pi_bank_still_confirming" };
  ctrl.retrievedPi = { status: "processing", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  const res = (await POST(req())) as { ok: boolean; code?: string; details?: { intentStatus?: string } };

  assert.equal(res.ok, false);
  assert.equal(res.code, "CHARGE_UNSETTLED");
  assert.equal(res.details?.intentStatus, "processing");
  assert.equal(ctrl.createCalls.length, 0, "money may already be moving — never mint a parallel intent");
});

test("a charged buyer is never re-enrolled in the abandoned-deposit nurture", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: PAID_PI };
  ctrl.retrievedPi = { status: "succeeded", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  await POST(req());
  assert.equal(ctrl.enrollCalls, 0, "chasing someone who already paid to pay again is the same defect by email");
});

test("the charged buyer's deposit row is NOT marked FAILED", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: PAID_PI };
  ctrl.retrievedPi = { status: "succeeded", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  await POST(req());
  assert.deepEqual(
    ctrl.depositUpdates,
    [],
    "a succeeded charge is not a failure; the webhook/reconciler still needs this row as PENDING",
  );
});

// ---------------------------------------------------------------------------
// Behaviour that must NOT regress
// ---------------------------------------------------------------------------

test("a reusable PENDING intent is still reused, not blocked", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: "pi_unpaid" };
  ctrl.retrievedPi = {
    status: "requires_payment_method",
    client_secret: "cs_reusable",
    metadata: { type: "deposit" },
  };

  const POST = await load();
  const res = (await POST(req())) as { ok: boolean; data?: { clientSecret?: string } };
  assert.equal(res.ok, true);
  assert.equal(res.data?.clientSecret, "cs_reusable");
  assert.equal(ctrl.createCalls.length, 0);
});

test("a canceled intent still falls through to a fresh create", async () => {
  ctrl.existingDeposit = { id: "dep_1", status: "PENDING", stripePaymentIntentId: "pi_dead" };
  ctrl.retrievedPi = { status: "canceled", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  const res = (await POST(req())) as { ok: boolean };
  assert.equal(res.ok, true);
  assert.equal(ctrl.createCalls.length, 1, "an abandoned intent must still be replaceable");
  assert.equal(ctrl.depositUpdates.length, 1, "and the dead row marked FAILED");
});

test("a buyer with no deposit at all still gets an intent", async () => {
  ctrl.existingDeposit = null;
  const POST = await load();
  const res = (await POST(req())) as { ok: boolean };
  assert.equal(res.ok, true);
  assert.equal(ctrl.createCalls.length, 1);
});

test("an ALREADY_PAID deposit still short-circuits, with its own clearer message", async () => {
  // The fixture now states BOTH facts, because Phase 3 requires both to agree before
  // the buyer is told they have paid: our row says PAID and Stripe says the intent
  // succeeded. The old fixture left the PaymentIntent at the beforeEach default
  // (`requires_payment_method`), so it was asserting "already paid" for a deposit the
  // provider said had never been paid — the exact disagreement the CONTRADICTION case
  // below now refuses to resolve silently.
  ctrl.existingDeposit = { id: "dep_1", status: "PAID", stripePaymentIntentId: PAID_PI };
  ctrl.retrievedPi = { status: "succeeded", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  const res = (await POST(req())) as { ok: boolean; code?: string };
  assert.equal(res.code, "ALREADY_PAID", "settled deposits keep their own clearer message");
  assert.equal(ctrl.createCalls.length, 0);
});

test("a PAID row the provider contradicts is blocked, reported to the buyer from OUR record, and flagged", async () => {
  // Our record says the money arrived; Stripe says that intent never took it. The
  // known producer is the admin deposit override, which writes PAID with no charge.
  // Two wrong answers are available here and both are silent: mint (charging someone
  // whose record says paid) or reuse (letting a "settled" deposit be paid again).
  ctrl.existingDeposit = { id: "dep_1", status: "PAID", stripePaymentIntentId: PAID_PI };
  ctrl.retrievedPi = { status: "requires_payment_method", client_secret: "x", metadata: { type: "deposit" } };

  const POST = await load();
  const res = (await POST(req())) as { ok: boolean; code?: string; details?: Record<string, unknown> };

  // ALREADY_PAID, not CHARGE_UNSETTLED. Both block, so neither risks a double charge,
  // and the only question is which sentence is true: "it isn't recorded on our side
  // yet" is false for a row that IS recorded on our side. The disagreement travels as
  // `needsReview` for Finance instead of as confusing copy for the buyer.
  assert.equal(res.code, "ALREADY_PAID");
  assert.equal(ctrl.createCalls.length, 0, "and no second intent is minted");
  assert.equal(res.details?.intentStatus, "requires_payment_method", "the disagreement is reported, not hidden");
  assert.equal(res.details?.needsReview, true, "and flagged, because one of the two records is wrong");
});
