// Program 3 — buyer-facing auction state must be TRUTHFUL. The buyer is never told
// dealers are "bidding"/"competing"/"reviewing" merely because an auction record
// exists. Real participation is driven by SUBMITTED offers only; an invitation is
// not participation, and zero dealers is not "reviewing".
//
//   npx tsx --test lib/services/auction/__tests__/auction-engagement.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { deriveAuctionEngagement } from "@/lib/services/auction/auction-engagement";

const FALSE_COMPETITION = /bidding|competing|reviewing|preparing/i;

test("0 invited, 0 offers → sourcing; never claims dealers are engaged", () => {
  const e = deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: 0, offerCount: 0 });
  assert.equal(e.dealersBidding, 0);
  assert.equal(e.engagementLevel, "Sourcing");
  assert.doesNotMatch(e.socialProof, FALSE_COMPETITION);
});

test("dealers invited but 0 offers → awaiting offers; not 'bidding/competing'", () => {
  const e = deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: 5, offerCount: 0 });
  assert.equal(e.dealersBidding, 0, "invitations are NOT participation");
  assert.equal(e.engagementLevel, "Awaiting Offers");
  assert.match(e.socialProof, /invited|awaiting/i);
  assert.doesNotMatch(e.socialProof, /bidding|competing/i);
});

test("1 submitted offer → real participation reflected", () => {
  const e = deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: 5, offerCount: 1 });
  assert.equal(e.dealersBidding, 1);
  assert.equal(e.engagementLevel, "Active");
  assert.match(e.socialProof, /offer/i);
});

test("3 offers → High; 5 offers → Very High", () => {
  assert.equal(deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: 8, offerCount: 3 }).engagementLevel, "High");
  assert.equal(deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: 8, offerCount: 5 }).engagementLevel, "Very High");
});

test("INVARIANT: dealersBidding always equals real offerCount, never the invited count", () => {
  for (const invited of [0, 1, 8, 50]) {
    for (const offers of [0, 1, 4, 9]) {
      const e = deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: invited, offerCount: offers });
      assert.equal(e.dealersBidding, offers, `invited=${invited} offers=${offers}`);
    }
  }
});

test("INVARIANT: no competition/bidding language whenever offerCount === 0", () => {
  for (const invited of [0, 1, 3, 20]) {
    const e = deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: invited, offerCount: 0 });
    assert.doesNotMatch(e.socialProof, /bidding|competing/i, `invited=${invited}`);
  }
});

test("negative/garbage counts are clamped (no NaN, no negative)", () => {
  const e = deriveAuctionEngagement({ status: "ACTIVE", dealersInvited: -3, offerCount: -1 });
  assert.equal(e.dealersBidding, 0);
  assert.equal(e.engagementLevel, "Sourcing");
});
