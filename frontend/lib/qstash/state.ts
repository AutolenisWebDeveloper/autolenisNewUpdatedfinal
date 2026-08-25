import { prisma } from "@/lib/prisma";

// Shared "has the buyer/dealer already advanced?" guards used by the
// multi-touch job sequences so a converting user is never chased by a stale
// reminder. Each guard re-reads live DB state on every QStash delivery.

// Buyer has activated their auction by paying the $99 deposit.
export async function hasPaidDeposit(buyerId: string): Promise<boolean> {
  const deposit = await prisma.deposit.findFirst({
    where: { buyerId, status: "PAID" },
    select: { id: true },
  });
  return deposit !== null;
}

// Buyer has selected/accepted a dealer offer (an accepted offer or a created
// deal both signal the auction has converted).
export async function hasSelectedOffer(buyerId: string): Promise<boolean> {
  const [deal, acceptedOffer] = await Promise.all([
    prisma.deal.findFirst({ where: { buyerId }, select: { id: true } }),
    prisma.offer.findFirst({
      where: { status: "ACCEPTED", auction: { buyerId } },
      select: { id: true },
    }),
  ]);
  return deal !== null || acceptedOffer !== null;
}

// Dealer has already submitted a (non-draft) bid for this auction.
export async function hasDealerBid(auctionId: string, dealerId: string): Promise<boolean> {
  const offer = await prisma.offer.findFirst({
    where: { auctionId, dealerId, status: { not: "DRAFT" } },
    select: { id: true },
  });
  return offer !== null;
}

// Buyer currently has a genuinely LIVE (ACTIVE) reverse auction — dealers can
// still submit/revise bids. This is the authoritative "is a live competitive
// auction actually running?" check that live-auction lifecycle touches
// (auction-active / -midpoint / -closing) must pass at execution time.
//
// It is FALSE for a concierge-converted auction, which is minted already
// `CLOSED` (with offers already present and no dealer invitations) — that buyer
// was never in a live competitive auction, so telling them "your auction is
// LIVE / dealers are bidding / closing soon" would be untrue (Program 2 §10).
// It is also false once a normal auction has closed, expired, or been cancelled.
export async function hasLiveAuction(buyerId: string): Promise<boolean> {
  const auction = await prisma.auction.findFirst({
    where: { buyerId, status: "ACTIVE" },
    select: { id: true },
  });
  return auction !== null;
}
