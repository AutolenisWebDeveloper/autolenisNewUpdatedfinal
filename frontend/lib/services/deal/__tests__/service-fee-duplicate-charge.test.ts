// Regression tests for createFeePaymentIntent — the duplicate concierge-fee
// charge (P0 #4), the fee-path sibling of the $99 deposit defect fixed in #343.
//
// THE DEFECT
// ----------
// The only duplicate guard on the fee is `deal.feePaidAt` (checked in
// app/api/buyer/deals/[dealId]/fee/create-intent/route.ts). That column is
// written by exactly one caller — recordFeePayment, reached only from the Stripe
// webhook. No webhook has ever been delivered in production, so a buyer who
// really paid the $400 net fee still has feePaidAt === null and sails past it.
//
// Nothing then stops a second charge. Unlike the deposit, the fee persists NO
// PaymentIntent id at creation time (`stripeFeePIId` is written only on
// settlement, and is read elsewhere as proof of payment — /buyer/billing filters
// paid deals by it — so it cannot be repurposed as a "pending" marker). The one
// thing standing in the way was Stripe's idempotency key, and Stripe only
// retains keys for 24h: the day after a real payment, `concierge-fee-${dealId}`
// no longer dedupes and a brand-new $400 PaymentIntent is minted for a buyer who
// has already paid.
//
// THE GUARANTEE
// -------------
// Stripe is authoritative about the money and our own row is not, so the fee
// asks Stripe directly — by the dealId stamped in PI metadata — before creating
// anything. If a concierge-fee PI for this deal has already succeeded or is
// processing, no new intent is created and no client secret is returned.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/service-fee-duplicate-charge.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const DEAL_ID = "deal_abc";
const BUYER_ID = "buyer_xyz";
const PAID_PI = "pi_fee_already_charged";

interface Ctrl {
  searchResults: Array<Record<string, unknown>>;
  searchThrows: Error | null;
  searchQueries: string[];
  createdPi: Record<string, unknown>;
  createCalls: Array<{ params: Record<string, unknown>; opts: Record<string, unknown> }>;
}
let ctrl: Ctrl;

mock.module("@prisma/client", {
  namedExports: { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
});
mock.module("@/lib/prisma", {
  namedExports: { prisma: { serviceFeePayment: { findUnique: async () => null, create: async () => ({}) } } },
});
mock.module("@/lib/services/deal/deal.service", {
  namedExports: { advanceDealStatus: async () => {} },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      paymentIntents: {
        search: async (params: { query: string }) => {
          ctrl.searchQueries.push(params.query);
          if (ctrl.searchThrows) throw ctrl.searchThrows;
          return { data: ctrl.searchResults };
        },
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          ctrl.createCalls.push({ params, opts });
          return ctrl.createdPi;
        },
      },
    }),
  },
});

async function load() {
  return (await import("@/lib/services/deal/service-fee.service")).createFeePaymentIntent;
}

beforeEach(() => {
  ctrl = {
    searchResults: [],
    searchThrows: null,
    searchQueries: [],
    createdPi: { id: "pi_fresh", client_secret: "pi_fresh_secret_x", status: "requires_payment_method" },
    createCalls: [],
  };
});

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

test("an already-succeeded fee PI for this deal blocks a second intent", async () => {
  ctrl.searchResults = [{ id: PAID_PI, status: "succeeded", metadata: { dealId: DEAL_ID, type: "concierge_fee" } }];

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "charge_unsettled");
  assert.equal(
    ctrl.createCalls.length,
    0,
    "THE MONEY GUARANTEE: no second $400 PaymentIntent for a buyer who already paid",
  );
  if (res.status === "charge_unsettled") {
    assert.equal(res.paymentIntentId, PAID_PI, "the reference must reach the buyer and support");
    assert.equal(res.intentStatus, "succeeded");
  }
});

test("a processing fee PI also blocks — money may already be moving", async () => {
  ctrl.searchResults = [{ id: "pi_in_flight", status: "processing", metadata: { dealId: DEAL_ID, type: "concierge_fee" } }];

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "charge_unsettled");
  assert.equal(ctrl.createCalls.length, 0);
  if (res.status === "charge_unsettled") assert.equal(res.intentStatus, "processing");
});

