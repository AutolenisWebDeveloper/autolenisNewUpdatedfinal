// Idempotency & atomicity contract for the concierge_deposit branch of
// POST /api/webhooks/stripe. A settled $99 concierge deposit must: flip the
// deposit PAID, run the conversion INSIDE the money-cluster transaction (so a
// PAID concierge deposit always has its CLOSED auction), notify the buyer once,
// be replay-safe, and roll back cleanly if conversion fails. It must NOT launch
// a live auction or invite dealers.
//
// Run: npx tsx --test --experimental-test-module-mocks "app/api/webhooks/__tests__/stripe-concierge-deposit.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type EventRow = { eventId: string; eventType: string; processed: boolean };
type DepositRow = {
  id: string; buyerId: string; stripePaymentIntentId: string | null;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED"; amountCents: number;
};

interface Db {
  events: EventRow[];
  deposits: DepositRow[];
  notifications: Array<{ buyerId: string; title: string }>;
}

let db: Db;
let convertReused = false;
let convertThrows = false;
let convertCalls: Array<Record<string, unknown>> = [];
let launches = 0;
let invites = 0;

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
        where: { stripePaymentIntentId?: string | null; status?: { in?: string[] } };
        data: Partial<DepositRow>;
      }) => {
        const hits = state.deposits.filter((d) => {
          if (where.stripePaymentIntentId !== undefined && d.stripePaymentIntentId !== where.stripePaymentIntentId) return false;
          if (where.status?.in !== undefined && !where.status.in.includes(d.status)) return false;
          return true;
        });
        hits.forEach((d) => Object.assign(d, data));
        return { count: hits.length };
      },
      findFirst: async ({ where }: { where: { stripePaymentIntentId: string } }) => {
        const d = state.deposits.find((x) => x.stripePaymentIntentId === where.stripePaymentIntentId);
        return d
          ? { ...d, buyer: { firstName: "Cass", phone: null, lastName: "A", user: { email: "c@x.com" } } }
          : null;
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
    const snapshot: Db = JSON.parse(JSON.stringify(db));
    const result = await cb(makeClient(snapshot));
    db = snapshot; // commit only if cb resolved
    return result;
  },
};
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
mock.module("@/lib/services/affiliate/commission.service", { namedExports: { walkCommissionTree: async () => {} } });
mock.module("@/lib/services/auction/auction.service", { namedExports: { launchAuction: async () => { launches += 1; } } });
mock.module("@/lib/services/auction/dealer-invitation.service", { namedExports: { inviteDealersToAuction: async () => { invites += 1; } } });
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => {} } });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/qstash/dispatch", { namedExports: { dispatch: async () => {} } });
mock.module("@/lib/analytics/content-attribution.server", { namedExports: { markContentConversion: async () => {} } });
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
mock.module("@/lib/services/offer/outside-dealer", {
  namedExports: { getOrCreateOutsideDealerId: async () => "outside_dealer_1" },
});
mock.module("@/lib/services/concierge/concierge-conversion.service", {
  namedExports: {
    convertConciergeOfferToClosedAuction: async (_tx: unknown, params: Record<string, unknown>) => {
      convertCalls.push(params);
      if (convertThrows) throw new Error("simulated conversion failure");
      return { auctionId: "auc_c1", vehicleRequestId: "vr_c1", offerIds: convertReused ? [] : ["o1", "o2"], reused: convertReused, skipped: 0 };
    },
  },
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

const CONCIERGE_PI = {
  id: "pi_c1",
  metadata: { type: "concierge_deposit", buyerId: "buyer_c", reviewToken: "rev-token-1", vehicleOfferId: "vo_1" },
};

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  db = {
    events: [],
    deposits: [{ id: "dep_c", buyerId: "buyer_c", stripePaymentIntentId: "pi_c1", status: "PENDING", amountCents: 9900 }],
    notifications: [],
  };
  convertReused = false;
  convertThrows = false;
  convertCalls = [];
  launches = 0;
  invites = 0;
});

test("fresh concierge deposit: PAID, converts, notifies, claims — no live auction launch/invite", async () => {
  const res = await deliver("evt_c1", "payment_intent.succeeded", CONCIERGE_PI);
  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "PAID");
  assert.equal(convertCalls.length, 1);
  assert.deepEqual(convertCalls[0], {
    buyerId: "buyer_c", depositId: "dep_c", reviewToken: "rev-token-1", outsideDealerId: "outside_dealer_1",
  });
  assert.equal(db.notifications.length, 1);
  assert.equal(db.notifications[0].title, "Your offers are ready");
  assert.equal(db.events[0].processed, true);
  assert.equal(launches, 0, "concierge must NOT launch a live auction");
  assert.equal(invites, 0, "concierge must NOT invite dealers");
});

test("replay is a duplicate ack with no re-conversion", async () => {
  await deliver("evt_c1", "payment_intent.succeeded", CONCIERGE_PI);
  const before = JSON.stringify(db);
  const res2 = await deliver("evt_c1", "payment_intent.succeeded", CONCIERGE_PI);
  const json = (await res2.json()) as { duplicate?: boolean };
  assert.equal(json.duplicate, true);
  assert.equal(JSON.stringify(db), before, "no state change on replay");
  assert.equal(convertCalls.length, 1, "conversion must run at most once");
});

test("conversion failure rolls back the claim + PAID flip so Stripe retries", async () => {
  convertThrows = true;
  const res = await deliver("evt_c2", "payment_intent.succeeded", CONCIERGE_PI);
  assert.equal(res.status, 500);
  assert.equal(db.deposits[0].status, "PENDING", "PAID flip must roll back with the failed conversion");
  assert.equal(db.events[0]?.processed ?? false, false, "event claim must roll back too");

  convertThrows = false;
  const retry = await deliver("evt_c2", "payment_intent.succeeded", CONCIERGE_PI);
  assert.equal(retry.status, 200);
  assert.equal(db.deposits[0].status, "PAID");
  assert.equal(db.events[0].processed, true);
});

test("reused conversion (auction already existed) does not re-notify", async () => {
  convertReused = true;
  const res = await deliver("evt_c3", "payment_intent.succeeded", CONCIERGE_PI);
  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "PAID");
  assert.equal(db.notifications.length, 0, "no duplicate 'offers ready' notice when auction already existed");
});

test("concierge deposit payment_failed flips PENDING → FAILED", async () => {
  const res = await deliver("evt_c4", "payment_intent.payment_failed", CONCIERGE_PI);
  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "FAILED");
});

test("late failure never downgrades a PAID concierge deposit", async () => {
  db.deposits[0].status = "PAID";
  const res = await deliver("evt_c5", "payment_intent.payment_failed", CONCIERGE_PI);
  assert.equal(res.status, 200);
  assert.equal(db.deposits[0].status, "PAID");
});
