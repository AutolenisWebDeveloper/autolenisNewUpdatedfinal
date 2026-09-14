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
//
// ── PHASE 6 (Stage 9 / §9a) ─────────────────────────────────────────────────────────────────────
//
// Before this phase the transaction wrote `{ buyerId, offerId, status: "FINANCING_PENDING" }` and
// nothing else. §9a requires the Deal to carry its full lineage — Vehicle Request, auction,
// selected offer, deposit, buyer, co-buyer, trade, dealership, rooftop, VIN, vehicle snapshot,
// out-the-door amount AND the locked plan snapshot — and §13-D41 moves the entry state to
// `DEALER_CONFIRMATION`, because a Deal created straight into financing asserts a dealership
// confirmation that has not happened.
//
// Four things also happen here that did not, each because leaving them outside the lock made them
// losable:
//
//   the initial `deal_status_history` row  — the transition INTO the deal's first state was the
//                                            only one with no history entry
//   `postCloseProcessedAt`                 — an early accept set CLOSED without it, so the
//                                            null-marker cron re-processed the auction and told a
//                                            buyer who had already selected that their "offers are
//                                            ready — select your best deal"
//   non-selected offers -> DECLINED        — §9: "every non-selected candidate closes"
//   non-selected candidates -> CLOSED      — the `auction_vehicles` rows the buyer did not pick
//
// The dealer AWARD and NON-AWARD notices are NOT sent here: they ride the existing durable
// `dealerAwardDispatchedAt` marker on the Deal, which the dealer-award-dispatch cron drains. That
// marker starts NULL on the row this function creates, so the dispatch is armed by the commit
// itself rather than by a best-effort call that a crashed request would lose.

import { prisma } from "@/lib/prisma";
import { DealStatus, OfferStatus } from "@prisma/client";
import { writeDealCreationRecord } from "./deal-creation";
import { cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { selectionReminderCancelKey } from "@/lib/services/comms/state-recheck-registry";

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
  /** Stamped on the audit trail; defaults to now. */
  now?: Date;
}

export interface CommitOfferSelectionResult {
  dealId: string;
  /** Offers closed as a consequence — §9's "every non-selected candidate closes". */
  declinedOfferIds: string[];
  /** `auction_vehicles` rows closed because the buyer resolved the shortlist to one VIN. */
  closedCandidateIds: string[];
}

/**
 * Atomically create the Deal for the chosen offer and close the auction.
 * @throws OfferSelectionRaceLostError if another selection has already won.
 */
