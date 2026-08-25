// lib/services/concierge/concierge-conversion.service.ts
//
// Deposit-gated convergence of the System B concierge track
// (VehicleOffer → DealerOfferSubmission) onto the canonical auction/deal spine
// (Auction → Offer → Deal). This is the ONLY path that turns concierge dealer
// submissions into canonical Offers a buyer can accept into a real Deal.
//
// Trigger: a settled $99 concierge deposit (Stripe webhook, type
// "concierge_deposit"). Given a buyer with a PAID deposit and the source
// VehicleOffer, this mints ONE deposit-gated CLOSED Auction (Auction.depositId
// is unique + NOT NULL — the deposit is the idempotency anchor), a VehicleRequest
// for the buyer (Auction.vehicleRequestId), and converts each non-rejected
// DealerOfferSubmission into a SUBMITTED canonical Offer. The buyer then selects
// a winner through the existing select-offer route (commitOfferSelection,
// SELECT … FOR UPDATE), which creates the Deal.
//
// Design invariants:
//   • Runs INSIDE the deposit money-cluster transaction, so a PAID concierge
//     deposit ALWAYS has its CLOSED auction — the deposit-activation reconciler
//     (which launches a LIVE auction + invites dealers for PAID deposits with no
//     auction) can never strand or mis-activate a concierge deposit.
//   • Idempotent on Auction.depositId: a redelivery that finds the auction
//     already present reuses it and never double-converts.
//   • The auction is created CLOSED with postCloseProcessedAt set, so the
//     auction-close cron (F-001) never re-processes it (no ranking/no-offer
//     notices, no dealer-load release for dealers that were never invited).
//   • Never THROWS on per-submission data problems (a throw would roll back the
//     money cluster and wedge Stripe's retry loop). Malformed / rejected /
//     non-positive-price submissions are skipped and logged.
//   • Legacy System B rows are READ-ONLY here — the converter only reads them.

import { Prisma, OfferStatus, VehicleRequestStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { assertOtdComponentsMatch } from "@/lib/services/offer/otd";

export class ConciergeConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConciergeConversionError";
  }
}

export interface ConvertConciergeParams {
  buyerId: string;
  depositId: string;
  /**
   * The specific BuyerOfferReview the buyer acted on (the reviewToken they came
   * through). Conversion is driven by THIS review's curated items — one canonical
   * Offer per non-rejected item, priced on that item's vehicleIndex — NOT by every
   * submission on the VehicleOffer. A VehicleOffer can have several reviews (each
   * a different curated subset sent to a buyer); keying off the review is what
   * guarantees the buyer can only accept an offer they were actually shown.
   */
  reviewToken: string;
  /**
   * The system "Outside Dealer" placeholder id, resolved by the caller via
   * getOrCreateOutsideDealerId() BEFORE opening the transaction (that helper
   * runs its own transaction, which must not nest inside this one).
   */
  outsideDealerId: string;
}

export interface ConvertConciergeResult {
  auctionId: string;
  vehicleRequestId: string | null;
  offerIds: string[];
  /** true when an auction already existed for this deposit (idempotent reuse). */
  reused: boolean;
  /** curated review items read that were skipped (rejected or malformed price). */
  skipped: number;
}

/** One element of DealerOfferSubmission.vehicles (untyped JSON in the DB). */
interface DealerVehicleLike {
  offerPriceCents?: unknown;
}

/**
 * Extract the OTD price (in integer cents) from the vehicle at `index` in a
 * DealerOfferSubmission.vehicles JSON payload. The index comes from the curated
 * BuyerOfferReviewItem.vehicleIndex — the exact vehicle the buyer was shown — so
 * a multi-vehicle submission is priced on the shown line, not always vehicles[0].
 * Returns null when the payload is empty, the index is out of range, the element
 * is malformed, or the price is missing / non-positive / non-integer.
 */
export function extractOfferPriceCents(vehicles: unknown, index = 0): number | null {
  if (!Array.isArray(vehicles) || index < 0 || index >= vehicles.length) return null;
  const entry = vehicles[index] as DealerVehicleLike | null;
  if (!entry || typeof entry !== "object") return null;
  const raw = (entry as DealerVehicleLike).offerPriceCents;
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    return null;
  }
  return raw;
}

/**
 * Best-effort parse of the free-text VehicleOffer.buyerBudget string into cents.
 * Concierge budgets are entered by admins as strings ("35000", "$35,000",
 * "30k-35k", …). Returns null when nothing numeric can be recovered — the field
 * is advisory (VehicleRequest.maxBudgetCents is nullable), never a gate here.
 */
export function parseBudgetToCents(budget: string | null | undefined): number | null {
  if (!budget) return null;
  const cleaned = budget.replace(/[,$\s]/g, "").toLowerCase();
  // Take the FIRST number in the string (handles "30k-35k" → 30k, "up to 40000").
  const match = cleaned.match(/(\d+(?:\.\d+)?)(k)?/);
  if (!match) return null;
  let dollars = parseFloat(match[1]);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  if (match[2] === "k") dollars *= 1000;
  return Math.round(dollars * 100);
}

/**
 * Convert a concierge VehicleOffer into a deposit-gated CLOSED Auction with
 * canonical Offers, inside the caller's transaction. Idempotent on the deposit.
 *
 * @throws ConciergeConversionError if the BuyerOfferReview no longer exists
 *   (a real integrity failure — the review was validated at deposit-intent time).
 */
