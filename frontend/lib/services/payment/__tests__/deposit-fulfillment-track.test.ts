// resolveDepositFulfillmentTrack — which fulfillment a $99 deposit belongs to.
//
// The Deposit row carries no track discriminator; the authoritative signal is the
// SAME one the Stripe webhook branches on, `pi.metadata.type`:
//   "deposit"            → standard  (competitive live auction + dealer invites)
//   "concierge_deposit"  → concierge (CLOSED auction converted from a curated review)
//
// Contract:
//   • a deposit with no PaymentIntent is admin-minted → standard by construction
//     (every concierge deposit is created through create-intent with a real PI);
//   • a sandbox mock intent is never a concierge binding → standard;
//   • an unrecognised / absent metadata type is "unknown" — callers fail CLOSED;
//   • a provider read failure is "unknown", never an optimistic "standard";
//   • the resolver is READ-ONLY: it never writes a deposit, an auction, or a
//     PaymentProviderEvent.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/deposit-fulfillment-track.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  deposit: { stripePaymentIntentId: string | null } | null;
  piMetadata: Record<string, string> | undefined;
  retrieveThrows: boolean;
  retrievedIds: string[];
  writes: number;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findFirst: async () => null,
        findUnique: async () => ctrl.deposit,
        update: async () => { ctrl.writes += 1; return {}; },
        updateMany: async () => { ctrl.writes += 1; return { count: 1 }; },
      },
      auction: { create: async () => { ctrl.writes += 1; return {}; } },
      paymentProviderEvent: { create: async () => { ctrl.writes += 1; return {}; } },
    },
  },
});

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    retrievePaymentIntent: async (id: string) => {
      ctrl.retrievedIds.push(id);
      if (ctrl.retrieveThrows) throw new Error("stripe unreachable");
      return { id, metadata: ctrl.piMetadata };
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
});

async function resolve(depositId = "dep_1") {
  const mod = await import("@/lib/services/payment/fulfillment-gate");
  return mod.resolveDepositFulfillmentTrack(depositId);
}

beforeEach(() => {
  ctrl = {
    deposit: { stripePaymentIntentId: "pi_live_1" },
    piMetadata: { type: "deposit" },
    retrieveThrows: false,
    retrievedIds: [],
    writes: 0,
  };
});

test("a real PI stamped type=deposit resolves to the standard competitive track", async () => {
  assert.equal(await resolve(), "standard");
  assert.deepEqual(ctrl.retrievedIds, ["pi_live_1"]);
});

test("a real PI stamped type=concierge_deposit resolves to the concierge track", async () => {
  ctrl.piMetadata = { type: "concierge_deposit", reviewToken: "rev_1" };
  assert.equal(await resolve(), "concierge");
});

test("an admin-minted deposit with no PaymentIntent is standard by construction", async () => {
  ctrl.deposit = { stripePaymentIntentId: null };
  assert.equal(await resolve(), "standard");
  assert.equal(ctrl.retrievedIds.length, 0, "no provider round-trip when there is no intent");
});

test("a sandbox mock intent is standard and never hits Stripe", async () => {
  ctrl.deposit = { stripePaymentIntentId: "pi_sandbox_mock_1712" };
  assert.equal(await resolve(), "standard");
  assert.equal(ctrl.retrievedIds.length, 0);
});

test("an absent or unrecognised metadata type is unknown — callers fail closed", async () => {
  ctrl.piMetadata = undefined;
  assert.equal(await resolve(), "unknown");
  ctrl.piMetadata = {};
  assert.equal(await resolve(), "unknown");
  ctrl.piMetadata = { type: "something_else" };
  assert.equal(await resolve(), "unknown");
});

test("a provider read failure is unknown, never an optimistic standard", async () => {
  ctrl.retrieveThrows = true;
  assert.equal(await resolve(), "unknown");
});

test("a missing deposit is unknown", async () => {
  ctrl.deposit = null;
  assert.equal(await resolve("nope"), "unknown");
});

test("the resolver is read-only — it writes nothing", async () => {
  await resolve();
  ctrl.piMetadata = { type: "concierge_deposit" };
  await resolve();
  ctrl.retrieveThrows = true;
  await resolve();
  assert.equal(ctrl.writes, 0, "classification must never mutate state");
});
