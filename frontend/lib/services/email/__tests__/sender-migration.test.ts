// S3 decision 3 + 1 — the five migrated transactional senders now enqueue onto
// the Inngest spine (autolenis/email.send) instead of the direct resend rail,
// with:
//   • the SAME idempotencyKey the direct rail used (EmailSendLog key parity),
//   • type:'transactional' (so emailSendFn applies hard-only suppression),
//   • NO contactId (so emailSendFn writes no contact_timeline_events row → the
//     send is recorded on exactly one plane, never double-counted),
//   • a rendered subject + html (raw-payload path).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/email/__tests__/sender-migration.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const sent: Array<{ name: string; data: Record<string, unknown> }> = [];

mock.module("@/lib/inngest/client", {
  namedExports: {
    inngest: {
      send: async (evt: { name: string; data: Record<string, unknown> }) => {
        sent.push(evt);
        return { ids: ["evt"] };
      },
    },
  },
});

// resend.service imports prisma (for the non-migrated senders' sendIdempotent);
// stub it so importing the module does no real DB work.
mock.module("@/lib/prisma", { namedExports: { prisma: {} } });

async function load() {
  return import("@/lib/services/email/resend.service");
}

function lastEvent() {
  assert.equal(sent.length, 1, "exactly one email.send event");
  const evt = sent[0]!;
  assert.equal(evt.name, "autolenis/email.send");
  assert.equal(evt.data.type, "transactional", "type must be transactional");
  assert.equal("contactId" in evt.data, false, "no contactId → single audit plane");
  assert.ok(typeof evt.data.subject === "string" && (evt.data.subject as string).length > 0);
  assert.ok(typeof evt.data.html === "string" && (evt.data.html as string).length > 0);
  return evt.data;
}

beforeEach(() => {
  sent.length = 0;
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
