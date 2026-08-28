// Tests for the deposit SETTLEMENT reconciler — P0 #2.
//
// THE DEFECT
// ----------
// Nothing in AutoLenis converts a succeeded Stripe PaymentIntent into a PAID
// Deposit. The Stripe webhook is the only writer of that transition, and no
// webhook has ever been delivered in production (payment_provider_events and
// webhook_events are both empty). `reconcileStuckActivations` cannot cover for
// it: its sweep filters `status: 'PAID'`, so it reconciles auction ACTIVATION
// for deposits that are already paid. A buyer whose $99 really left their card
// stays PENDING forever and gets no auction.
//
// THE FIX THIS PINS
// -----------------
// One missing stage: PENDING + Stripe says succeeded → PAID. Everything after
// that already exists — reconcileStuckActivations picks up a PAID deposit with
// no auction and creates, launches and invites (failing closed on a concierge
// track). So this reconciler does exactly one thing and hands off.
//
// Three safety properties are load-bearing and are pinned here:
//   1. It is OFF by default. Deploying the code changes nothing until an owner
//      turns it on.
//   2. It never touches an excluded deposit. Today the ONLY PENDING deposit in
//      production carrying a PaymentIntent is 77934f10-…, which is under owner
//      investigation and explicitly must not be acted on — so the exclusion is
//      not a nicety, it is the whole safety story.
//   3. It never writes a PaymentProviderEvent. That table means "a provider
//      event was received". This reconciler POLLED; fabricating an event would
//      destroy the same non-fabrication guarantee the admin override preserves.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/deposit-settlement.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const UNDER_INVESTIGATION = "77934f10-8c13-44b9-9a4a-1a5d7b0e99d6";
const PLAIN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

interface Ctrl {
  deposits: Array<Record<string, unknown>>;
  intents: Record<string, { status: string } | Error>;
  retrieved: string[];
  updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  providerEventWrites: number;
  notifications: Array<Record<string, unknown>>;
  lastFindArgs: Record<string, unknown> | null;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findMany: async (args: Record<string, unknown>) => {
          ctrl.lastFindArgs = args;
          const where = (args.where ?? {}) as Record<string, unknown>;
          const notIn = ((where.id as Record<string, unknown>)?.notIn ?? []) as string[];
          return ctrl.deposits.filter((d) => !notIn.includes(d.id as string));
        },
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          ctrl.updates.push(args);
          return { count: 1 };
        },
      },
      paymentProviderEvent: {
        create: async () => { ctrl.providerEventWrites += 1; return {}; },
        updateMany: async () => { ctrl.providerEventWrites += 1; return { count: 0 }; },
      },
      notification: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.notifications.push(data); return {}; },
      },
    },
  },
});

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    retrievePaymentIntent: async (id: string) => {
      ctrl.retrieved.push(id);
      const found = ctrl.intents[id];
      if (found instanceof Error) throw found;
      if (!found) throw new Error(`no such intent ${id}`);
      return found;
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/payment/deposit-settlement.service");
}

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

beforeEach(() => {
  ctrl = {
    deposits: [],
    intents: {},
    retrieved: [],
    updates: [],
    providerEventWrites: 0,
    notifications: [],
    lastFindArgs: null,
  };
  delete env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED;
  delete env().DEPOSIT_SETTLEMENT_EXCLUDED_DEPOSIT_IDS;
  // Guard the classic hazard: assigning undefined stores the STRING "undefined".
  assert.equal(env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED, undefined);
});

function enable() {
  env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED = "true";
}

function pendingDeposit(id: string, piId = `pi_${id.slice(0, 6)}`) {
  return { id, status: "PENDING", stripePaymentIntentId: piId, buyerId: "buyer_1", amountCents: 9900 };
}

// ---------------------------------------------------------------------------
// 1. OFF by default
// ---------------------------------------------------------------------------

test("defaults to OFF — deploying the code settles nothing", async () => {
  ctrl.deposits = [pendingDeposit(PLAIN)];
  ctrl.intents["pi_aaaaaa"] = { status: "succeeded" };

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();

  assert.equal(res.skipped, "deposit_settlement_reconciler_disabled");
  assert.equal(res.settled, 0);
  assert.equal(ctrl.retrieved.length, 0, "not even a provider round-trip while disabled");
  assert.equal(ctrl.updates.length, 0);
});

test('only the exact string "true" opens it', async () => {
  env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED = "TRUE";
  ctrl.deposits = [pendingDeposit(PLAIN)];

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();
  assert.equal(res.skipped, "deposit_settlement_reconciler_disabled");
});

// ---------------------------------------------------------------------------
// 2. The deposit under owner investigation
// ---------------------------------------------------------------------------

