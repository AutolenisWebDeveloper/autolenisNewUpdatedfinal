// Tests for the shared provider-side existing-obligation check.
//
// MONEY-PATH DEFECT 4. Three paths minted a $99 obligation and each had its own
// idea of what an existing one was: the buyer route point-looked-up the newest
// PENDING/PAID row, admin create-intent checked nothing at all, and admin
// send-link looked only for PENDING — so a buyer who had already paid got a
// second Checkout Session and a second Deposit row. This module is the one
// answer, and these are the cases that made three answers dangerous.
//
// The load-bearing property is in the second test: the guard must hold when our
// OWN column is wrong. §5d says "a buyer is never charged twice because local
// webhook state is stale", and production has recorded webhook gaps, so a
// duplicate guard that reads Deposit.status is guarding the wrong thing.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/deposit-obligation.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  deposits: Array<Record<string, unknown>>;
  intents: Record<string, { status: string } | Error>;
  retrieved: string[];
  lastWhere: Record<string, unknown> | null;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          ctrl.lastWhere = args.where;
          const w = args.where;
          const statuses = ((w.status as Record<string, unknown>)?.in ?? []) as string[];
          // Model the OR( vehicleRequestId = X, vehicleRequestId IS NULL ) scoping
          // faithfully — the point of several of these tests is that the scope is
          // what keeps one request's money out of another's.
          const or = w.OR as Array<{ vehicleRequestId: string | null }> | undefined;
          return ctrl.deposits
            .filter((d) => d.buyerId === w.buyerId)
            .filter((d) => statuses.includes(d.status as string))
            .filter((d) => !or || or.some((c) => (d.vehicleRequestId ?? null) === c.vehicleRequestId));
        },
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
  return import("@/lib/services/payment/deposit-obligation");
}

beforeEach(() => {
  ctrl = { deposits: [], intents: {}, retrieved: [], lastWhere: null };
});

function dep(over: Record<string, unknown> = {}) {
  return {
    id: "dep_1",
    buyerId: "buyer_1",
    status: "PENDING",
    stripePaymentIntentId: "pi_live_1",
    vehicleRequestId: "vr_1",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  };
}

test("a succeeded intent is a SETTLED obligation and blocks a new intent", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [dep({ status: "PAID" })];
  ctrl.intents = { pi_live_1: { status: "succeeded" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "SETTLED");
  assert.ok(blocksNewIntent(o));
});

// THE ONE THAT MATTERS. Our column says PENDING; the money settled days ago and the
// webhook never arrived. A guard reading Deposit.status mints a second $99.
test("DEFECT 4: a PENDING row whose intent already succeeded still blocks — Stripe is authoritative, not our column", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [dep({ status: "PENDING" })];
  ctrl.intents = { pi_live_1: { status: "succeeded" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "SETTLED", "local PENDING must not be believed over a succeeded PaymentIntent");
  assert.ok(blocksNewIntent(o));
  assert.deepEqual(ctrl.retrieved, ["pi_live_1"], "the provider was actually asked");
});

// DEFECT 1 and 4 meeting. The old behaviour parked declines at FAILED; those intents
// are still live, and minting against them charges twice.
test("DEFECT 1+4: a FAILED row with a live intent is IN_FLIGHT — reuse it, never mint beside it", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [dep({ status: "FAILED" })];
  ctrl.intents = { pi_live_1: { status: "requires_payment_method" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "IN_FLIGHT");
  assert.equal(o.kind === "IN_FLIGHT" ? o.paymentIntentId : null, "pi_live_1");
  assert.ok(!blocksNewIntent(o), "it does not block — it is what the caller reuses");
});

test("a cancelled intent carries no obligation, and the dead row is handed back to be retired", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [dep({ status: "FAILED" })];
  ctrl.intents = { pi_live_1: { status: "canceled" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1" });
  assert.equal(o.kind, "NONE");
  assert.ok(!blocksNewIntent(o));
  assert.deepEqual(
    o.kind === "NONE" ? o.deadDepositIds : null,
    ["dep_1"],
    "this is the only place that learns the intent is dead; discarding it leaves the row PENDING " +
      "for ever, re-checked at Stripe on every call and still drawing reminder touches",
  );
});

test("a PENDING row whose intent is still being confirmed BLOCKS rather than being reused", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [dep({ status: "PENDING" })];
  ctrl.intents = { pi_live_1: { status: "processing" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "SETTLING");
  assert.ok(blocksNewIntent(o), "the money is probably already moving");
});

test("a PAID row the provider says was never paid is a CONTRADICTION, and blocks both ways", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [dep({ status: "PAID" })];
  ctrl.intents = { pi_live_1: { status: "requires_payment_method" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "CONTRADICTION");
  assert.ok(
    blocksNewIntent(o),
    "minting charges someone whose record says paid; reusing lets a settled deposit be paid twice",
  );
});

test("an unreachable provider FAILS CLOSED and outranks a reusable row", async () => {
  const { findExistingDepositObligation, blocksNewIntent } = await load();
  ctrl.deposits = [
    dep({ id: "dep_new", stripePaymentIntentId: "pi_down", createdAt: new Date("2026-09-02T00:00:00Z") }),
    dep({ id: "dep_old", stripePaymentIntentId: "pi_live_1", createdAt: new Date("2026-09-01T00:00:00Z") }),
  ];
  ctrl.intents = {
    pi_down: new Error("Stripe unreachable"),
    pi_live_1: { status: "requires_payment_method" },
  };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "PROVIDER_UNREACHABLE");
  assert.ok(blocksNewIntent(o), "'we could not check' must stop the mint, not wave it through");
});

