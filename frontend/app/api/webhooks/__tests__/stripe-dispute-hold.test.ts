// PAY-38b / PAY-84 / §5d / §26 — dispute and refund place fulfilment on hold, stop all
// unsent outreach, and tell Finance; a dispute the platform WINS lifts the hold, and one
// it LOSES does not.
//
// WHAT THIS PINS, and why each half matters:
//
//   • `charge.dispute.created` used to write an `AdminAuditLog` row and nothing else —
//     best-effort, with a swallowed catch. No deposit status changed, no outreach was
//     stopped, no exception was raised, and sourcing carried on spending money on a
//     charge the buyer was contesting. That audit row is still written; it is no longer
//     the whole response.
//   • `charge.dispute.closed` did not exist at all. Without it `created` is a one-way
//     door: every disputed deposit would sit at DISPUTED for ever, its Finance exception
//     open and its buyer told "your payment is under review" — including for the
//     disputes the platform wins, which are most of them.
//
// The queue is NOT mocked. `raiseException` and `resolve` run for real against an
// in-memory `queue_items` table, so the idempotency key and the compare-and-swap on
// resolution are exercised rather than asserted about.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/webhooks/__tests__/stripe-dispute-hold.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type Status = "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "DISPUTED";

interface DepositRow {
  id: string;
  buyerId: string;
  vehicleRequestId: string | null;
  stripePaymentIntentId: string | null;
  status: Status;
  amountCents: number;
  disputedAt: Date | null;
  holdReason: string | null;
  holdReleasedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
}

interface QueueRow {
  id: string;
  status: "OPEN" | "ASSIGNED" | "ESCALATED" | "RESOLVED" | "CLOSED";
  exceptionCode: string | null;
  ownerRole: string | null;
  depositId: string | null;
  buyerId: string | null;
  vehicleRequestId: string | null;
  idempotencyKey: string | null;
  requiredAction: string | null;
  buyerVisibleStatus: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  deadlineAt: Date | null;
  returnPoint: string | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Db {
  events: Array<{ eventId: string; eventType: string; processed: boolean }>;
  deposits: DepositRow[];
  queue: QueueRow[];
  notifications: Array<{ buyerId: string; title: string }>;
  audits: Array<{ action: string; entityId: string }>;
  /** Buyer plan, so PAY-84's "never a silent downgrade" is observable. */
  plans: Record<string, string>;
}

let db: Db;
let touchCancels: Array<{ buyerId: string; reason?: string }>;
let outboxCancels: Array<{ key: string; reason: string }>;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === "OR") {
      const clauses = v as Array<Record<string, unknown>>;
      if (!clauses.some((c) => matches(row, c))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && "in" in (v as object)) {
      if (!(v as { in: unknown[] }).in.includes(row[k])) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && "not" in (v as object)) {
      if (row[k] === (v as { not: unknown }).not) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function client() {
  return {
    paymentProviderEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        db.events.find((e) => e.eventId === where.eventId) ?? null,
      create: async ({ data }: { data: { eventId: string; eventType: string } }) => {
        if (db.events.some((e) => e.eventId === data.eventId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        db.events.push({ eventId: data.eventId, eventType: data.eventType, processed: false });
        return data;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { processed: boolean } }) => {
        const hits = db.events.filter((e) => matches(e as unknown as Record<string, unknown>, where));
        hits.forEach((e) => { e.processed = data.processed; });
        return { count: hits.length };
      },
    },
    deposit: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.deposits.find((d) => matches(d as unknown as Record<string, unknown>, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<DepositRow> }) => {
        const hits = db.deposits.filter((d) => matches(d as unknown as Record<string, unknown>, where));
        hits.forEach((d) => Object.assign(d, data));
        return { count: hits.length };
      },
    },
    queueItem: {
      create: async ({ data }: { data: QueueRow }) => {
        if (data.idempotencyKey && db.queue.some((q) => q.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        db.queue.push({ ...data });
        return data;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.queue.find((q) => matches(q as unknown as Record<string, unknown>, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.queue.find((q) => q.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<QueueRow> }) => {
        const hits = db.queue.filter((q) => matches(q as unknown as Record<string, unknown>, where));
        hits.forEach((q) => Object.assign(q, data));
        return { count: hits.length };
      },
    },
    notification: {
      create: async ({ data }: { data: { buyerId: string; title: string } }) => {
        db.notifications.push({ buyerId: data.buyerId, title: data.title });
        return data;
      },
    },
    adminAuditLog: {
      create: async ({ data }: { data: { action: string; entityId: string } }) => {
        db.audits.push({ action: data.action, entityId: data.entityId });
        return data;
      },
    },
    buyer: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id, firstName: "Cass", plan: db.plans[where.id] ?? "STANDARD",
        user: { email: "c@example.com" },
      }),
    },
    deal: { findFirst: async () => null },
    vehicleRequest: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
  };
}

const prismaMock: Record<string, unknown> = {
  ...client(),
  $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client()),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });
mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      webhooks: { constructEvent: (body: string) => JSON.parse(body) },
      charges: { retrieve: async () => ({ id: "ch_1", payment_intent: "pi_1" }) },
    }),
  },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
});

// The two cancellation rails. Both are recorded rather than executed: one writes to
// Supabase and one to `comms_outbox`, and what this file is proving is that BOTH are
// reached — missing either would let a message go out under a contested charge.
mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    cancelDepositReminderTouches: async (buyerId: string, opts: { reason?: string } = {}) => {
      touchCancels.push({ buyerId, reason: opts.reason });
      return { canceled: 2, status: "OK" };
    },
  },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    cancelByKey: async (key: string, reason: string) => {
      outboxCancels.push({ key, reason });
      return { cancelled: 3 };
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
  namedExports: { processFeeCommission: async () => {}, reverseCommissionsForPaymentIntent: async () => ({ reversed: 0, paidNeedingReview: [] }) },
});
mock.module("@/lib/services/auction/auction.service", { namedExports: { launchAuction: async () => {} } });
mock.module("@/lib/services/auction/dealer-invitation.service", { namedExports: { inviteDealersToAuction: async () => {} } });
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => {} } });
mock.module("@/lib/services/deal/service-fee.service", { namedExports: { writeServiceFeePayment: async () => {} } });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/analytics/content-attribution.server", { namedExports: { markContentConversion: async () => {} } });
mock.module("@/lib/services/crm/lifecycle-scheduler", { namedExports: { scheduleLifecycleWorkload: async () => {} } });
mock.module("@/lib/services/offer/outside-dealer", { namedExports: { getOrCreateOutsideDealerId: async () => "od_1" } });
mock.module("@/lib/services/concierge/concierge-conversion.service", {
  namedExports: { convertConciergeOfferToClosedAuction: async () => ({ auctionId: "a1", vehicleRequestId: "vr_1", offerIds: [], reused: true, skipped: 0 }) },
});
mock.module("@/lib/services/monitoring/webhook-delivery-log.service", {
  namedExports: { recordWebhookRejection: async () => {} },
});

async function deliver(eventId: string, type: string, object: Record<string, unknown>) {
  const mod = await import("../stripe/route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: JSON.stringify({ id: eventId, type, data: { object } }),
  });
  return mod.POST(req);
}

const DISPUTE = (over: Record<string, unknown> = {}) => ({
  id: "dp_1", charge: "ch_1", amount: 9900, reason: "fraudulent", status: "warning_needs_response",
  evidence_details: { due_by: 1780000000 }, ...over,
});

function deposit(): DepositRow {
  return db.deposits[0]!;
}
function exceptions(code: string): QueueRow[] {
  return db.queue.filter((q) => q.exceptionCode === code);
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  db = {
    events: [],
    queue: [],
    notifications: [],
    audits: [],
    plans: { buyer_1: "PREMIUM" },
    deposits: [{
      id: "dep_1", buyerId: "buyer_1", vehicleRequestId: "vr_1", stripePaymentIntentId: "pi_1",
      status: "PAID", amountCents: 9900, disputedAt: null, holdReason: null,
      holdReleasedAt: null, refundedAt: null, refundReason: null,
    }],
  };
  touchCancels = [];
  outboxCancels = [];
});

// ── charge.dispute.created — the hold goes on ────────────────────────────────

