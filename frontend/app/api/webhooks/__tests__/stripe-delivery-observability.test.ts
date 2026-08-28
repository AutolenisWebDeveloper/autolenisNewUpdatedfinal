// Delivery-observability contract for POST /api/webhooks/stripe.
//
// A webhook that is not delivering, or that is accepted and then silently does
// nothing, is the most expensive failure this endpoint has: money moves at the
// provider and the platform never learns. These tests lock the two app-side
// behaviours that make each state legible instead of silent:
//
//   1. Misconfiguration is a LOGGED, deliberate response — never an unhandled
//      throw. A missing STRIPE_SECRET_KEY must produce the same explicit 500 as
//      a missing STRIPE_WEBHOOK_SECRET, so Stripe keeps retrying and the app log
//      names the missing variable.
//   2. A signature-valid payment_intent.succeeded whose metadata matches no
//      branch must NOT be acknowledged as if it were handled. It is a real
//      payment the platform cannot route — it raises an operational exception.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/webhooks/__tests__/stripe-delivery-observability.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const state = {
  stripeThrows: false,
  events: [] as Array<{ eventId: string; eventType: string; processed: boolean }>,
  notifications: [] as Array<Record<string, unknown>>,
  errors: [] as string[],
  existingAlertTitles: new Set<string>(),
  /** PaymentIntent id → the Deposit row the money-cluster should resolve, if any. */
  depositsByPi: {} as Record<string, Record<string, unknown>>,
  /** Rows the delivery-rejection log persisted for this delivery. */
  webhookRows: [] as Array<{ source: string; eventType: string; payload: Record<string, unknown> }>,
};

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => {
      if (state.stripeThrows) {
        throw new Error("[stripe] STRIPE_SECRET_KEY is not set. Add it to your environment variables.");
      }
      return {
        webhooks: { constructEvent: (body: string) => JSON.parse(body) },
        charges: { retrieve: async () => ({ payment_intent: "pi_x" }) },
      };
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      paymentProviderEvent: {
        findUnique: async ({ where }: { where: { eventId: string } }) =>
          state.events.find((e) => e.eventId === where.eventId) ?? null,
        create: async ({ data }: { data: { eventId: string; eventType: string } }) => {
          state.events.push({ eventId: data.eventId, eventType: data.eventType, processed: false });
          return data;
        },
        updateMany: async ({ where, data }: {
          where: { eventId: string; processed?: boolean };
          data: { processed: boolean };
        }) => {
          const hits = state.events.filter(
            (e) => e.eventId === where.eventId && (where.processed === undefined || e.processed === where.processed),
          );
          hits.forEach((e) => { e.processed = data.processed; });
          return { count: hits.length };
        },
      },
      notification: {
        findFirst: async ({ where }: { where: { title?: string } }) =>
          where.title && state.existingAlertTitles.has(where.title) ? { id: "existing" } : null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.notifications.push(data);
          return { id: "n1" };
        },
      },
      webhookEvent: {
        findFirst: async () => null, // never throttled within a single test
        create: async ({ data }: { data: { source: string; eventType: string; payload: Record<string, unknown> } }) => {
          state.webhookRows.push({ source: data.source, eventType: data.eventType, payload: data.payload });
          return data;
        },
      },
      deposit: { updateMany: async () => ({ count: 0 }), findFirst: async () => null },
      deal: { findFirst: async () => null, findUnique: async () => null },
      auction: { findUnique: async () => null, create: async () => ({ id: "auc" }) },
      buyer: { findUnique: async () => null },
      adminAuditLog: { create: async () => ({}) },
      // Minimal transactional client: the event claim succeeds, and no Deposit
      // row matches the PaymentIntent — the "branch matched, target missing"
      // shape this suite exercises.
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          paymentProviderEvent: {
            updateMany: async ({ where, data }: {
              where: { eventId: string; processed?: boolean };
              data: { processed: boolean };
            }) => {
              const hits = state.events.filter(
                (e) => e.eventId === where.eventId && (where.processed === undefined || e.processed === where.processed),
              );
              hits.forEach((e) => { e.processed = data.processed; });
              return { count: hits.length };
            },
          },
          deposit: {
            updateMany: async () => ({ count: 0 }),
            findFirst: async ({ where }: { where: { stripePaymentIntentId: string } }) =>
              state.depositsByPi[where.stripePaymentIntentId] ?? null,
          },
          auction: { findUnique: async () => null, create: async () => ({ id: "auc" }) },
          notification: { create: async () => ({ id: "n" }) },
        }),
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => {}, info: () => {}, warn: () => {},
      error: (msg: unknown) => { state.errors.push(String(msg)); },
    },
  },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDepositConfirmationEmail: async () => {},
    sendAuctionActivatedEmail: async () => {},
    sendConciergeFeeConfirmationEmail: async () => {},
    sendRefundConfirmationEmail: async () => {},
  },
});
mock.module("@/lib/services/affiliate/commission.service", {
  namedExports: { processFeeCommission: async () => {}, walkCommissionTree: async () => {} },
});
mock.module("@/lib/services/auction/auction.service", { namedExports: { launchAuction: async () => {} } });
mock.module("@/lib/services/auction/dealer-invitation.service", { namedExports: { inviteDealersToAuction: async () => 0 } });
mock.module("@/lib/services/offer/outside-dealer", { namedExports: { getOrCreateOutsideDealerId: async () => "d_out" } });
mock.module("@/lib/services/concierge/concierge-conversion.service", {
  namedExports: { convertConciergeOfferToClosedAuction: async () => ({ auctionId: "a1", offerIds: [], reused: false }) },
});
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => {} } });
mock.module("@/lib/services/deal/service-fee.service", { namedExports: { writeServiceFeePayment: async () => {} } });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/services/crm/lifecycle-scheduler", { namedExports: { scheduleLifecycleWorkload: async () => {} } });
mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: { cancelDepositReminderTouches: async () => ({ canceled: 0, status: "OK" }) },
});
mock.module("@/lib/analytics/content-attribution.server", { namedExports: { markContentConversion: async () => {} } });
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });

