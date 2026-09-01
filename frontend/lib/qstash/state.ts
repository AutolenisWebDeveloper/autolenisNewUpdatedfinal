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
//     DepositStatus is PENDING | PAID | REFUNDED | FAILED, so REFUNDED and FAILED
//     stop the chain by virtue of leaving PENDING — widening the status filter
//     below would silently un-stop them (a test pins that filter for exactly this
//     reason).
//   • the buyer has been administratively halted — suspended, disabled, archived
//     or purged. An admin freezing or retiring an account is an unambiguous "stop
//     contacting this person", and continuing to market them into completing a
//     purchase ignores that decision. This is checked here rather than only at
//     enqueue time because a buyer is far more likely to be frozen DURING the
//     72-hour window than before it.
//     Note: pauseBuyerWorkflow is NOT the relevant control — it pauses an ACTIVE
//     auction, and a buyer who has not paid the $99 has no active auction yet, so
//     it can never apply to this stage.
// Fails CLOSED: a buyer row that cannot be found stops the chain.
export async function depositConversionResolved(buyerId: string): Promise<boolean> {
  const [deposits, buyer] = await Promise.all([
    prisma.deposit.findMany({
      where: { buyerId, status: { in: ["PAID", "PENDING"] } },
      select: { status: true },
    }),
    prisma.buyer.findUnique({
      where: { id: buyerId },
      select: { suspendedAt: true, disabledAt: true, archivedAt: true, purgedAt: true },
    }),
  ]);

  if (!buyer) return true;
  const halted =
    buyer.suspendedAt !== null ||
    buyer.disabledAt !== null ||
    buyer.archivedAt !== null ||
    buyer.purgedAt !== null;
  if (halted) return true;

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
