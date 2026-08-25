// lib/services/offer/dealer-display.ts — Batch 4
//
// Buyer-facing dealer label for a Deal's accepted Offer. After Batch 4 a
// concierge deal points at a real canonical Offer whose `dealer` is the system
// Outside-Dealer placeholder ("AutoLenis Outside Dealer System") — an INTERNAL
// string that must never reach a buyer. This resolves the honest, buyer-safe
// name:
//   1. a real registered dealer  → its dealershipName
//   2. the placeholder + a known external seller → the external name
//   3. otherwise (placeholder w/o external identity, or no offer) → "AutoLenis Concierge"

export const CONCIERGE_DEALER_LABEL = "AutoLenis Concierge";

export interface BuyerFacingOfferDealer {
  externalDealerName?: string | null;
  dealer?: {
    dealershipName?: string | null;
    isSystemPlaceholder?: boolean | null;
  } | null;
}

/**
 * The dealer name safe to show a buyer for a given accepted offer (or null offer).
 * Never returns the internal Outside-Dealer placeholder name.
 */
export function buyerFacingDealerName(offer: BuyerFacingOfferDealer | null | undefined): string {
  if (!offer) return CONCIERGE_DEALER_LABEL;
  const isPlaceholder = offer.dealer?.isSystemPlaceholder === true;
  if (!isPlaceholder && offer.dealer?.dealershipName) return offer.dealer.dealershipName;
  // Placeholder (or missing dealer): prefer a real external seller name, else concierge.
  const external = offer.externalDealerName?.trim();
  return external && external.length > 0 ? external : CONCIERGE_DEALER_LABEL;
}
