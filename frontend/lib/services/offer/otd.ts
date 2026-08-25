// lib/services/offer/otd.ts
// Pure OTD (out-the-door) component arithmetic shared by the reverse-auction
// offer path (offer.service) and the concierge→canonical conversion
// (concierge-conversion.service). Kept dependency-free (no next/server, no
// side-effectful imports) so every price that becomes a canonical Offer is
// validated by the SAME assertion, in services and in tests alike.

// Allow up to 1 cent rounding tolerance when summing OTD components.
export const OTD_SUM_TOLERANCE_CENTS = 1;

/**
 * Assert that an offer's OTD components reconcile to its OTD total:
 *   vehiclePriceCents + taxCents + feesCents + Σ(junk fee) == otdPriceCents  (±1¢)
 * Negative junk-fee line items are rejected (a negative "fee" could otherwise
 * inflate vehiclePriceCents while holding OTD constant, misrepresenting the
 * breakdown while still reconciling to OTD).
 */
export function assertOtdComponentsMatch(input: {
  otdPriceCents: number;
  vehiclePriceCents: number;
  taxCents: number;
  feesCents: number;
  junkFeeItems?: Array<{ name: string; amount: number }>;
}) {
  for (const item of input.junkFeeItems ?? []) {
    if ((item.amount ?? 0) < 0) {
      throw new Error(`Junk fee "${item.name}" cannot be negative`);
    }
  }
  const junkFeeCents = (input.junkFeeItems ?? []).reduce(
    (sum, item) => sum + Math.round((item.amount ?? 0) * 100),
    0,
  );
  const expected = input.vehiclePriceCents + input.taxCents + input.feesCents + junkFeeCents;
  if (Math.abs(input.otdPriceCents - expected) > OTD_SUM_TOLERANCE_CENTS) {
    throw new Error(
      `OTD breakdown mismatch: components sum to ${expected} cents but otdPriceCents is ${input.otdPriceCents}`,
    );
  }
}