export async function commitOfferSelection(
  params: CommitOfferSelectionParams,
): Promise<CommitOfferSelectionResult> {
  const { buyerId, auctionId, offerId } = params;
  const now = params.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Serialize concurrent selections for this auction on the auction row.
    await tx.$queryRaw`SELECT id FROM auctions WHERE id = ${auctionId} FOR UPDATE`;

    // Re-check the invariant under the lock. If a concurrent selection already
    // accepted an offer for this auction, this request lost the race.
    const raced = await tx.offer.findFirst({
      where: { auctionId, status: OfferStatus.ACCEPTED },
      select: { id: true },
    });
    if (raced) return null;

    // ── the lineage, read under the lock so it cannot drift from what is written ──
    //
    // BOUND, NOT MERELY FETCHED. Both reads used to be `findUnique` on the id alone: the auction
    // was not tied to `buyerId` and the offer was not tied to `auctionId`. Neither current caller
    // can exploit that — the HTTP route scopes `{ id: auctionId, buyerId }` and the AI action-intent
    // path has its own ownership check — but this function is where the damage now lives, and it
    // grew a great deal in this phase. A mis-bound call would, in ONE transaction, create a Deal
    // owned by the caller carrying the victim's deposit and vehicle request, accept the victim's
    // offer, DECLINE all their others, CLOSE their candidates, force the auction CLOSED with
    // `postCloseProcessedAt` stamped — permanently suppressing the close reconciler — and cancel
    // their selection reminder. An invariant that costs one `where` clause should be a property of
    // the service, not of every caller that will ever exist.
    const auction = await tx.auction.findFirst({
      where: { id: auctionId, buyerId },
      select: { id: true, depositId: true, vehicleRequestId: true },
    });
    if (!auction) return null;

    const offer = await tx.offer.findFirst({
      // `status: SUBMITTED` as well as the auction binding: an ACCEPTED offer is caught by the
      // race check above, but a WITHDRAWN, DECLINED or EXPIRED one is not, and none of those is
      // selectable. The caller validates this too; a second statement of it here costs nothing.
      where: { id: offerId, auctionId, status: OfferStatus.SUBMITTED },
      select: {
        id: true,
        dealerId: true,
        rooftopId: true,
        vin: true,
        otdPriceCents: true,
        auctionVehicleId: true,
      },
    });
    if (!offer) return null;

    const [buyer, vehicleRequest] = await Promise.all([
      tx.buyer.findUnique({ where: { id: buyerId }, select: { plan: true } }),
      auction.vehicleRequestId
        ? tx.vehicleRequest.findUnique({
            where: { id: auction.vehicleRequestId },
            select: {
              id: true,
              // `VehicleRequest` has no `coBuyerId` FK — the link is the reverse relation
              // `CoBuyer.vehicleRequestId`. Ordered so the Deal binds the same co-buyer on every
              // run rather than whichever row the database happened to return first.
              coBuyers: { select: { id: true }, orderBy: { id: "asc" }, take: 1 },
            },
          })
        : Promise.resolve(null),
    ]);

    const created = await tx.deal.create({
      data: {
        buyerId,
        offerId,
        // §13-D41, ruled 2026-09-13: new deals enter at DEALER_CONFIRMATION. Existing deals stay
        // where they are and the transition map accepts both entries, so a revert leaves in-flight
        // deals legal. Production held zero deals, so the no-backfill ruling is moot in fact —
        // recorded because the transition map accepting both entries is what makes a revert safe.
        status: DealStatus.DEALER_CONFIRMATION,
        // §9a's lineage. Every field is nullable on the model, so a missing one degrades the
        // record rather than refusing the selection — a buyer must never be blocked from choosing
        // their car because an upstream row is thin.
        auctionId: auction.id,
        depositId: auction.depositId,
        vehicleRequestId: auction.vehicleRequestId,
        dealerId: offer.dealerId,
        rooftopId: offer.rooftopId,
        vin: offer.vin,
        otdCentsConfirmed: offer.otdPriceCents,
        coBuyerId: vehicleRequest?.coBuyers[0]?.id ?? null,
      },
    });

    // History row, locked plan snapshot and trade packet — shared with the VehicleRequestOffer
    // path so the two Deal origins cannot drift on what every new Deal must carry.
    await writeDealCreationRecord(tx, {
      dealId: created.id,
      buyerId,
      plan: buyer?.plan ?? "STANDARD",
      vehicleRequestId: auction.vehicleRequestId,
      reason: "Buyer selected the winning offer (§9).",
      now,
    });

    await tx.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.ACCEPTED },
    });

    // §9: "Every non-selected candidate closes and the rooftops that bid on them receive non-award
    // notices." The notices ride the award-dispatch marker; the CLOSING is this transaction's, so
    // a live losing offer can never outlive the selection that beat it.
    //
    // `DECLINED`, not `NOT_SELECTED`: §8.1a L794-799 records that label as WITHHELD, and the
    // 2026-09-13 D39 ruling explicitly did not change that. `verify.sql` still asserts it absent.
    const losers = await tx.offer.findMany({
      where: { auctionId, status: OfferStatus.SUBMITTED, id: { not: offerId } },
      select: { id: true },
    });
    if (losers.length > 0) {
      await tx.offer.updateMany({
        where: { id: { in: losers.map((o) => o.id) } },
        data: { status: OfferStatus.DECLINED },
      });
    }

    // §22a: "selection collapses the shortlist to a single VIN. Nothing after selection knows the
    // request was ever multi-vehicle." Every candidate except the one the winning offer answers.
    const candidates = await tx.auctionVehicle.findMany({
      where: {
        auctionId,
        candidateStatus: "ACTIVE",
        ...(offer.auctionVehicleId ? { id: { not: offer.auctionVehicleId } } : {}),
      },
      select: { id: true },
    });
    if (candidates.length > 0) {
      await tx.auctionVehicle.updateMany({
        where: { id: { in: candidates.map((c) => c.id) } },
        data: { candidateStatus: "CLOSED", droppedReason: "Buyer selected a different candidate (§9)." },
      });
    }

    await tx.auction.update({
      where: { id: auctionId },
      data: {
        status: "CLOSED",
        closedAt: now,
        // WITHOUT THIS, an early accept left the marker NULL and the auction-close reconciler
        // (`app/api/cron/auction-close/route.ts:32-37` selects exactly
        // `{ status: CLOSED, postCloseProcessedAt: null }`) claimed it on the next tick and emitted
        // the full post-close side effects — including telling a buyer who had just selected that
        // their offers were ready and they should choose. Selection IS the post-close processing
        // for this auction, so it stamps the marker itself.
        postCloseProcessedAt: now,
      },
    });

    // §9 / S14 — the pre-expiry reminder is about a decision that has now been made. §27's
    // cancellation rule, inside the same transaction as the selection: a cancelled row leaves an
    // operator reading the outbox the true record — an ask that was scheduled and never made —
    // where relying on the send-time recheck alone would leave a row that looks pending for two
    // days and then silently skips.
    //
    // Cancellation never touches a row that has already been SENT; that is `cancelByKey`'s own
    // rule, and it is the right one — a message that has left cannot be unsent.
    await cancelByKey(
      selectionReminderCancelKey(auctionId),
      "the buyer selected an offer",
      tx,
    );

    return {
      dealId: created.id,
      declinedOfferIds: losers.map((o) => o.id),
      closedCandidateIds: candidates.map((c) => c.id),
    };
  });

  if (!result) throw new OfferSelectionRaceLostError();
  return result;
}
