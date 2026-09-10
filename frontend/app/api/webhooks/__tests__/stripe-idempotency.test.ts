// Idempotency & atomicity contract tests for POST /api/webhooks/stripe
// (Phase 0.5-3 — owner directive: unique event.id, check-and-insert
// transactionally in the same tx as the side-effect, safe under replay AND
// out-of-order delivery).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "app/api/webhooks/__tests__/stripe-idempotency.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// ── In-memory DB with transactional (snapshot/rollback) semantics ────────────
type EventRow = { eventId: string; eventType: string; processed: boolean };
type DepositRow = {
  id: string; buyerId: string; stripePaymentIntentId: string | null;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "DISPUTED";
};
type AuctionRow = { id: string; buyerId: string; depositId: string; status: string };

interface Db {
  events: EventRow[];
  deposits: DepositRow[];
  auctions: AuctionRow[];
  notifications: Array<{ buyerId: string; title: string }>;
}

let db: Db;
let failAuctionCreate = false;

function makeClient(state: Db) {
  return {
    paymentProviderEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        state.events.find((e) => e.eventId === where.eventId) ?? null,
      create: async ({ data }: { data: EventRow }) => {
        if (state.events.some((e) => e.eventId === data.eventId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
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
    deposit: {
      updateMany: async ({ where, data }: {
        where: { id?: string; stripePaymentIntentId?: string | null; status?: string | { not?: string; in?: string[] } };
        data: Partial<DepositRow>;
      }) => {
        const hits = state.deposits.filter((d) => {
          if (where.id !== undefined && d.id !== where.id) return false;
          if (where.stripePaymentIntentId !== undefined && d.stripePaymentIntentId !== where.stripePaymentIntentId) return false;
          if (typeof where.status === "string" && d.status !== where.status) return false;
          if (where.status && typeof where.status === "object") {
            if (where.status.not !== undefined && d.status === where.status.not) return false;
            if (where.status.in !== undefined && !where.status.in.includes(d.status)) return false;
          }
          return true;
        });
        hits.forEach((d) => Object.assign(d, data));
        return { count: hits.length };
      },
      findFirst: async ({ where }: { where: { stripePaymentIntentId: string } }) => {
        const d = state.deposits.find((x) => x.stripePaymentIntentId === where.stripePaymentIntentId);
        return d
          ? { ...d, amountCents: 9900, buyer: { firstName: "Test", phone: null, lastName: "B", user: { email: "b@x.com" } } }
          : null;
      },
    },
    auction: {
      findUnique: async ({ where }: { where: { depositId: string } }) =>
        state.auctions.find((a) => a.depositId === where.depositId) ?? null,
      create: async ({ data }: { data: { buyerId: string; depositId: string; status: string } }) => {
        if (failAuctionCreate) throw new Error("simulated auction-create failure");
        const row = { id: `auc_${state.auctions.length + 1}`, ...data };
        state.auctions.push(row);
        return row;
      },
    },
    notification: {
      create: async ({ data }: { data: { buyerId: string; title: string } }) => {
        state.notifications.push({ buyerId: data.buyerId, title: data.title });
        return data;
      },
    },
  };
}

const prismaMock = {
  ...makeClient(undefined as unknown as Db),
  $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    // Snapshot/rollback semantics: mutations apply to a deep copy; commit
    // replaces the live db only if the callback resolves.
    const snapshot: Db = JSON.parse(JSON.stringify(db));
    try {
      const result = await cb(makeClient(snapshot));
      db = snapshot;
      return result;
    } catch (err) {
      throw err; // discard snapshot — rollback
    }
  },
};
// Root client operations act on the live db.
Object.assign(prismaMock, makeClient(new Proxy({} as Db, {
  get: (_t, prop) => (db as unknown as Record<string | symbol, unknown>)[prop],
})));

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });
mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      webhooks: { constructEvent: (body: string) => JSON.parse(body) },
      charges: { retrieve: async () => ({ payment_intent: "pi_x" }) },
    }),
  },
});
// Phase 3: settlement now attaches the deposit to its Vehicle Request, unlocks it and
// opens the sourcing case inside the money transaction. That has its own suite; this
// file is about idempotency and the transaction boundary, so the effects are mocked to
// their normal answer — including `runLegacyAuctionPath: true`, which is what the
// SOURCING_CASE_REPLACES_AUCTION_LAUNCH default means and is why the auction assertions
// below still hold.
mock.module("@/lib/services/payment/settlement-effects.service", {
  namedExports: {
    applySettlementEffects: async () => ({
      vehicleRequestId: "vr_1",
      sourcingCaseId: "case_1",
      unlocked: true,
      runLegacyAuctionPath: true,
    }),
  },
});
mock.module("@/lib/services/comms/legacy-path-write", {
  namedExports: { recordLegacyPathWrite: async () => {} },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
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
  namedExports: { walkCommissionTree: async () => {} },
});
let launches = 0;
mock.module("@/lib/services/auction/auction.service", {
  namedExports: { launchAuction: async () => { launches += 1; } },
});
let invites = 0;
mock.module("@/lib/services/auction/dealer-invitation.service", {
  namedExports: { inviteDealersToAuction: async () => { invites += 1; } },
});
mock.module("@/lib/services/deal/deal.service", {
  namedExports: { advanceDealStatus: async () => {} },
});
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/qstash/dispatch", { namedExports: { dispatch: async () => {} } });
let reminderCancels = 0;
mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: { cancelDepositReminderTouches: async () => { reminderCancels += 1; return { canceled: 0, status: "OK" }; } },
});
mock.module("@/lib/analytics/content-attribution.server", {
  namedExports: { markContentConversion: async () => {} },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
mock.module("@/lib/constants", { namedExports: { PREMIUM_FEE_REMAINING_CENTS: 40000 } });

async function deliver(eventId: string, type: string, object: Record<string, unknown>) {
  const mod = await import("../stripe/route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: JSON.stringify({ id: eventId, type, data: { object } }),
  });
  return mod.POST(req);
}

const DEPOSIT_SUCCEEDED = {
  id: "pi_1",
  metadata: { type: "deposit", buyerId: "buyer_1" },
};

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  db = {
    events: [],
    deposits: [{ id: "dep_1", buyerId: "buyer_1", stripePaymentIntentId: "pi_1", status: "PENDING" }],
    auctions: [],
    notifications: [],
  };
  failAuctionCreate = false;
  launches = 0;
  reminderCancels = 0;
  invites = 0;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("fresh deposit success: marks PAID, creates auction, claims event, launches", async () => {
  const res = await deliver("evt_1", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);
  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "PAID");
  assert.equal(db.auctions.length, 1);
  assert.equal(db.notifications.length, 1);
  assert.equal(db.events[0].processed, true);
  assert.equal(launches, 1);
  assert.equal(reminderCancels, 1, "paid → remaining $99 reminders suppressed (Section 6)");
});

