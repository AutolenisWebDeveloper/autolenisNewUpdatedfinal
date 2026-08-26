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

// Deposit-conversion STOP guard for the $99 reminder sequence. Re-read live at
// drain time immediately before every send (Section 4 — the send-time guard is
// authoritative, not just row cancellation). Returns true when the buyer no
// longer owes the competitive $99, so the touch is canceled and all remaining
// touches stop:
//   • a PAID deposit exists — CONVERTED. A paid buyer must NEVER be asked to pay
//     again, even if payment landed seconds before the drain claimed the row.
//   • no PENDING deposit remains — the competitive intent was cancelled, expired,
//     or otherwise abandoned/failed (nothing left to complete → not eligible).
//     If the buyer later restarts checkout, create-intent re-enrolls idempotently.
// A single query fetches both facts so the guard is one round-trip.
export async function depositConversionResolved(buyerId: string): Promise<boolean> {
  const deposits = await prisma.deposit.findMany({
    where: { buyerId, status: { in: ["PAID", "PENDING"] } },
    select: { status: true },
  });
  const hasPaid = deposits.some((d) => d.status === "PAID");
  const hasPending = deposits.some((d) => d.status === "PENDING");
  return hasPaid || !hasPending;
}

// PRE-CHECKOUT stop/handoff guard for the $99 conversion funnel. Re-read live at
// drain time immediately before every pre-checkout touch. Returns true (STOP the
// whole pre-checkout chain) when the lead has left the pre-checkout stage:
//   • ANY Deposit (PENDING or PAID) exists — checkout has STARTED. Ownership hands
//     off to the post-checkout deposit_reminder sequence (which itself handles
//     PENDING→PAID). The two stages must NEVER run against the same buyer at once,
//     so the moment a PENDING deposit appears the pre-checkout stage stops.
//   • no OPEN vehicle request remains — every request is cancelled / expired /
//     already promoted to a deal, so there is nothing left to convert.
// Concierge leads are excluded from this funnel at enrollment, so a concierge
// deposit never reaches a pre-checkout enrollment to stop.
export async function preCheckoutResolved(buyerId: string): Promise<boolean> {
  const [deposit, openRequest] = await Promise.all([
    prisma.deposit.findFirst({
      where: { buyerId, status: { in: ["PENDING", "PAID"] } },
      select: { id: true },
    }),
    prisma.vehicleRequest.findFirst({
      where: {
        buyerId,
        status: { notIn: ["CANCELLED", "EXPIRED", "DEAL_CREATED", "CLOSED_NO_MATCH"] },
      },
      select: { id: true },
    }),
  ]);
  return deposit !== null || openRequest === null;
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
