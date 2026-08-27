// Concierge isolation on the canonical deposit-activation cascade.
//
// The concierge track ($99 "concierge_deposit") converges to a CLOSED auction
// with offers converted from a curated review — it must NEVER enter the
// competitive cascade (live auction + dealer invitations). Normally the webhook
// mints that CLOSED auction inside the money-cluster transaction, so the
// reconciler only ever sees `hasAuction: true` and skips. But two paths can
// present a PAID concierge deposit with NO auction:
//
//   • the webhook's own documented edge — a concierge PI missing its
//     reviewToken is marked PAID with no auction created;
//   • an admin marking a concierge deposit PAID by hand.
//
// Either would make the reconciler create + launch + invite a competitive
// auction for a concierge buyer. The track check closes that: the authoritative
// signal is the SAME one the webhook branches on (pi.metadata.type), and it
// fails CLOSED — an indeterminate track never enters the competitive cascade.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/deposit-activation-concierge-isolation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const db = {
  deposit: null as Record<string, unknown> | null,
  createdNotifications: [] as Array<Record<string, unknown>>,
};

const calls = {
  createAuction: 0,
  launchAuction: 0,
  invites: 0,
};

/** What the fulfillment-gate track resolver reports for the deposit under test. */
let track: "standard" | "concierge" | "unknown" = "standard";
let trackThrows = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: { findUnique: async () => db.deposit },
      auction: { updateMany: async () => ({ count: 1 }) },
      notification: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          db.createdNotifications.push(data);
          return { id: "n1" };
        },
      },
    },
  },
});

mock.module("@/lib/services/auction/auction.service", {
  namedExports: {
    // Stateful like the real service: the created auction is visible to the
    // reconciler's next loadState, so the convergence loop advances instead of
    // re-deciding create_auction until it exhausts its bounded steps.
    createAuction: async () => {
      calls.createAuction += 1;
      if (db.deposit) {
        db.deposit.auction = {
          id: "auc_new",
          status: "PENDING",
          createdAt: new Date(),
          _count: { invitations: 0, offers: 0 },
        };
      }
      return { id: "auc_new" };
    },
    launchAuction: async () => {
      calls.launchAuction += 1;
      const a = db.deposit?.auction as Record<string, unknown> | null | undefined;
      if (a) a.status = "ACTIVE";
      return {};
    },
  },
});
mock.module("@/lib/services/auction/dealer-invitation.service", {
  namedExports: { inviteDealersToAuction: async () => { calls.invites += 1; return 3; } },
});
mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    getSupabase: () => ({}),
    acquireIdempotencyGuard: async () => true,
    releaseIdempotencyGuard: async () => {},
  },
});
mock.module("@/lib/services/payment/fulfillment-gate", {
  namedExports: {
    isFulfillmentUnlocked: async () => true,
    resolveDepositFulfillmentTrack: async () => {
      if (trackThrows) throw new Error("stripe unreachable");
      return track;
    },
  },
});

function paidDepositNoAuction(stripePaymentIntentId: string | null) {
  return {
    buyerId: "buyer_1",
    status: "PAID",
    refundedAt: null,
    stripePaymentIntentId,
    auction: null,
  };
}

async function reconcile(depositId = "dep_1") {
  const mod = await import("@/lib/services/auction/deposit-activation.service");
  return mod.reconcileDepositActivation(depositId);
}

beforeEach(() => {
  db.deposit = paidDepositNoAuction("pi_live_1");
  db.createdNotifications = [];
  calls.createAuction = 0;
  calls.launchAuction = 0;
  calls.invites = 0;
  track = "standard";
  trackThrows = false;
});

test("a standard deposit still converges through the competitive cascade", async () => {
  track = "standard";
  await reconcile();
  assert.equal(calls.createAuction, 1, "standard deposits must still create their auction");
});

test("a concierge deposit never enters the competitive cascade", async () => {
  track = "concierge";
  const outcome = await reconcile();
  assert.equal(calls.createAuction, 0, "no competitive auction for a concierge deposit");
  assert.equal(calls.launchAuction, 0);
  assert.equal(calls.invites, 0);
  assert.equal(outcome, "skip");
});

test("a concierge deposit stranded without its auction raises an operational exception", async () => {
  track = "concierge";
  await reconcile();
  const alert = db.createdNotifications.find((n) => n.type === "SYSTEM_ALERT");
  assert.ok(alert, "an operator must be told a concierge deposit is stranded");
  assert.equal(alert!.buyerId, undefined, "ops-only — never notify the buyer");
  assert.match(String(alert!.title), /dep_1/);
});

test("an indeterminate track fails CLOSED — no competitive cascade", async () => {
  track = "unknown";
  const outcome = await reconcile();
  assert.equal(calls.createAuction, 0, "an unresolvable track must not be treated as standard");
  assert.equal(outcome, "skip");
});

test("a track resolution failure fails CLOSED rather than launching an auction", async () => {
  trackThrows = true;
  const outcome = await reconcile();
  assert.equal(calls.createAuction, 0);
  assert.equal(outcome, "skip");
});

test("the track is only consulted when an auction would be created", async () => {
  // An existing PENDING auction is already deposit-bound; the launch step must
  // not pay for a Stripe round-trip (and a Stripe outage must not block it).
  trackThrows = true;
  db.deposit = {
    buyerId: "buyer_1",
    status: "PAID",
    refundedAt: null,
    stripePaymentIntentId: "pi_live_1",
    auction: {
      id: "auc_1",
      status: "ACTIVE",
      createdAt: new Date(Date.now() - 10 * 60_000),
      _count: { invitations: 4, offers: 0 },
    },
  };
  const outcome = await reconcile();
  assert.equal(outcome, "ok");
});