test("the lookup is scoped to THIS deal and to concierge-fee intents only", async () => {
  const createFeePaymentIntent = await load();
  await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(ctrl.searchQueries.length, 1, "exactly one lookup, before creating anything");
  const q = ctrl.searchQueries[0];
  assert.ok(q.includes(DEAL_ID), "must filter by this deal — another deal's charge must not block this one");
  assert.ok(
    q.includes("concierge_fee"),
    "must filter by fee type — a $99 deposit PI must never be mistaken for a paid fee",
  );
});

// ---------------------------------------------------------------------------
// The strictly-consistent backstop: Stripe search lags by up to a minute, so a
// charge made seconds ago may not be findable. Within 24h the idempotency key
// still returns the ORIGINAL PaymentIntent, which is authoritative.
// ---------------------------------------------------------------------------

test("a just-paid PI the search cannot see yet is still caught after create", async () => {
  ctrl.searchResults = []; // search lag — the charge is invisible
  ctrl.createdPi = { id: PAID_PI, client_secret: `${PAID_PI}_secret_x`, status: "succeeded" };

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(
    res.status,
    "charge_unsettled",
    "the idempotency key replayed the paid intent; its client secret must not be handed back",
  );
  if (res.status === "charge_unsettled") assert.equal(res.paymentIntentId, PAID_PI);
});

test("a failed Stripe search does not take the whole fee flow down", async () => {
  ctrl.searchThrows = new Error("stripe search unavailable");

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "ready", "a search outage must not block every legitimate first payment");
  assert.equal(ctrl.createCalls.length, 1);
});

test("a failed search still cannot leak a succeeded intent's client secret", async () => {
  ctrl.searchThrows = new Error("stripe search unavailable");
  ctrl.createdPi = { id: PAID_PI, client_secret: `${PAID_PI}_secret_x`, status: "succeeded" };

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "charge_unsettled", "the post-create check is the backstop when search is down");
});

// ---------------------------------------------------------------------------
// Behaviour that must NOT regress
// ---------------------------------------------------------------------------

test("a first-time payer still gets a client secret", async () => {
  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "ready");
  if (res.status === "ready") {
    assert.equal(res.clientSecret, "pi_fresh_secret_x");
    assert.equal(res.netFeeCents, 40000, "$499 gross less the $99 deposit credit = $400 net");
  }
  assert.equal(ctrl.createCalls.length, 1);
});

test("the deal-scoped idempotency key is preserved", async () => {
  const createFeePaymentIntent = await load();
  await createFeePaymentIntent(DEAL_ID, BUYER_ID);
  assert.equal(ctrl.createCalls[0].opts.idempotencyKey, `concierge-fee-${DEAL_ID}`);
});

test("the PI still carries the metadata the webhook resolves on", async () => {
  const createFeePaymentIntent = await load();
  await createFeePaymentIntent(DEAL_ID, BUYER_ID);
  assert.deepEqual(ctrl.createCalls[0].params.metadata, {
    dealId: DEAL_ID,
    buyerId: BUYER_ID,
    type: "concierge_fee",
  });
});

test("an abandoned (canceled) prior intent does not block a retry", async () => {
  ctrl.searchResults = [{ id: "pi_dead", status: "canceled", metadata: { dealId: DEAL_ID, type: "concierge_fee" } }];

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "ready", "a buyer who abandoned checkout must still be able to pay");
  assert.equal(ctrl.createCalls.length, 1);
});

test("a succeeded intent wins even when an abandoned one is listed first", async () => {
  ctrl.searchResults = [
    { id: "pi_dead", status: "canceled", metadata: { dealId: DEAL_ID, type: "concierge_fee" } },
    { id: PAID_PI, status: "succeeded", metadata: { dealId: DEAL_ID, type: "concierge_fee" } },
  ];

  const createFeePaymentIntent = await load();
  const res = await createFeePaymentIntent(DEAL_ID, BUYER_ID);

  assert.equal(res.status, "charge_unsettled", "one paid intent anywhere in the result set is enough");
  if (res.status === "charge_unsettled") assert.equal(res.paymentIntentId, PAID_PI);
  assert.equal(ctrl.createCalls.length, 0);
});
