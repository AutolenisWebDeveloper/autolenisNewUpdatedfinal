// Unit tests for the dealer award / non-award notification planner.
// Run with:  npx tsx --test lib/services/notifications/__tests__/dealer-award.test.ts
//
// G1 — on offer acceptance, the winning dealer gets an award notification and
// every OTHER dealer that bid gets a non-award close-out. These tests pin the
// pure planner that decides WHO gets WHAT (the impure dispatcher only performs
// the sends the planner returns). They prove:
//   • the winner gets exactly one WON outcome, each other bidder exactly one LOST;
//   • a decline / no-winner produces ZERO outcomes (nobody is notified);
//   • buyer PII never leaks — only first name + last initial reach a dealer, and
//     no notification body/title ever contains a raw email address;
//   • outside/placeholder dealers get an email but NO in-app row (no account);
//   • idempotency keys and in-app dedupe keys are stable and collision-free.

import test from "node:test";
import assert from "node:assert/strict";
import {
  planDealerAwardOutcomes,
  type DealerAwardBidder,
  type PlanDealerAwardInput,
} from "../dealer-award";
import { NotificationType } from "@prisma/client";

const APP = "https://autolenis.com";

function bidder(over: Partial<DealerAwardBidder> & { offerId: string }): DealerAwardBidder {
  return {
    dealerId: `dealer-${over.offerId}`,
    isSystemPlaceholder: false,
    email: `${over.offerId}@dealer.test`,
    dealershipName: `Dealer ${over.offerId}`,
    otdPriceCents: 3_000_000,
    ...over,
  };
}

function baseInput(over: Partial<PlanDealerAwardInput> = {}): PlanDealerAwardInput {
  return {
    bidders: [
      bidder({ offerId: "win", otdPriceCents: 3_000_000 }),
      bidder({ offerId: "lose-a", otdPriceCents: 3_100_000 }),
      bidder({ offerId: "lose-b", otdPriceCents: 3_250_000 }),
    ],
    winningOfferId: "win",
    dealId: "deal-1",
    auctionId: "auction-1",
    vehicleRef: "Auction abc1234",
    buyerFirstName: "Jordan",
    buyerLastInitial: "M",
    appUrl: APP,
    ...over,
  };
}

test("winner gets exactly one WON outcome and each other bidder exactly one LOST", () => {
  const outcomes = planDealerAwardOutcomes(baseInput());
  assert.equal(outcomes.length, 3, "one outcome per bidder");
  const won = outcomes.filter((o) => o.kind === "WON");
  const lost = outcomes.filter((o) => o.kind === "LOST");
  assert.equal(won.length, 1, "exactly one winner");
  assert.equal(lost.length, 2, "every other bidder is a non-award");
  assert.equal(won[0]!.offerId, "win");
  // no duplicate offers — exactly one notification per dealer/offer
  assert.equal(new Set(outcomes.map((o) => o.offerId)).size, 3);
});

test("a decline / no winning offer notifies nobody", () => {
  assert.deepEqual(planDealerAwardOutcomes(baseInput({ winningOfferId: null })), []);
  assert.deepEqual(planDealerAwardOutcomes(baseInput({ dealId: null })), []);
  assert.deepEqual(
    planDealerAwardOutcomes(baseInput({ bidders: [], winningOfferId: null })),
    [],
  );
});

test("WON carries the DEAL_SELECTED type and the dealer deal deep-link; LOST is generic", () => {
  const outcomes = planDealerAwardOutcomes(baseInput());
  const won = outcomes.find((o) => o.kind === "WON")!;
  assert.equal(won.notification.type, NotificationType.DEAL_SELECTED);
  assert.equal(won.notification.actionUrl, "/dealer/deals/deal-1");
  assert.equal(won.dealUrl, `${APP}/dealer/deals/deal-1`);

  for (const lost of outcomes.filter((o) => o.kind === "LOST")) {
    assert.equal(lost.notification.type, NotificationType.OFFER_DECLINED);
    assert.equal(lost.notification.actionUrl, "/dealer/opportunities");
    assert.equal(lost.dealUrl, `${APP}/dealer/opportunities`);
  }
});

