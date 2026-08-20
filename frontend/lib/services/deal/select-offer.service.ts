// Atomic winning-offer selection — the transactional core of
// POST /api/buyer/auctions/[auctionId]/select-offer.
//
// Domain invariant (Phase 1 E-1): at most ONE accepted offer, and therefore one
// Deal, per auction. The buyer normally selects AFTER the 48h window, when the
// auction is already CLOSED, so auction status is not a usable compare-and-swap
// gate. Two genuinely concurrent selections of DIFFERENT offers would otherwise
// both pass the caller's pre-check and both create a Deal (Deal.offerId @unique
// only blocks re-selecting the SAME offer).
//
// Serialization point: the auction ROW. Each selection takes `FOR UPDATE` on the
// auction inside the transaction, then re-checks the invariant while holding the
// lock. The loser blocks until the winner commits, then observes the accepted
// offer and is rejected — so exactly one Deal can ever persist for an auction.

import { prisma } from "@/lib/prisma";

/** Thrown when a concurrent selection has already won this auction. */
export class OfferSelectionRaceLostError extends Error {
  constructor(message = "An offer has already been selected for this auction.") {
    super(message);
    this.name = "OfferSelectionRaceLostError";
  }
}

export interface CommitOfferSelectionParams {
  buyerId: string;
  auctionId: string;
  offerId: string;
}

/**
 * Atomically create the Deal for the chosen offer and close the auction.
 * @throws OfferSelectionRaceLostError if another selection has already won.
 */
export async function commitOfferSelection(
  params: CommitOfferSelectionParams,
): Promise<{ dealId: string }> {
  const { buyerId, auctionId, offerId } = params;

  const deal = await prisma.$transaction(async (tx) => {
    // Serialize concurrent selections for this auction on the auction row.
    await tx.$queryRaw`SELECT id FROM auctions WHERE id = ${auctionId} FOR UPDATE`;

    // Re-check the invariant under the lock. If a concurrent selection already
    // accepted an offer for this auction, this request lost the race.
    const raced = await tx.offer.findFirst({
      where: { auctionId, status: "ACCEPTED" },
      select: { id: true },
    });
    if (raced) return null;

    const created = await tx.deal.create({
      data: { buyerId, offerId, status: "FINANCING_PENDING" },
    });
    await tx.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });
    await tx.auction.update({
      where: { id: auctionId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    return created;
  });

  if (!deal) throw new OfferSelectionRaceLostError();
  return { dealId: deal.id };
}