test("a dispute holds fulfilment: DISPUTED, both rails stopped, Finance told", async () => {
  const res = await deliver("evt_1", "charge.dispute.created", DISPUTE());
  assert.equal(res.status, 200);

  assert.equal(deposit().status, "DISPUTED", "the label Phase 3's one migration exists for");
  assert.ok(deposit().disputedAt, "disputed_at is the stored half of the derived hold predicate");
  assert.ok(deposit().holdReason?.includes("dp_1"), "the hold names the provider reference");
  assert.equal(deposit().holdReleasedAt, null, "a hold that is released the moment it is applied is not a hold");

  assert.deepEqual(touchCancels.map((t) => t.buyerId), ["buyer_1"], "the six-touch series must stop");
  assert.deepEqual(outboxCancels.map((o) => o.key), ["deposit_reminder:vr_1"], "the outbox rail must stop too");

  const raised = exceptions("PAYMENT_DISPUTED_OR_REFUNDED");
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.idempotencyKey, "PAYMENT_DISPUTED_OR_REFUNDED:dp_1");
  assert.equal(raised[0]!.depositId, "dep_1");
  assert.equal(raised[0]!.status, "OPEN");

  assert.ok(db.audits.some((a) => a.action === "STRIPE_DISPUTE_CREATED"), "the pre-Phase-3 audit row is preserved");
});

test("a Stripe redelivery collapses onto one exception and one hold", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  const stampedAt = deposit().disputedAt;
  await deliver("evt_2", "charge.dispute.created", DISPUTE());

  assert.equal(exceptions("PAYMENT_DISPUTED_OR_REFUNDED").length, 1, "dedup is on a real unique index, not a title string");
  assert.equal(deposit().status, "DISPUTED");
  assert.deepEqual(deposit().disputedAt, stampedAt, "the second delivery must not re-stamp the hold");
});

test("the matrix refuses to drag a REFUNDED deposit into DISPUTED", async () => {
  deposit().status = "REFUNDED";
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  assert.equal(deposit().status, "REFUNDED", "DISPUTE_FROM is PENDING|PAID — REFUNDED is not in it");
});

test("a dispute against a PaymentIntent no deposit carries raises the unroutable exception", async () => {
  deposit().stripePaymentIntentId = "pi_other";
  await deliver("evt_1", "charge.dispute.created", DISPUTE());

  assert.equal(exceptions("PAYMENT_UNROUTABLE").length, 1, "money clawed back from an obligation we cannot name is never absorbed");
  assert.equal(exceptions("PAYMENT_DISPUTED_OR_REFUNDED").length, 0);
  assert.equal(deposit().status, "PAID", "an unrelated deposit must not be touched");
});

// ── charge.dispute.closed — won ──────────────────────────────────────────────

test("a dispute WON lifts the hold and closes its Finance exception", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  const res = await deliver("evt_2", "charge.dispute.closed", DISPUTE({ status: "won" }));
  assert.equal(res.status, 200);

  assert.equal(deposit().status, "PAID", "the charge stands");
  assert.ok(deposit().holdReleasedAt, "hold_released_at is what makes the derived predicate read 'not on hold'");
  assert.ok(deposit().disputedAt, "disputed_at is LEFT SET — clearing it would erase that a dispute ever happened");

  const raised = exceptions("PAYMENT_DISPUTED_OR_REFUNDED");
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.status, "RESOLVED", "otherwise the buyer is told 'payment under review' until someone notices");
  assert.equal(raised[0]!.resolvedBy, "stripe-webhook");
  assert.ok(raised[0]!.resolution?.includes("dp_1"));
});

test("winning does NOT restart the cancelled outreach", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  touchCancels = [];
  outboxCancels = [];
  await deliver("evt_2", "charge.dispute.closed", DISPUTE({ status: "won" }));

  assert.equal(db.notifications.length, 0, "re-enrolling a buyer after weeks of silence is a decision for a person");
  assert.deepEqual(touchCancels, []);
  assert.deepEqual(outboxCancels, []);
});