test("positions are ranked by OTD ascending and totalOffers is the bidder count", () => {
  const outcomes = planDealerAwardOutcomes(baseInput());
  const byOffer = Object.fromEntries(outcomes.map((o) => [o.offerId, o]));
  assert.equal(byOffer["win"]!.position, 1); // lowest OTD
  assert.equal(byOffer["lose-a"]!.position, 2);
  assert.equal(byOffer["lose-b"]!.position, 3);
  for (const o of outcomes) assert.equal(o.totalOffers, 3);
});

test("no buyer PII leaks: only first name + last initial reach the winner; no emails in any body", () => {
  const outcomes = planDealerAwardOutcomes(
    baseInput({ buyerFirstName: "Jordan", buyerLastInitial: "M" }),
  );
  const won = outcomes.find((o) => o.kind === "WON")!;
  // winner handoff carries first name + last initial only
  assert.equal(won.buyerFirstName, "Jordan");
  assert.equal(won.buyerLastInitial, "M");
  // non-award outcomes carry NO buyer identity at all
  for (const lost of outcomes.filter((o) => o.kind === "LOST")) {
    assert.equal(lost.buyerFirstName, "");
    assert.equal(lost.buyerLastInitial, "");
    assert.doesNotMatch(lost.notification.body, /Jordan/);
  }
  // no notification body/title anywhere contains a raw email address
  for (const o of outcomes) {
    assert.doesNotMatch(o.notification.title, /@/, `${o.offerId} title leaked an email`);
    assert.doesNotMatch(o.notification.body, /@/, `${o.offerId} body leaked an email`);
  }
});

test("outside/placeholder dealers get an email but no in-app row (they have no account)", () => {
  const outcomes = planDealerAwardOutcomes(
    baseInput({
      bidders: [
        bidder({ offerId: "win", isSystemPlaceholder: false, dealerId: "real-1" }),
        bidder({
          offerId: "lose-outside",
          isSystemPlaceholder: true,
          dealerId: "system-placeholder",
          email: "outside@dealer.test",
          otdPriceCents: 3_400_000,
        }),
      ],
    }),
  );
  const outside = outcomes.find((o) => o.offerId === "lose-outside")!;
  assert.equal(outside.email, "outside@dealer.test");
  assert.equal(outside.inAppDealerId, null, "no dealer account → no in-app notification");
  const winner = outcomes.find((o) => o.offerId === "win")!;
  assert.equal(winner.inAppDealerId, "real-1", "registered dealer gets an in-app row");
});

test("a bidder with neither a deliverable email nor an account is dropped entirely", () => {
  const outcomes = planDealerAwardOutcomes(
    baseInput({
      bidders: [
        bidder({ offerId: "win", dealerId: "real-1" }),
        bidder({
          offerId: "ghost",
          isSystemPlaceholder: true,
          dealerId: "system-placeholder",
          email: null, // outside dealer with no captured email
          otdPriceCents: 3_500_000,
        }),
      ],
    }),
  );
  assert.equal(outcomes.find((o) => o.offerId === "ghost"), undefined);
  assert.equal(outcomes.length, 1);
});

test("email idempotency keys are stable and match the existing resend rail conventions", () => {
  const outcomes = planDealerAwardOutcomes(baseInput());
  const won = outcomes.find((o) => o.kind === "WON")!;
  assert.equal(won.emailKey, "dealer-offer-won-deal-1");
  const lostA = outcomes.find((o) => o.offerId === "lose-a")!;
  assert.equal(lostA.emailKey, "dealer-offer-lost-auction-1-lose-a@dealer.test");
});

test("in-app dedupe keys are stable and collision-free across a plan", () => {
  const outcomes = planDealerAwardOutcomes(baseInput());
  const keys = outcomes.map((o) => o.dedupeKey);
  assert.equal(new Set(keys).size, keys.length, "no dedupe-key collisions");
  // stable across re-planning (idempotent under re-invoke)
  const again = planDealerAwardOutcomes(baseInput());
  assert.deepEqual(
    again.map((o) => o.dedupeKey),
    keys,
  );
});