async function deliver(eventId: string, type: string, object: Record<string, unknown>) {
  const mod = await import("../stripe/route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: JSON.stringify({ id: eventId, type, data: { object } }),
  });
  return mod.POST(req);
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  state.stripeThrows = false;
  state.events = [];
  state.notifications = [];
  state.errors = [];
  state.existingAlertTitles = new Set<string>();
  state.depositsByPi = {};
  state.webhookRows = [];
});

// ── 1. Misconfiguration is deliberate and logged, never an unhandled throw ────

test("a missing STRIPE_SECRET_KEY returns a logged 500, not an unhandled exception", async () => {
  state.stripeThrows = true;
  const res = await deliver("evt_cfg", "payment_intent.succeeded", { id: "pi_1", metadata: { type: "deposit" } });
  assert.equal(res.status, 500, "500 keeps Stripe retrying while ops fixes the env");
  assert.ok(
    state.errors.some((e) => /STRIPE_SECRET_KEY/.test(e)),
    "the log must name the missing variable so the delivery log can be matched to a cause",
  );
  assert.equal(state.events.length, 0, "nothing is claimed when the handler cannot run");
});

test("a missing STRIPE_WEBHOOK_SECRET still returns a logged 500", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = ""; // falsy — same path as unset
  const res = await deliver("evt_cfg2", "payment_intent.succeeded", { id: "pi_1", metadata: { type: "deposit" } });
  assert.equal(res.status, 500);
  assert.ok(state.errors.some((e) => /STRIPE_WEBHOOK_SECRET/.test(e)));
});

// ── 2. An accepted-but-unroutable payment is never a silent success ───────────

test("payment_intent.succeeded with no recognised metadata type raises an operational exception", async () => {
  const res = await deliver("evt_orphan", "payment_intent.succeeded", {
    id: "pi_orphan",
    amount: 9900,
    metadata: {},
  });
  assert.equal(res.status, 200, "Stripe is still acknowledged — retrying cannot fix bad metadata");

  const alert = state.notifications.find((n) => n.type === "SYSTEM_ALERT");
  assert.ok(alert, "an unroutable payment must surface as an operational exception");
  assert.equal(alert!.buyerId, undefined, "ops-only");
  assert.match(String(alert!.title), /pi_orphan/);
  assert.ok(
    state.errors.some((e) => /pi_orphan/.test(e)),
    "and must be logged, not swallowed",
  );
});

test("an unknown metadata type is treated the same as an absent one", async () => {
  await deliver("evt_weird", "payment_intent.succeeded", {
    id: "pi_weird",
    amount: 9900,
    metadata: { type: "not_a_real_type", buyerId: "b1" },
  });
  assert.ok(state.notifications.some((n) => n.type === "SYSTEM_ALERT"));
});

test("the unroutable-payment exception is deduped per payment intent", async () => {
  state.existingAlertTitles = new Set([
    "Unroutable Stripe payment — no platform effect: pi_dup",
  ]);
  await deliver("evt_dup", "payment_intent.succeeded", { id: "pi_dup", amount: 9900, metadata: {} });
  assert.equal(state.notifications.length, 0, "no duplicate alert for a payment already surfaced");
});

