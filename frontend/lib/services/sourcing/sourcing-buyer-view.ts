// S6-30 — what the BUYER is told while their request is being sourced.
//
// §Stage 6's buyer-facing requirement: "The buyer sees sourcing progress — the radius being
// searched and how many dealerships are competing — and is asked to authorise a wider search
// before one happens."
//
// WHY THIS IS A PURE MODULE AND NOT JSX. Two surfaces need the same answer — the request detail
// page and the radius-authorisation screen — and a third (the admin case view) needs the same
// vocabulary with different framing. Deriving it twice is how two screens come to disagree
// about what band a case is on, which for a buyer reads as the platform not knowing.
//
// WHAT IT MUST NEVER RETURN, and this is the load-bearing constraint rather than a style note:
// no dealership name, no dealer id, no contact, no email, no rooftop id, no distance to a named
// rooftop. §25.1's identity firewall is built in this phase and lifted in Phase 7, and the
// buyer-facing sourcing view is exactly where it would leak first — "we found Metroplex Ford,
// 14 miles away" is the firewall breached before a single offer exists. COUNTS AND RADII ONLY.
// The shape of this module's return type is the enforcement: there is no field that could hold
// an identity, so a future edit cannot pass one through by accident.
//
// Run: pnpm test:sourcing

import {
  BAND_ORDER,
  BAND_OUTER_MILES,
  SOURCING_BAND,
  SOURCING_CASE_STATUS,
  effectiveRadiusMiles,
  type SourcingBand,
  type SourcingCaseRecord,
  type SourcingCaseStatus,
} from "./sourcing-case.service";

/** One rung of the §6a ladder, as the buyer sees it. */
export interface BandRung {
  band: SourcingBand;
  /** "Within 100 miles", "100–150 miles", … — never a dealership, never a city. */
  label: string;
  /** The outer edge, or the buyer's authorised figure on the AUTHORIZED rung. */
  outerMiles: number | null;
  state: "DONE" | "CURRENT" | "PENDING" | "NEEDS_AUTHORIZATION";
}

export interface BuyerSourcingView {
  /** Present tense, one sentence, no identities. */
  headline: string;
  /** What happens next, or what we need from the buyer. */
  detail: string;
  /** How many rooftops are competing. A COUNT — never who they are. */
  competingCount: number;
  /**
   * Rooftops that can only be reached by phone, reported SEPARATELY and never added to
   * `competingCount`. The owner's 2026-09-11 channel ruling: "two counts recorded
   * separately". Conflating them would let "12 dealerships are competing" mean "8 were
   * emailed and 4 are on an Operations call list".
   */
  callOnlyCount: number;
  /** The radius currently being searched, in miles. Null only on the unauthorised rung. */
  searchingMiles: number | null;
  rungs: BandRung[];
  /** True when the only thing left is the buyer's decision. */
  awaitingBuyerAuthorization: boolean;
  /** True when nothing the buyer does will move it — an Operations decision is pending. */
  awaitingOperations: boolean;
  /** True when the auction is live; the buyer's attention belongs on the auction, not here. */
  launched: boolean;
}

function bandLabel(band: SourcingBand, authorizedMiles: number | null): string {
  switch (band) {
    case SOURCING_BAND.B100:
      return "Within 100 miles";
    case SOURCING_BAND.B150:
      return "100 to 150 miles";
    case SOURCING_BAND.B250:
      return "150 to 250 miles";
    case SOURCING_BAND.AUTHORIZED:
      return authorizedMiles ? `250 to ${authorizedMiles} miles` : "Beyond 250 miles";
  }
}

/**
 * Which rungs are done, which is live, and which are still ahead.
 *
 * THE AUTHORIZED RUNG IS NOT "PENDING" WHEN IT IS REACHED WITHOUT AUTHORISATION — it is
 * `NEEDS_AUTHORIZATION`, because "pending" tells a buyer to wait for us when we are waiting
 * for them. That distinction is the difference between a 14-day abandonment close the buyer
 * understood and one that arrives as a surprise.
 */
