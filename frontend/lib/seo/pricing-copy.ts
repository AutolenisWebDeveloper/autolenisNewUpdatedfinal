// AutoLenis — Canonical pricing copy (WO-5 / D8).
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for every visible pricing phrase AND its structured-data
// twin. The site previously described the $99 three contradictory ways
// (refundable deposit / refundable fee-not-deposit / non-refundable fee), which
// mismatched the live refund.service.ts and the $400 economics and created an
// FTC consistency exposure. All pricing copy + JSON-LD must now reference this
// module so visible text and schema can never drift.
//
// Owner-confirmed policy (2026-06):
//   • The $99 is an **Auction Access Fee** by default — paid before the auction
//     starts to activate the private 48-hour dealer auction. It is REFUNDABLE if
//     no valuable offer is received within the auction window.
//   • It is called a **deposit** ONLY if the buyer purchases the $499 Premium
//     package: then the $99 already paid is credited toward the $499 — $99
//     upfront, $400 due at closing.
//   • Standard buyers pay no concierge fee beyond the Auction Access Fee.
//
// Amounts are imported from lib/constants.ts (the canonical *_CENTS source) so a
// price change there flows through automatically. Never hardcode "$99/$499/$400".

import {
  DEPOSIT_AMOUNT_USD,
  PREMIUM_FEE_USD,
  PREMIUM_FEE_REMAINING_USD,
} from "@/lib/constants";

// ─── Labels & amounts ─────────────────────────────────────────────────────────
/** Canonical name for the $99 in the standard path. Never "deposit" by default. */
export const FEE_LABEL = "Auction Access Fee" as const;
export const FEE_AMOUNT = DEPOSIT_AMOUNT_USD; // "$99"
export const PREMIUM_AMOUNT = PREMIUM_FEE_USD; // "$499"
export const PREMIUM_REMAINING_AMOUNT = PREMIUM_FEE_REMAINING_USD; // "$400"
/** e.g. "$99 Auction Access Fee" */
export const FEE_LABEL_WITH_AMOUNT = `${FEE_AMOUNT} ${FEE_LABEL}` as const;

// ─── Canonical sentences (visible copy === schema copy) ───────────────────────
export const PRICING_COPY = {
  feeLabel: FEE_LABEL,
  feeAmount: FEE_AMOUNT,
  premiumAmount: PREMIUM_AMOUNT,
  premiumRemaining: PREMIUM_REMAINING_AMOUNT,

  /** What the fee is (standard path). */
  whatItIs: `A one-time ${FEE_AMOUNT} ${FEE_LABEL}, paid before your auction starts, activates your private 48-hour dealer auction.`,

  /** Refundability — short badge/label form. */
  refundShort: "Refundable if no valuable offer is received",

  /** Refundability — full sentence. */
  refundLong: `Your ${FEE_AMOUNT} ${FEE_LABEL} is refundable if no valuable offer is received within your auction window.`,

  /** The deposit/credit mechanics — Premium path only. */
  depositConditional: `If you upgrade to the ${PREMIUM_AMOUNT} Premium package, your ${FEE_AMOUNT} ${FEE_LABEL} becomes a deposit credited toward it — ${FEE_AMOUNT} upfront, ${PREMIUM_REMAINING_AMOUNT} due at closing.`,

  /** One-sentence legal-tone short form. */
  legalShort: `${FEE_AMOUNT} ${FEE_LABEL} (refundable if no valuable offer is received); credited toward the ${PREMIUM_AMOUNT} Premium package only if Premium is purchased — ${FEE_AMOUNT} upfront, ${PREMIUM_REMAINING_AMOUNT} at closing.`,

  /** Full long-form sentence combining identity + refund + deposit conditionality. */
  sentenceLong: `A one-time ${FEE_AMOUNT} ${FEE_LABEL} activates your private 48-hour dealer auction and is refundable if no valuable offer is received. If you upgrade to the ${PREMIUM_AMOUNT} Premium package, the ${FEE_AMOUNT} becomes a deposit credited toward it — ${FEE_AMOUNT} upfront, ${PREMIUM_REMAINING_AMOUNT} due at closing.`,

  /** Premium package summary. */
  premiumSummary: `${PREMIUM_AMOUNT} Premium concierge package — full white-glove service. Your ${FEE_AMOUNT} ${FEE_LABEL} is credited toward it, leaving ${PREMIUM_REMAINING_AMOUNT} due at closing.`,
} as const;

// ─── Structured-data offer descriptions (must equal visible copy above) ───────
// Used by lib/seo/jsonld.tsx (pricingSchema) and lib/seo/entity-graph.ts offers
// so Google sees the same statements buyers see.
export const PRICING_SCHEMA = {
  /** Free-tier Product description. */
  freeTierDescription: `Reverse auction activated by a one-time ${FEE_AMOUNT} ${FEE_LABEL}, refundable if no valuable offer is received, with full Contract Shield protection.`,

  /** $99 Offer / PriceSpecification description. */
  feeOfferDescription: `One-time ${FEE_AMOUNT} ${FEE_LABEL} that activates a private 48-hour dealer auction. Refundable if no valuable offer is received. Becomes a deposit credited toward the ${PREMIUM_AMOUNT} Premium package only if Premium is purchased.`,

  /** $499 Premium Offer description. */
  premiumOfferDescription: `${PREMIUM_AMOUNT} Premium concierge package covering dedicated specialist, full negotiation, paperwork handling, and delivery. The ${FEE_AMOUNT} ${FEE_LABEL} is credited toward it — ${FEE_AMOUNT} upfront, ${PREMIUM_REMAINING_AMOUNT} due at closing.`,
} as const;