test("every candidate is checked, not just the newest — a settled older row must not hide behind a fresher one", async () => {
  const { findExistingDepositObligation } = await load();
  ctrl.deposits = [
    dep({ id: "dep_new", stripePaymentIntentId: "pi_new", createdAt: new Date("2026-09-05T00:00:00Z") }),
    dep({ id: "dep_old", stripePaymentIntentId: "pi_old", createdAt: new Date("2026-09-01T00:00:00Z") }),
  ];
  ctrl.intents = {
    pi_new: { status: "requires_payment_method" },
    pi_old: { status: "succeeded" },
  };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "SETTLED", "the settled row wins wherever it sits in the list");
  assert.equal(o.kind === "SETTLED" ? o.deposit.id : null, "dep_old");
  assert.deepEqual(ctrl.retrieved.sort(), ["pi_new", "pi_old"]);
});

test("a deposit attached to a DIFFERENT request is invisible — plan is elected per request", async () => {
  const { findExistingDepositObligation } = await load();
  ctrl.deposits = [dep({ vehicleRequestId: "vr_OTHER", status: "PAID" })];
  ctrl.intents = { pi_live_1: { status: "succeeded" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "NONE", "§23.1: a new request means a new $99");
  assert.deepEqual(ctrl.retrieved, [], "and the provider is not even asked about another request's money");
});

test("an UNATTACHED deposit is adopted into this request rather than ignored", async () => {
  const { findExistingDepositObligation } = await load();
  ctrl.deposits = [dep({ vehicleRequestId: null, status: "PENDING" })];
  ctrl.intents = { pi_live_1: { status: "succeeded" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(
    o.kind,
    "SETTLED",
    "one-open-request-per-buyer means an unattached deposit can only belong to the request they have; " +
      "ignoring it would charge them twice",
  );
});

test("a locally-minted synthetic id is UNVERIFIABLE and Stripe is never asked about it", async () => {
  const { findExistingDepositObligation, isSyntheticIntentId } = await load();
  ctrl.deposits = [dep({ stripePaymentIntentId: "pi_admin_1757_abcd1234" })];

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "UNVERIFIABLE");
  assert.deepEqual(ctrl.retrieved, [], "asking Stripe about an id it never issued is a guaranteed error");
  assert.ok(isSyntheticIntentId("pi_sandbox_mock_1"));
  assert.ok(isSyntheticIntentId("pi_fee_admin_1"));
  assert.ok(!isSyntheticIntentId("pi_3Abc"));
});

test("a REFUNDED deposit carries no obligation — the money went back, so it is owed again", async () => {
  const { findExistingDepositObligation } = await load();
  ctrl.deposits = [dep({ status: "REFUNDED" })];
  ctrl.intents = { pi_live_1: { status: "succeeded" } };

  const o = await findExistingDepositObligation({ buyerId: "buyer_1", vehicleRequestId: "vr_1" });
  assert.equal(o.kind, "NONE");
  const statuses = ((ctrl.lastWhere?.status as Record<string, unknown>)?.in ?? []) as string[];
  assert.ok(!statuses.includes("REFUNDED"));
  assert.deepEqual(statuses.sort(), ["DISPUTED", "FAILED", "PAID", "PENDING"]);
});

test("classifyIntentLiveness keeps a declined attempt apart from a dead intent", async () => {
  const { classifyIntentLiveness } = await load();
  // The distinction defect 1 turned on: both were 'failed' to the confirmation
  // classifier, and treating them alike is what stranded the retry.
  assert.equal(classifyIntentLiveness("requires_payment_method"), "IN_FLIGHT");
  assert.equal(classifyIntentLiveness("canceled"), "DEAD");
  assert.equal(classifyIntentLiveness("succeeded"), "SETTLED");
  // `processing` is its own outcome, and blocks. The bank is confirming a charge the
  // buyer already authorised, so handing that intent back to a card form invites a
  // second attempt on top of money that is very likely already moving.
  assert.equal(classifyIntentLiveness("processing"), "SETTLING");
  assert.equal(classifyIntentLiveness("requires_action"), "IN_FLIGHT");
  assert.equal(classifyIntentLiveness("requires_capture"), "IN_FLIGHT");
  assert.equal(classifyIntentLiveness("something_stripe_added_later"), "UNKNOWN");
  assert.equal(classifyIntentLiveness(null), "UNKNOWN");
});
