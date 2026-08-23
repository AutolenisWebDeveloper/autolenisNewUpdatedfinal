// The five migrated transactional senders now enqueue onto the internal
// comms-dispatch queue (comms_outbox via enqueueTransactionalEmail → enqueueEmail)
// instead of the direct resend rail, with:
//   • the SAME idempotencyKey the direct rail used — which is ALSO the outbox
//     dedup_key (EmailSendLog key parity + enqueue-once dedup),
//   • type:'transactional' (so the drain applies hard-only suppression),
//   • NO contactId (so the drain writes no contact_timeline_events row → the send
//     is recorded on exactly one plane, never double-counted),
//   • a rendered subject + html (raw-payload path).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/email/__tests__/sender-migration.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const enqueued: Array<Record<string, unknown>> = [];

mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: {
    enqueueEmail: async (payload: Record<string, unknown>) => {
      enqueued.push(payload);
      return { enqueued: true, dedupKey: String(payload.idempotencyKey ?? "") };
    },
    enqueueSms: async () => ({ enqueued: true, dedupKey: "" }),
  },
});

// resend.service imports prisma (for the non-migrated senders' sendIdempotent);
// stub it so importing the module does no real DB work.
mock.module("@/lib/prisma", { namedExports: { prisma: {} } });

async function load() {
  return import("@/lib/services/email/resend.service");
}

function lastEvent() {
  assert.equal(enqueued.length, 1, "exactly one comms-outbox enqueue");
  const data = enqueued[0]!;
  assert.equal(data.type, "transactional", "type must be transactional");
  assert.equal("contactId" in data, false, "no contactId → single audit plane");
  assert.ok(typeof data.subject === "string" && (data.subject as string).length > 0);
  assert.ok(typeof data.html === "string" && (data.html as string).length > 0);
  return data;
}

beforeEach(() => {
  enqueued.length = 0;
});

test("sendDealSelectedEmail enqueues with parity key deal-selected-<dealId>", async () => {
  const { sendDealSelectedEmail } = await load();
  await sendDealSelectedEmail("buyer@x.com", "Sam", "deal_1");
  const data = lastEvent();
  assert.equal(data.idempotencyKey, "deal-selected-deal_1");
  assert.equal(data.templateId, "deal-selected");
  assert.equal(data.email, "buyer@x.com");
});

test("sendOffersReadyEmail enqueues with parity key offers-ready-<auctionId>", async () => {
  const { sendOffersReadyEmail } = await load();
  await sendOffersReadyEmail("buyer@x.com", "Sam", "auc_1", 3);
  const data = lastEvent();
  assert.equal(data.idempotencyKey, "offers-ready-auc_1");
  assert.equal(data.templateId, "offers-ready");
});

test("sendDealerOfferWonEmail enqueues with parity key dealer-offer-won-<dealId>", async () => {
  const { sendDealerOfferWonEmail } = await load();
  await sendDealerOfferWonEmail({
    to: "dealer@x.com", contactName: "Acme", vehicleRef: "Auction abc",
    buyerFirstName: "Sam", buyerLastInitial: "B", dealUrl: "https://a/x", dealId: "deal_1",
  });
  const data = lastEvent();
  assert.equal(data.idempotencyKey, "dealer-offer-won-deal_1");
  assert.equal(data.templateId, "dealer-offer-won");
  assert.equal(data.email, "dealer@x.com");
});

test("sendDealerOfferLostEmail enqueues with parity key dealer-offer-lost-<auctionId>-<to>", async () => {
  const { sendDealerOfferLostEmail } = await load();
  await sendDealerOfferLostEmail({
    to: "dealer@x.com", contactName: "Acme", vehicleRef: "Auction abc",
    yourPosition: 2, totalOffers: 4, insightsUrl: "https://a/opps", auctionId: "auc_1",
  });
  const data = lastEvent();
  assert.equal(data.idempotencyKey, "dealer-offer-lost-auc_1-dealer@x.com");
  assert.equal(data.templateId, "dealer-offer-lost");
});

test("sendDealerAuctionClosedNoWinnerEmail enqueues with parity key", async () => {
  const { sendDealerAuctionClosedNoWinnerEmail } = await load();
  await sendDealerAuctionClosedNoWinnerEmail({
    to: "dealer@x.com", contactName: "Acme", vehicleRef: "Auction abc", auctionId: "auc_1",
  });
  const data = lastEvent();
  assert.equal(data.idempotencyKey, "dealer-auction-closed-no-winner-auc_1-dealer@x.com");
  assert.equal(data.templateId, "dealer-auction-closed-no-winner");
});
