// The buyer-facing vocabulary for a card that cannot be shortlisted (§22a; Phase 4).
//
// SHARED ON PURPOSE. Two surfaces render these cards — the authenticated search over the swept
// catalogue, and the live qualified-results view — and a third (the shortlist API) refuses with
// the same codes. Three copies of these sentences would drift, and the drift would show up as
// the same car being described two different ways on two pages of the same session.
//
// Keyed on the SERVER's `GateReason`, never on anything the client derives.

/** Why an in-catalogue car cannot be brought to auction, in the buyer's words. */
export const CARD_REFUSAL: Record<string, string> = {
  OUT_OF_RADIUS: "Too far to bring to auction — we'll find one like it near you.",
  DISTANCE_UNKNOWN: "We can't confirm where this one is — we'll find one like it near you.",
  STALE_LISTING: "This listing has gone quiet — we'll find one like it near you.",
  UNAVAILABLE: "No longer available — we'll find one like it near you.",
  // Live qualified-results only: the car is real, near and current, but it is not in our
  // catalogue yet, so there is nothing to bring to auction. Worded as what we WILL do rather
  // than as a defect the buyer has to understand.
  NOT_IN_CATALOGUE: "New to the market — start a request and we'll go and get this one for you.",
};

// The "Find one like this" href is NOT defined here. `buildSimilarRequestHref` in
// `lib/services/shortlist/shortlist-availability.ts` already builds it, and better: a year
// band rather than a floor, a mileage band, a rounded price band with headroom, and the
// buyer's features. A second implementation here produced a narrower link for the same car
// depending on which page it was clicked from — the drift this file's own header warns about,
// created by this file. Found in review.
export { buildSimilarRequestHref as findOneLikeThisHref } from "@/lib/services/shortlist/shortlist-availability";