test("a human who already worked the exception keeps it — the webhook does not overwrite them", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  const item = exceptions("PAYMENT_DISPUTED_OR_REFUNDED")[0]!;
  Object.assign(item, { status: "CLOSED", resolvedBy: "admin_7", resolution: "handled by hand" });

  await deliver("evt_2", "charge.dispute.closed", DISPUTE({ status: "won" }));
  assert.equal(item.resolvedBy, "admin_7", "resolve() is a compare-and-swap over OPEN statuses only");
  assert.equal(deposit().status, "PAID", "the deposit is still released — the two are independent");
});

// ── charge.dispute.closed — lost ─────────────────────────────────────────────

test("a dispute LOST refunds the deposit and the hold STAYS ON", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  const res = await deliver("evt_2", "charge.dispute.closed", DISPUTE({ status: "lost" }));
  assert.equal(res.status, 200);

  assert.equal(deposit().status, "REFUNDED", "the money went back to the cardholder");
  assert.ok(deposit().refundedAt);
  assert.equal(
    deposit().holdReleasedAt,
    null,
    "there is no settled $99 behind this request any more, so nothing costly may run for it",
  );
  assert.ok(deposit().holdReason?.includes("chargeback"));
  assert.equal(
    deposit().refundReason,
    null,
    "RefundReason is NO_OFFERS|BUYER_REQUEST|FRAUD|ADMIN_DECISION — none of them means chargeback, and " +
      "writing FRAUD would assert an investigation nobody performed",
  );

  const lost = db.queue.filter((q) => q.idempotencyKey === "PAYMENT_DISPUTED_OR_REFUNDED:dp_1:lost");
  assert.equal(lost.length, 1, "a distinct fact from 'a dispute was opened', so a distinct row");
  assert.equal(lost[0]!.status, "OPEN");
});

// PAY-84 — "$99 charged back after Premium settled → Finance exception; entitlement
// holds; never silent downgrade."
test("PAY-84: a lost dispute never downgrades the plan", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  await deliver("evt_2", "charge.dispute.closed", DISPUTE({ status: "lost" }));

  assert.equal(db.plans.buyer_1, "PREMIUM", "entitlement holds — a person decides whether it changes");
  assert.ok(
    db.queue.some((q) => q.idempotencyKey?.endsWith(":lost")),
    "the exception is how a person is asked to decide",
  );
});

// ── charge.dispute.closed — no ruling ────────────────────────────────────────

test("warning_closed rules on nothing: the hold and the exception both stand", async () => {
  await deliver("evt_1", "charge.dispute.created", DISPUTE());
  await deliver("evt_2", "charge.dispute.closed", DISPUTE({ status: "warning_closed" }));

  assert.equal(deposit().status, "DISPUTED", "an outcome we do not recognise is not an outcome");
  assert.equal(deposit().holdReleasedAt, null);
  assert.equal(exceptions("PAYMENT_DISPUTED_OR_REFUNDED")[0]!.status, "OPEN", "a human stays in the loop");
});

// ── charge.refunded — §5d treats a refund the same way ───────────────────────

test("a refund also holds fulfilment and stops both rails", async () => {
  const res = await deliver("evt_1", "charge.refunded", {
    id: "ch_1", payment_intent: "pi_1", amount_refunded: 9900, refunds: { data: [{ reason: "requested_by_customer" }] },
  });
  assert.equal(res.status, 200);

  assert.equal(deposit().status, "REFUNDED");
  assert.ok(deposit().disputedAt, "§5d puts a refund on hold on the same clause as a dispute");
  assert.deepEqual(touchCancels.map((t) => t.buyerId), ["buyer_1"]);
  assert.deepEqual(outboxCancels.map((o) => o.key), ["deposit_reminder:vr_1"]);
  assert.equal(exceptions("PAYMENT_DISPUTED_OR_REFUNDED").length, 1);
});

test("a refund that changes nothing raises nothing — the hold follows the money, not the event", async () => {
  deposit().status = "FAILED"; // not in REFUND_FROM
  await deliver("evt_1", "charge.refunded", {
    id: "ch_1", payment_intent: "pi_1", amount_refunded: 9900, refunds: { data: [] },
  });

  assert.equal(deposit().status, "FAILED");
  assert.deepEqual(touchCancels, [], "a redelivery must not re-cancel");
  assert.equal(exceptions("PAYMENT_DISPUTED_OR_REFUNDED").length, 0);
});