export function bandRungs(sourcingCase: SourcingCaseRecord): BandRung[] {
  const currentIndex = BAND_ORDER.indexOf(sourcingCase.band);
  const needsAuth =
    sourcingCase.status === SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED ||
    (sourcingCase.band === SOURCING_BAND.AUTHORIZED && sourcingCase.authorizedRadiusMiles === null);

  return BAND_ORDER.map((band, i) => {
    const outer =
      band === SOURCING_BAND.AUTHORIZED
        ? sourcingCase.authorizedRadiusMiles
        : BAND_OUTER_MILES[band];
    let state: BandRung["state"];
    if (i < currentIndex) state = "DONE";
    else if (i > currentIndex) state = "PENDING";
    else state = needsAuth ? "NEEDS_AUTHORIZATION" : "CURRENT";
    return { band, label: bandLabel(band, sourcingCase.authorizedRadiusMiles), outerMiles: outer, state };
  });
}

/**
 * THE ONE PLACE a sourcing case becomes buyer-facing words.
 *
 * `callOnlyCount` is passed in rather than read, because it is a property of the LAST LADDER
 * STEP and not of the case row — `sourcing_cases` records `coverage_count` (the invitation-ready
 * field) and nothing else. A caller with no step result passes 0, which is honest: it means "we
 * are not currently reporting a phone-only count", not "there are none".
 */
export function describeSourcingForBuyer(
  sourcingCase: SourcingCaseRecord,
  callOnlyCount = 0,
): BuyerSourcingView {
  const rungs = bandRungs(sourcingCase);
  const searchingMiles = effectiveRadiusMiles(sourcingCase.band, sourcingCase.authorizedRadiusMiles);
  const competingCount = sourcingCase.coverageCount;

  const base = {
    competingCount,
    callOnlyCount,
    searchingMiles,
    rungs,
    awaitingBuyerAuthorization: false,
    awaitingOperations: false,
    launched: false,
  };

  const status: SourcingCaseStatus = sourcingCase.status;

  switch (status) {
    case SOURCING_CASE_STATUS.LAUNCHED:
      return {
        ...base,
        launched: true,
        headline:
          competingCount === 1
            ? "Your auction is live with 1 dealership competing"
            : `Your auction is live with ${competingCount} dealerships competing`,
        detail:
          "Offers stay sealed until the auction closes, so no dealership can see another's price. " +
          "You will be notified the moment it closes.",
      };

    case SOURCING_CASE_STATUS.READY_TO_LAUNCH:
      return {
        ...base,
        headline: `${competingCount} dealerships are ready to compete`,
        detail: "We are making the final checks before your auction opens.",
      };

    case SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED:
      return {
        ...base,
        awaitingBuyerAuthorization: true,
        headline: "We have searched 250 miles and need your decision",
        detail:
          competingCount > 0
            ? `${competingCount} dealerships are interested so far. Widening the search would add more, ` +
              "but a car further away can mean a longer trip to collect it — so we will not go past " +
              "250 miles without your say-so."
            : "No dealership within 250 miles can serve this request. Widening the search is the next " +
              "step, and it is yours to authorise — a car further away can mean a longer trip to " +
              "collect it.",
      };

    case SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL:
      return {
        ...base,
        awaitingOperations: true,
        headline: `${competingCount} dealerships can compete — fewer than we like`,
        detail:
          "A smaller field still produces real competition, but our team reviews it first so you are " +
          "not put into a thin auction without someone looking. Nothing is needed from you.",
      };

    case SOURCING_CASE_STATUS.THIN_COVERAGE_REVIEW:
    case SOURCING_CASE_STATUS.ZERO_COVERAGE_REVIEW:
      return {
        ...base,
        awaitingOperations: true,
        headline: "Our team is working on your request by hand",
        detail:
          "The automatic search has gone as far as it usefully can, so a person has picked it up. " +
          "Your $99 deposit is refundable if we cannot find a match.",
      };

    case SOURCING_CASE_STATUS.CLOSED:
      return {
        ...base,
        headline: "This sourcing run is closed",
        detail:
          sourcingCase.closeReason ??
          "No further searching is happening on this request. Your $99 deposit is refundable if we " +
            "could not find a match.",
      };

    case SOURCING_CASE_STATUS.ACTIVE_SOURCING:
    default: {
      const rung = rungs.find((r) => r.state === "CURRENT");
      return {
        ...base,
        headline:
          competingCount === 0
            ? `Searching ${rung?.label.toLowerCase() ?? "near you"}`
            : `${competingCount} dealerships so far, searching ${rung?.label.toLowerCase() ?? "near you"}`,
        detail:
          "We invite a field of competing dealerships before your auction opens, so the first price " +
          "you see is already the best of several.",
      };
    }
  }
}
