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
