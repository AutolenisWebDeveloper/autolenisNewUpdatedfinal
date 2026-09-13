// lib/services/offer/otd.ts
// Pure OTD (out-the-door) component arithmetic shared by the reverse-auction
// offer path (offer.service) and the concierge→canonical conversion
// (concierge-conversion.service). Kept dependency-free (no next/server, no
// side-effectful imports) so every price that becomes a canonical Offer is
// validated by the SAME assertion, in services and in tests alike.

import { normalizeJunkFeeItems, feeItemsTotalCents } from "./junk-fee-items";

// Allow up to 1 cent rounding tolerance when summing OTD components.
export const OTD_SUM_TOLERANCE_CENTS = 1;

/**
 * Assert that an offer's OTD components reconcile to its OTD total:
 *   vehiclePriceCents + taxCents + feesCents + Σ(fee item) == otdPriceCents  (±1¢)
 *
 * Negative fee line items are rejected (a negative "fee" could otherwise inflate
 * vehiclePriceCents while holding OTD constant, misrepresenting the breakdown while still
 * reconciling to OTD).
 *
 * UNIT (Phase 6, §8.2 defect 1). This used to read `Math.round(item.amount * 100)`, treating the
 * stored amount as DOLLARS, while `best-price.service.ts:64` summed the same field as CENTS — a
 * 100x divergence on one untyped `Json` column. Both now go through `junk-fee-items.ts`, which is
 * the single owner of the representation and accepts the two legacy shapes so a stored row written
 * before the transform still reconciles.
 *
 * `feeItemsTotalCents` and not `junkFeeTotalCents`: the arithmetic must account for EVERY itemised
 * fee the dealer charged, junk or not. Classification decides ranking, never whether the money was
 * taken.
 */
export function assertOtdComponentsMatch(input: {
  otdPriceCents: number;
  vehiclePriceCents: number;
  taxCents: number;
  feesCents: number;
  junkFeeItems?: unknown;
}) {
  const items = normalizeJunkFeeItems(input.junkFeeItems);
  for (const item of items) {
    if (item.amountCents < 0) {
      throw new Error(`Fee "${item.name}" cannot be negative`);
    }
  }
  const itemsCents = feeItemsTotalCents(items);
  const expected = input.vehiclePriceCents + input.taxCents + input.feesCents + itemsCents;
  if (Math.abs(input.otdPriceCents - expected) > OTD_SUM_TOLERANCE_CENTS) {
    throw new Error(
      `OTD breakdown mismatch: components sum to ${expected} cents but otdPriceCents is ${input.otdPriceCents}`,
    );
  }
}
