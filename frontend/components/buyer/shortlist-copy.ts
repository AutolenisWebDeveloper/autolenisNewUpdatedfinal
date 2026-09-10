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

/**
 * The custom-request path, pre-filled from the car the buyer was looking at.
 *
 * §22a's "Find one like this": the point is that the buyer does not start over. Make, model
 * and a year floor carry across, and the price they were looking at becomes the budget —
 * they were, after all, willing to consider it.
 */
export function findOneLikeThisHref(v: {
  make: string; model: string; year?: number | null; priceCents?: number | null;
}): string {
  const p = new URLSearchParams();
  p.set("makePreference", v.make);
  p.set("modelPreference", v.model);
  if (v.year) p.set("yearMin", String(v.year));
  if (v.priceCents) p.set("maxBudgetCents", String(v.priceCents));
  return `/buyer/requests/new?${p.toString()}`;
}
