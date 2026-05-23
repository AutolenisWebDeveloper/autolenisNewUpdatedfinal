// lib/utils/buyer-budget.ts
// Anonymize a buyer's exact OTD budget into a coarse range so dealers see
// "what to bid against" without learning the exact ceiling. Used in dealer-
// facing API responses (never expose maxOtdAmountCents to dealers directly).

export interface BudgetRange {
  /** Lower bound of the range, in cents (inclusive). */
  minCents: number;
  /** Upper bound of the range, in cents (inclusive). */
  maxCents: number;
  /** Pre-formatted human-readable label, e.g. "$30,000 – $35,000". */
  label: string;
}

// 5k buckets — fine enough to be useful, coarse enough to anonymize.
const BUCKET_CENTS = 5_000_00;

export function bucketBudgetCents(otdCents: number): BudgetRange {
  if (!Number.isFinite(otdCents) || otdCents <= 0) {
    return { minCents: 0, maxCents: 0, label: "Not specified" };
  }
  const minCents = Math.floor(otdCents / BUCKET_CENTS) * BUCKET_CENTS;
  const maxCents = minCents + BUCKET_CENTS;
  const fmt = (c: number) =>
    `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return { minCents, maxCents, label: `${fmt(minCents)} – ${fmt(maxCents)}` };
}