export async function convertConciergeOfferToClosedAuction(
  tx: Prisma.TransactionClient,
  params: ConvertConciergeParams,
): Promise<ConvertConciergeResult> {
  const { buyerId, depositId, reviewToken, outsideDealerId } = params;
  const now = new Date();

  // Idempotency anchor: Auction.depositId is unique. If a prior (partial or
  // complete) run already created the auction for this deposit, reuse it and do
  // NOT re-convert — the offers are already there.
  const existingAuction = await tx.auction.findUnique({
    where: { depositId },
    select: { id: true, vehicleRequestId: true, offers: { select: { id: true } } },
  });
  if (existingAuction) {
    return {
      auctionId: existingAuction.id,
      vehicleRequestId: existingAuction.vehicleRequestId,
      offerIds: existingAuction.offers.map((o) => o.id),
      reused: true,
      skipped: 0,
    };
  }

  // Drive conversion from the SPECIFIC review the buyer acted on — its curated
  // items (each a submission + the exact vehicleIndex shown), not every
  // submission on the VehicleOffer. This is what keeps the buyer's selectable set
  // identical to what the admin sent them.
  const review = await tx.buyerOfferReview.findUnique({
    where: { reviewToken },
    include: {
      vehicleOffer: true,
      items: { include: { submission: true }, orderBy: { id: "asc" } },
    },
  });
  if (!review) {
    throw new ConciergeConversionError(
      `BuyerOfferReview ${reviewToken} not found — cannot convert concierge deposit ${depositId}`,
    );
  }
  const vehicleOffer = review.vehicleOffer;

  // A VehicleRequest for the authenticated buyer, seeded from the concierge
  // offer, gives the canonical Auction.vehicleRequestId link. Status OFFER_SENT:
  // curated dealer offers have been presented to the buyer, who is about to
  // select. (System B has no VehicleRequest of its own — reference_id is free
  // text, not an FK.)
  const vehicleRequest = await tx.vehicleRequest.create({
    data: {
      buyerId,
      status: VehicleRequestStatus.OFFER_SENT,
      makePreference: vehicleOffer.vehicleMake,
      modelPreference: vehicleOffer.vehicleModel,
      yearMin: vehicleOffer.vehicleYear,
      yearMax: vehicleOffer.vehicleYear,
      maxBudgetCents: parseBudgetToCents(vehicleOffer.buyerBudget),
      notes: `Concierge convergence from vehicle offer ${vehicleOffer.id} (review ${review.id})`,
      assignedAdminId: vehicleOffer.createdByAdminId,
    },
    select: { id: true },
  });

  // Deposit-gated CLOSED auction. Timestamps are stamped "now" (the concierge
  // competition already happened offline); postCloseProcessedAt is set so the
  // F-001 close cron never re-processes it.
  const auction = await tx.auction.create({
    data: {
      buyerId,
      depositId,
      vehicleRequestId: vehicleRequest.id,
      status: "CLOSED",
      startedAt: now,
      endsAt: now,
      closedAt: now,
      postCloseProcessedAt: now,
    },
    select: { id: true },
  });

  const offerIds: string[] = [];
  let skipped = 0;

  for (const item of review.items) {
    const submission = item.submission;
    // Only non-rejected submissions become offers.
    if (!submission || submission.rejected) {
      skipped++;
      continue;
    }

    // Price the EXACT vehicle the buyer was shown (item.vehicleIndex), not
    // always vehicles[0].
    const otdPriceCents = extractOfferPriceCents(submission.vehicles, item.vehicleIndex);
    if (otdPriceCents == null) {
      logger.warn(
        `[concierge-conversion] skipping review item ${item.id} (submission ${submission.id}, vehicleIndex ${item.vehicleIndex}): no valid offerPriceCents (deposit ${depositId})`,
      );
      skipped++;
      continue;
    }

    // The concierge JSON carries a single OTD total (offerPriceCents) with no
    // tax/fee breakdown, so map the whole amount to the vehicle line with zero
    // tax/fees/junk. This reconciles to OTD by construction and passes the same
    // assertion the reverse-auction submit path uses.
    try {
      assertOtdComponentsMatch({
        otdPriceCents,
        vehiclePriceCents: otdPriceCents,
        taxCents: 0,
        feesCents: 0,
        junkFeeItems: [],
      });
    } catch (err) {
      logger.warn(
        `[concierge-conversion] skipping review item ${item.id} (submission ${submission.id}): OTD assertion failed (${(err as Error).message})`,
      );
      skipped++;
      continue;
    }

    // Real registered dealer if the submission is soft-linked; otherwise the
    // system Outside Dealer placeholder with the real identity in externalDealer*.
    const isOutside = !submission.dealerId;
    const created = await tx.offer.create({
      data: {
        auctionId: auction.id,
        dealerId: submission.dealerId ?? outsideDealerId,
        status: OfferStatus.SUBMITTED,
        otdPriceCents,
        vehiclePriceCents: otdPriceCents,
        taxCents: 0,
        feesCents: 0,
        junkFeeItems: [],
        // No APR/term is captured in the concierge JSON, so these are treated as
        // cash offers (financing consistency requires apr+term, which we lack).
        includesFinancing: false,
        version: 1,
        submittedAt: now,
        submittedByAdminId: vehicleOffer.createdByAdminId,
        externalDealerName: isOutside ? submission.dealershipName : null,
        externalDealerEmail: isOutside ? submission.contactEmail : null,
        externalDealerPhone: isOutside ? submission.contactPhone : null,
        notes: `Converted from concierge dealer submission ${submission.id} (review item ${item.id}, vehicleIndex ${item.vehicleIndex})`,
      },
      select: { id: true },
    });
    offerIds.push(created.id);
  }

  logger.info(
    `[concierge-conversion] deposit ${depositId} → auction ${auction.id} (${offerIds.length} offers, ${skipped} skipped)`,
  );

  return {
    auctionId: auction.id,
    vehicleRequestId: vehicleRequest.id,
    offerIds,
    reused: false,
    skipped,
  };
}
