// M3 — the commission walk must run for BOTH fee-resolution paths of
// payment_intent.succeeded (type concierge_fee/service_fee):
//   • primary: metadata carries dealId+buyerId (admin checkout send-link);
//   • legacy:  metadata absent, the deal is matched via stripeFeePIId (buyer
//     self-service PIs already in flight).
// Before this fix the walk was gated on `metaDealId && metaBuyerId`, so the
// legacy path recorded the fee, advanced the deal, and SILENTLY skipped
// commissions — no log, no DLQ (`routed` was already true).
//
// Run: npx tsx --test --experimental-test-module-mocks "app/api/webhooks/__tests__/stripe-fee-commission.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type DealRow = { id: string; buyerId: string; status: string; stripeFeePIId: string | null };

interface Db {
  events: Array<{ eventId: string; eventType: string; processed: boolean }>;
  deals: DealRow[];
}
let db: Db;
let feeCommissionCalls: Array<Record<string, unknown>> = [];

const prismaMock = {
  paymentProviderEvent: {
    findUnique: async ({ where }: { where: { eventId: string } }) =>
      db.events.find((e) => e.eventId === where.eventId) ?? null,
    create: async ({ data }: { data: { eventId: string; eventType: string } }) => {
      db.events.push({ eventId: data.eventId, eventType: data.eventType, processed: false });
      return data;
    },
    updateMany: async ({ where, data }: { where: { eventId: string }; data: { processed: boolean } }) => {
      const hits = db.events.filter((e) => e.eventId === where.eventId);
      hits.forEach((e) => { e.processed = data.processed; });
      return { count: hits.length };
    },
  },
  deal: {
    findFirst: async ({ where }: { where: { id?: string; stripeFeePIId?: string } }) =>
      db.deals.find((d) => (where.id ? d.id === where.id : d.stripeFeePIId === where.stripeFeePIId)) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) =>
      db.deals.find((d) => d.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<DealRow> }) => {
      const d = db.deals.find((x) => x.id === where.id);
      if (d) Object.assign(d, data);
      return d;
    },
  },
  deposit: {
    findFirst: async () => null,
    updateMany: async () => ({ count: 0 }),
  },
  buyer: {
    findUnique: async () => ({ id: "buyer_1", firstName: "Cass", user: { email: "c@x.com" } }),
  },
  notification: {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => data,
  },
  adminAuditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => data,
  },
  $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(prismaMock),
};
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
mock.module("@/lib/services/affiliate/commission.service", {
  namedExports: {
    walkCommissionTree: async () => {},
    processFeeCommission: async (params: Record<string, unknown>) => {
      feeCommissionCalls.push(params);
    },
    reverseCommissionsForPaymentIntent: async () => ({ reversed: 0, paidNeedingReview: [] }),
  },
});
mock.module("@/lib/services/auction/auction.service", { namedExports: { launchAuction: async () => {} } });
mock.module("@/lib/services/auction/dealer-invitation.service", { namedExports: { inviteDealersToAuction: async () => {} } });
mock.module("@/lib/services/deal/deal.service", { namedExports: { advanceDealStatus: async () => {} } });
mock.module("@/lib/services/deal/service-fee.service", { namedExports: { writeServiceFeePayment: async () => {} } });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/qstash/dispatch", { namedExports: { dispatch: async () => {} } });
mock.module("@/lib/analytics/content-attribution.server", { namedExports: { markContentConversion: async () => {} } });
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
mock.module("@/lib/services/offer/outside-dealer", { namedExports: { getOrCreateOutsideDealerId: async () => "od_1" } });
mock.module("@/lib/services/concierge/concierge-conversion.service", {
  namedExports: { convertConciergeOfferToClosedAuction: async () => ({ auctionId: "a", vehicleRequestId: "v", offerIds: [], reused: false, skipped: 0 }) },
});

async function deliver(eventId: string, object: Record<string, unknown>) {
  const mod = await import("../stripe/route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: JSON.stringify({ id: eventId, type: "payment_intent.succeeded", data: { object } }),
  });
  return mod.POST(req);
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  db = {
    events: [],
    deals: [{ id: "deal_1", buyerId: "buyer_1", status: "FEE_PENDING", stripeFeePIId: "pi_legacy" }],
  };
  feeCommissionCalls = [];
});

test("metadata path: walk runs with metadata ids and the actual captured basis", async () => {
  const res = await deliver("evt_meta", {
    id: "pi_meta",
    amount: 40000,
    amount_received: 40000,
    metadata: { type: "concierge_fee", dealId: "deal_1", buyerId: "buyer_1" },
  });
  assert.equal(res.status, 200);
  assert.equal(feeCommissionCalls.length, 1);
  assert.deepEqual(feeCommissionCalls[0], {
    dealId: "deal_1",
    buyerId: "buyer_1",
    qualifyingEventId: "pi_meta",
    feeBasisCents: 40000,
  });
});

test("legacy path (no metadata ids): walk still runs, ids derived from the matched deal", async () => {
  const res = await deliver("evt_legacy", {
    id: "pi_legacy",
    amount: 40000,
    amount_received: 40000,
    metadata: { type: "service_fee" },
  });
  assert.equal(res.status, 200);
  assert.equal(feeCommissionCalls.length, 1, "legacy fee path must not skip the commission walk");
  assert.deepEqual(feeCommissionCalls[0], {
    dealId: "deal_1",
    buyerId: "buyer_1",
    qualifyingEventId: "pi_legacy",
    feeBasisCents: 40000,
  });
});

test("no deal matched: no walk (unroutable alert path handles it)", async () => {
  const res = await deliver("evt_none", {
    id: "pi_unknown",
    amount: 40000,
    amount_received: 40000,
    metadata: { type: "service_fee" },
  });
  assert.equal(res.status, 200);
  assert.equal(feeCommissionCalls.length, 0);
});
