// Program 3 §12 — HARD concierge isolation. A converted concierge CLOSED auction
// must be STRUCTURALLY excluded from competitive-auction machinery: it can never
// be (re)invited, wave-expanded, or reopened into a live auction. This pins the
// structural signature convertConciergeOfferToClosedAuction mints (CLOSED, a
// zero-length live window startedAt==endsAt==closedAt, postCloseProcessedAt set at
// creation) and proves the canonical invitability gate rejects it.
//
// Admin-route reinvite/reopen rejection is proven in
//   app/api/admin/auctions/__tests__/action-eligibility-route.test.ts
// Dealer re-bid rejection is structural in offer.service (submitOffer requires an
// AuctionInvitation — a concierge auction has zero — AND status ACTIVE — it is CLOSED).
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/concierge/__tests__/concierge-competitive-isolation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let auctionRow: Record<string, unknown> | null = null;
let gateEnforced = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: { findUnique: async () => auctionRow },
      dealer: { findUnique: async () => ({ status: "ACTIVE", isSystemPlaceholder: false, marketplaceAgreementSignedAt: new Date() }) },
      dealerAgreementSignature: { findUnique: async () => ({ id: "sig" }) },
      dealerVerification: { findUnique: async () => ({ verified: true }) },
    },
  },
});
mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: { FLAGS: { DEALER_VERIFICATION_GATE: "dealer_verification_gate" }, isEnabled: async () => gateEnforced },
});

async function load() { return import("@/lib/services/dealer/dealer-auction-eligibility.service"); }

const now = new Date();
// Exactly the shape convertConciergeOfferToClosedAuction writes
// (concierge-conversion.service.ts: status CLOSED, startedAt=endsAt=closedAt=now,
// postCloseProcessedAt=now).
const conciergeMintedAuction = {
  status: "CLOSED",
  startedAt: now,
  endsAt: now,
  closedAt: now,
  postCloseProcessedAt: now,
};
// A genuine competitive auction that ran 48h then closed.
const competitiveClosed = {
  status: "CLOSED",
  startedAt: new Date(now.getTime() - 48 * 3600_000),
  endsAt: new Date(now.getTime() - 1000),
  postCloseProcessedAt: new Date(now.getTime() - 500),
};

beforeEach(() => { gateEnforced = false; auctionRow = null; });

test("the concierge-minted auction shape IS recognized as concierge-converted", async () => {
  const { isConciergeConvertedAuction } = await load();
  assert.equal(isConciergeConvertedAuction(conciergeMintedAuction), true);
});

test("a genuine competitive CLOSED auction is NOT flagged concierge", async () => {
  const { isConciergeConvertedAuction } = await load();
  assert.equal(isConciergeConvertedAuction(competitiveClosed), false);
});

test("a concierge auction can NEVER be (re)invited — even with the verification gate OFF and an eligible dealer", async () => {
  gateEnforced = false; // gate OFF would otherwise let any ACTIVE dealer through
  auctionRow = conciergeMintedAuction;
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("concierge_auc", "eligible_dealer");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "auction_not_competitive");
});

test("a concierge auction is excluded BEFORE any dealer/verification check runs (structural, not dealer-dependent)", async () => {
  gateEnforced = true;
  auctionRow = conciergeMintedAuction;
  const { checkDealerAuctionInvitable } = await load();
  // A fully-verified, ACTIVE dealer still cannot be invited into a concierge auction.
  const r = await checkDealerAuctionInvitable("concierge_auc", "fully_verified_dealer");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "auction_not_competitive");
});
