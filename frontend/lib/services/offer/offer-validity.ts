// lib/services/offer/offer-validity.ts
//
// WHAT COUNTS AS AN OFFER THE BUYER MAY BE SHOWN AND MAY SELECT — in one place.
//
// Three separate facts have to agree, and before Phase 6 they did not agree anywhere:
//
//   status = SUBMITTED   a DRAFT, WITHDRAWN, DECLINED, EXPIRED or already-ACCEPTED row is not a
//                        live competitor. `processAuctionClose` counted `_count.offers` with NO
//                        status filter (`auction.service.ts:159`), so a withdrawn offer made a
//                        zero-offer auction look successful and the buyer was told "1 offer ready"
//                        for an offers page that rendered none.
//   not disqualified     §13-D40 records an over-ceiling offer rather than rejecting it, and §8c
//                        is unambiguous that such an offer is "never presented as qualified".
//   not expired          §8a makes the expiration required and §9 builds the non-selection path on
//                        it. `offers.expires_at` shipped in the Phase 1 wave with no reader at all.
//
// ONE PREDICATE, TWO FORMS. The `where` fragment is what a database query needs; `isQualified` is
// what a caller holding rows in memory needs. They are written next to each other so a change to
// one that is not made to the other is visible rather than latent — the close path counts through
// the fragment and the send-time recheck re-counts through the same fragment, and a disagreement
// between them would mean telling a buyer their offers are ready and then showing an empty report.
//
// Run: pnpm test:offers

import { OfferStatus, type Prisma } from "@prisma/client";
import { OFFER_VALIDITY_HOURS } from "@/lib/constants";

/**
 * The expiration to stamp on an offer whose submitter did not state one.
 *
 * `closesAt` is the auction's own deadline; the window opens THERE, not at submission, so every
 * offer on one auction lapses together and the Best Price Report does not shed rows while the
 * buyer reads it. With no deadline on the auction (a data gap — `submitOffer` refuses a
 * non-ACTIVE auction, so this is defensive) the window opens now, which is shorter and never
 * longer than the buyer would otherwise get.
 */
export function defaultOfferExpiry(closesAt: Date | null | undefined, now: Date = new Date()): Date {
  const base = closesAt && closesAt.getTime() > now.getTime() ? closesAt : now;
  return new Date(base.getTime() + OFFER_VALIDITY_HOURS * 3_600_000);
}

/** The one live status. `ACCEPTED` is the selection outcome, not a competitor. */
export const LIVE_OFFER_STATUS = OfferStatus.SUBMITTED;

/**
 * `where` fragment for offers a buyer may be shown and may select, as of `now`.
 *
 * `expiresAt: null` qualifies. Every offer written from Phase 6 onward carries one (`submitOffer`
 * defaults it), but rows created before this phase have none, and treating a legacy NULL as
 * "expired" would silently delete a live dealership's offer from the report it belongs in.
 */
export function qualifiedOfferWhere(now: Date = new Date()): Prisma.OfferWhereInput {
  return {
    status: LIVE_OFFER_STATUS,
    isDisqualified: false,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/** The same predicate for a row already in memory. */
export function isQualifiedOffer(
  offer: { status: OfferStatus | string; isDisqualified?: boolean | null; expiresAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (offer.status !== LIVE_OFFER_STATUS) return false;
  if (offer.isDisqualified) return false;
  if (offer.expiresAt && offer.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * `where` fragment for SUBMITTED offers that have lapsed — the sweep's subject.
 *
 * Parity row A16b: "sweep `SUBMITTED` past `expires_at` → `EXPIRED`". Kept here beside the
 * qualification predicate because the sweep exists precisely to make the two agree: without it
 * a lapsed offer stays SUBMITTED forever and every reader has to remember the expiry check.
 */
export function lapsedOfferWhere(now: Date = new Date()): Prisma.OfferWhereInput {
  return { status: LIVE_OFFER_STATUS, expiresAt: { not: null, lte: now } };
}