test("the under-investigation deposit is excluded BY DEFAULT, with no env set", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(UNDER_INVESTIGATION, "pi_under_investigation")];
  ctrl.intents["pi_under_investigation"] = { status: "succeeded" };

  const { reconcileDepositSettlements, DEFAULT_EXCLUDED_DEPOSIT_IDS } = await load();
  assert.ok(
    DEFAULT_EXCLUDED_DEPOSIT_IDS.includes(UNDER_INVESTIGATION),
    "the standing owner instruction must survive an unset env var",
  );

  const res = await reconcileDepositSettlements();
  assert.equal(res.settled, 0);
  assert.equal(
    ctrl.retrieved.length,
    0,
    "excluded means not even looked up — no provider round-trip about a deposit we must not act on",
  );
  assert.equal(ctrl.updates.length, 0);
});

test("the exclusion is applied in the QUERY, not after loading", async () => {
  enable();
  const { reconcileDepositSettlements } = await load();
  await reconcileDepositSettlements();

  const where = (ctrl.lastFindArgs?.where ?? {}) as Record<string, unknown>;
  const idClause = (where.id ?? {}) as Record<string, unknown>;
  assert.ok(
    Array.isArray(idClause.notIn) && (idClause.notIn as string[]).includes(UNDER_INVESTIGATION),
    "excluded ids must never be selected in the first place",
  );
});

test("the exclusion list is overridable by env", async () => {
  enable();
  env().DEPOSIT_SETTLEMENT_EXCLUDED_DEPOSIT_IDS = `${PLAIN} , ${UNDER_INVESTIGATION}`;
  ctrl.deposits = [pendingDeposit(PLAIN)];

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();
  assert.equal(res.settled, 0, "an env-listed id is excluded too, and whitespace is tolerated");
});

// ---------------------------------------------------------------------------
// 3. The settlement itself
// ---------------------------------------------------------------------------

test("a succeeded PaymentIntent settles the PENDING deposit to PAID", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_ok")];
  ctrl.intents["pi_ok"] = { status: "succeeded" };

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();

  assert.equal(res.settled, 1);
  assert.equal(ctrl.updates.length, 1);
  assert.equal(ctrl.updates[0].data.status, "PAID");
});

test("the write is scoped by the deposit state machine, not a bare id match", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_ok")];
  ctrl.intents["pi_ok"] = { status: "succeeded" };

  const { reconcileDepositSettlements } = await load();
  await reconcileDepositSettlements();

  const where = ctrl.updates[0].where;
  const status = where.status as { in?: string[] } | undefined;
  assert.ok(
    Array.isArray(status?.in) && status.in.includes("PENDING") && !status.in.includes("REFUNDED"),
    "a REFUNDED or already-PAID row must be unreachable by this write (allowedPredecessors('PAID'))",
  );
});

test("a processing PaymentIntent is NOT settled — the bank has not confirmed", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_proc")];
  ctrl.intents["pi_proc"] = { status: "processing" };

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();

  assert.equal(res.settled, 0);
  assert.equal(ctrl.updates.length, 0);
});

test("a failed PaymentIntent is left alone — this reconciler only settles", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_dead")];
  ctrl.intents["pi_dead"] = { status: "canceled" };

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();

  assert.equal(res.settled, 0);
  assert.equal(ctrl.updates.length, 0, "inventing a FAILED transition is a different decision, not this one");
});

// ---------------------------------------------------------------------------
// 4. Non-fabrication and robustness
// ---------------------------------------------------------------------------

test("settling NEVER writes a PaymentProviderEvent", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_ok")];
  ctrl.intents["pi_ok"] = { status: "succeeded" };

  const { reconcileDepositSettlements } = await load();
  await reconcileDepositSettlements();

  assert.equal(
    ctrl.providerEventWrites,
    0,
    "that table means a provider event was RECEIVED; this polled, and must not claim otherwise",
  );
});

test("a sandbox mock intent is skipped without calling Stripe", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_sandbox_mock_123")];

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();

  assert.equal(ctrl.retrieved.length, 0);
  assert.equal(res.settled, 0);
});

test("one unreachable intent does not abort the sweep", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_boom"), pendingDeposit("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "pi_ok")];
  ctrl.intents["pi_boom"] = new Error("stripe unavailable");
  ctrl.intents["pi_ok"] = { status: "succeeded" };

  const { reconcileDepositSettlements } = await load();
  const res = await reconcileDepositSettlements();

  assert.equal(res.settled, 1, "the reachable deposit still settles");
  assert.equal(res.errors, 1);
});

test("settling raises an operational alert — a poll-settled deposit means the webhook is down", async () => {
  enable();
  ctrl.deposits = [pendingDeposit(PLAIN, "pi_ok")];
  ctrl.intents["pi_ok"] = { status: "succeeded" };

  const { reconcileDepositSettlements } = await load();
  await reconcileDepositSettlements();

  assert.equal(ctrl.notifications.length, 1);
  assert.equal(ctrl.notifications[0].type, "SYSTEM_ALERT");
  assert.equal(ctrl.notifications[0].buyerId, null, "ops-only: the buyer is never told their payment was rescued by a cron");
});