test("a recognised deposit payment raises no unroutable exception", async () => {
  state.depositsByPi["pi_ok"] = {
    id: "dep_ok",
    buyerId: "b1",
    amountCents: 9900,
    buyer: { firstName: "Sam", lastName: "B", phone: null, user: { email: "b@x.com" } },
  };
  await deliver("evt_ok", "payment_intent.succeeded", {
    id: "pi_ok",
    amount: 9900,
    metadata: { type: "deposit", buyerId: "b1" },
  });
  assert.equal(
    state.notifications.filter((n) => String(n.title ?? "").startsWith("Unroutable")).length,
    0,
  );
});

test("a recognised type whose target record is missing is ALSO surfaced, not acked into silence", async () => {
  // metadata.type is "deposit" — a branch matches — but no Deposit row exists for
  // this PaymentIntent, so the branch resolves nothing and changes nothing. Before
  // this check that was a bare 200 with no log and no alert.
  const res = await deliver("evt_nodep", "payment_intent.succeeded", {
    id: "pi_nodeposit",
    amount: 9900,
    metadata: { type: "deposit", buyerId: "b1" },
  });
  assert.equal(res.status, 200);
  const alert = state.notifications.find((n) => n.type === "SYSTEM_ALERT");
  assert.ok(alert, "a real charge with no matching deposit must surface");
  assert.match(String(alert!.title), /pi_nodeposit/);
  assert.match(String(alert!.body), /no matching record was found/);
});

test("non-payment_intent event types are unaffected by the unroutable check", async () => {
  const res = await deliver("evt_refund", "charge.refunded", { id: "ch_1", payment_intent: "pi_r", amount_refunded: 9900 });
  assert.equal(res.status, 200);
  assert.equal(
    state.notifications.filter((n) => String(n.title ?? "").startsWith("Unroutable")).length,
    0,
  );
});

// ── 3. A REJECTED delivery is persisted, not just logged ─────────────────────
//
// The app log is not queryable from the platform, and Vercel log retention is
// short. Without a row, "Stripe never called us" and "Stripe called and we
// rejected every one" are the same observation — with different fixes.

test("an invalid signature is recorded, not silently 400'd", async () => {
  const mod = await import("../stripe/route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=bogus" },
    body: "not-json-so-verification-throws",
  });
  const res = await mod.POST(req);

  assert.equal(res.status, 400);
  const row = state.webhookRows.find((r) => r.eventType === "rejected.signature_invalid");
  assert.ok(row, "this branch used to be entirely silent — no log, no row");
  assert.equal(row!.source, "stripe");
  assert.equal(row!.payload.hasSignatureHeader, true);
  assert.equal(row!.payload.bodyBytes, "not-json-so-verification-throws".length);
  assert.ok(
    state.errors.some((e) => /signature verification FAILED/i.test(e)),
    "and it must name the likely cause in the log too",
  );
});

test("the recorded rejection never contains the unverified body", async () => {
  const secret = "SENSITIVE-CARDHOLDER-PAYLOAD";
  const mod = await import("../stripe/route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=bogus" },
    body: secret,
  });
  await mod.POST(req);

  const row = state.webhookRows.find((r) => r.eventType === "rejected.signature_invalid");
  assert.ok(row);
  assert.ok(
    !JSON.stringify(row).includes(secret),
    "an unverified body may be hostile or carry PII — only its size may be persisted",
  );
});

test("a missing STRIPE_SECRET_KEY is recorded as its own diagnosis", async () => {
  state.stripeThrows = true;
  await deliver("evt_cfg3", "payment_intent.succeeded", { id: "pi_1", metadata: { type: "deposit" } });

  const row = state.webhookRows.find((r) => r.eventType === "rejected.provider_client_unavailable");
  assert.ok(row, "a 500 before verification must be distinguishable from a 400 after it");
});

test("a missing STRIPE_WEBHOOK_SECRET is recorded as its own diagnosis", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "";
  await deliver("evt_cfg4", "payment_intent.succeeded", { id: "pi_1", metadata: { type: "deposit" } });

  const row = state.webhookRows.find((r) => r.eventType === "rejected.webhook_secret_missing");
  assert.ok(row, "the three rejection causes have three different fixes");
});

test("an ACCEPTED delivery writes no rejection row — no duplicate ledger", async () => {
  const res = await deliver("evt_ok", "payment_intent.succeeded", {
    id: "pi_ok",
    amount: 9900,
    metadata: { type: "deposit", buyerId: "b1" },
  });

  assert.equal(res.status, 200);
  assert.equal(
    state.webhookRows.length,
    0,
    "successful deliveries already live in payment_provider_events; recording them again would be a second ledger of one fact",
  );
});