test("replay of a processed event is a duplicate ack with zero side effects", async () => {
  await deliver("evt_1", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);
  const before = JSON.stringify(db);
  const res2 = await deliver("evt_1", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);
  const json = (await res2.json()) as { duplicate?: boolean };
  assert.equal(res2.status, 200);
  assert.equal(json.duplicate, true);
  assert.equal(JSON.stringify(db), before, "no state may change on replay");
  assert.equal(launches, 1, "post-commit effects must not re-run on replay");
  assert.equal(reminderCancels, 1, "reminder suppression is not re-run on replay (exactly once)");
});

// THIS TEST USED TO ASSERT ONLY THE STATUS, and that is how the defect hid.
//
// The `updateMany` is correctly scoped by `SETTLE_FROM`, so the status was always
// right — and the code that followed read the deposit and carried on REGARDLESS of
// whether the flip had matched anything. For a deposit refunded before a late
// `payment_intent.succeeded` arrived, everything downstream still ran: the request
// unlocked, a sourcing case opened, a plan snapshot recorded 9900 cents of settled
// deposit for money that had gone back, an auction was created, dealers were invited
// and the buyer was emailed "Auction activated!". A green status assertion sat on top
// of all of it.
//
// So the assertions are the SIDE EFFECTS now, not the column.
test("out-of-order: a late success on a REFUNDED deposit changes NOTHING", async () => {
  db.deposits[0].status = "REFUNDED";
  const res = await deliver("evt_2", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);

  assert.equal(res.status, 200, "acknowledged — retrying cannot fix an out-of-order delivery");
  assert.equal(db.deposits[0].status, "REFUNDED", "REFUNDED must not become PAID");
  assert.equal(db.auctions.length, 0, "and no auction may be created for money that went back");
  assert.equal(launches, 0, "nor launched");
  assert.equal(invites, 0, "nor may a dealer be invited");
  assert.equal(db.notifications.length, 0, "and the buyer is never told their auction is active");
  assert.equal(reminderCancels, 0, "nothing downstream of the flip may run at all");
});

test("out-of-order: a late success on a DISPUTED deposit changes nothing either", async () => {
  db.deposits[0].status = "DISPUTED";
  const res = await deliver("evt_2b", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);

  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "DISPUTED", "a redelivered success must never clear a live dispute");
  assert.equal(db.auctions.length, 0, "and sourcing must not start spending against a contested charge");
  assert.equal(launches, 0);
});

test("out-of-order: late failure never downgrades a PAID deposit", async () => {
  db.deposits[0].status = "PAID";
  const res = await deliver("evt_3", "payment_intent.payment_failed", DEPOSIT_SUCCEEDED);
  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "PAID", "PAID must not become FAILED");
});

test("crash inside the money cluster rolls back the claim so Stripe retries cleanly", async () => {
  failAuctionCreate = true;
  const res = await deliver("evt_4", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);
  assert.equal(res.status, 500, "failure must surface so Stripe retries");
  assert.equal(db.events[0]?.processed ?? false, false, "claim must roll back with the failed tx");
  assert.equal(db.deposits[0].status, "PENDING", "deposit write must roll back too");
  assert.equal(db.auctions.length, 0);

  // Retry after the transient failure heals: processes fully.
  failAuctionCreate = false;
  const retry = await deliver("evt_4", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);
  assert.equal(retry.status, 200);
  assert.equal(db.deposits[0].status, "PAID");
  assert.equal(db.events[0].processed, true);
});

test("missing STRIPE_WEBHOOK_SECRET is a hard 500, not a silent empty-secret verify", async () => {
  // env.d.ts types this var as required; the runtime absence case is exactly
  // what this test simulates.
  delete (process.env as Record<string, string | undefined>).STRIPE_WEBHOOK_SECRET;
  const res = await deliver("evt_5", "payment_intent.succeeded", DEPOSIT_SUCCEEDED);
  assert.equal(res.status, 500);
  assert.equal(db.events.length, 0, "nothing may be recorded before config is fixed");
});
