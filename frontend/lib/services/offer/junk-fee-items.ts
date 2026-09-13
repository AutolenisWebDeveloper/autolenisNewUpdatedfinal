// lib/services/offer/junk-fee-items.ts
//
// ONE INTEGER-CENTS UNIT FOR `offers.junk_fee_items`, END TO END (Phase 6, §8.2 defect 1).
//
// THE DEFECT. `offers.junk_fee_items` is an untyped `Json` column holding `{ name, amount }`, and
// the two readers disagreed by a factor of 100:
//
//   otd.ts:31               `sum + Math.round(item.amount * 100)`  — amount is DOLLARS
//   best-price.service:64   `s + f.amount` into `junkFeesCents`    — amount is CENTS
//
// The dealer UI sends dollars (`amount: f.amountCents / 100`) and the only test pinned dollars, so
// `best-price.service.ts` was the wrong side and every junk-fee ranking was understated 100-fold.
// CLAUDE.md golden rule 4 — "money is integer minor units" — settles the direction: cents.
//
// THE REVERSIBLE TRANSFORM (§8.2 Phase 6 rollback). The correction carries a data backfill, and it
// is written so a revert restores the prior representation: the canonical key is `amountCents`,
// and the DOLLARS pre-image stays in the same row under `amount` until Phase 10 retires it. A
// reverted deployment reads `amount` and finds exactly what it wrote. Nothing is destroyed, so the
// backfill needs no down-migration of its own.
//
// Production holds ZERO `offers` rows, so the backfill is provably a no-op there today. It is
// written correctly anyway: CI replays the chain against an empty database, the loopback proof
// seeds rows to exercise both directions, and the legacy stores (`vehicle_offers` 6 rows,
// `dealer_offer_submissions` 2) will write through this module once their intake is consolidated.
//
// THREE SHAPES EXIST IN THE WILD and `normalize` accepts all three, because a backfill that
// assumed one shape would silently drop the others:
//
//   { name,  amount }       dealer + revise routes, and the legacy JSON        — DOLLARS
//   { label, amount }       `app/api/admin/offers/route.ts:72` validates this  — DOLLARS
//   { name,  amountCents }  canonical, written from here on                    — CENTS
//
// The `label` variant is not hypothetical: the admin route's zod schema names it, and `otd.ts:27`
// reads `item.name` when rejecting a negative fee — which is `undefined` for an admin-shaped row,
// so the error message named no fee at all.

import { z } from "zod";

/** The canonical stored shape. `amount` is the retained dollars pre-image, not a second source of truth. */
export interface JunkFeeItem {
  name: string;
  /** Integer minor units. The ONLY value any reader may do arithmetic on. */
  amountCents: number;
  /**
   * Server-stamped by `detectJunkFees`. Absent on legacy rows, which is why readers treat
   * `undefined` as "unclassified" rather than as `false` — an unclassified fee that a pattern
   * would have caught must not be silently excluded from the junk-fee ranking dimension.
   */
  isJunk?: boolean;
  /**
   * PRE-IMAGE, dollars, retained until Phase 10 so a revert restores the prior representation.
   * Never read for arithmetic. Present only on rows that carried it before the transform, and on
   * rows this module writes.
   */
  amount?: number;
}

/** Anything a writer or a stored row might hand us, including the two legacy shapes. */
type RawFeeItem = {
  name?: unknown;
  label?: unknown;
  amount?: unknown;
  amountCents?: unknown;
  isJunk?: unknown;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Normalise one item to canonical cents, retaining the dollars pre-image.
 *
 * `amountCents` wins when present: a row already transformed must not be re-multiplied, which is
 * what makes the backfill idempotent and safe to re-run.
 */
function normalizeOne(raw: RawFeeItem): JunkFeeItem | null {
  const name =
    typeof raw.name === "string" && raw.name.trim() !== ""
      ? raw.name
      : typeof raw.label === "string" && raw.label.trim() !== ""
        ? raw.label
        : null;
  if (name === null) return null;

  if (isFiniteNumber(raw.amountCents)) {
    const item: JunkFeeItem = { name, amountCents: Math.round(raw.amountCents) };
    if (isFiniteNumber(raw.amount)) item.amount = raw.amount;
    if (typeof raw.isJunk === "boolean") item.isJunk = raw.isJunk;
    return item;
  }

  if (isFiniteNumber(raw.amount)) {
    const item: JunkFeeItem = {
      name,
      amountCents: Math.round(raw.amount * 100),
      amount: raw.amount, // pre-image retained in the same row
    };
    if (typeof raw.isJunk === "boolean") item.isJunk = raw.isJunk;
    return item;
  }

  return null;
}

/**
 * Normalise a stored or submitted list. Unparseable entries are DROPPED rather than coerced to
 * zero: a fee whose amount cannot be read is not a fee worth zero, and silently zeroing it would
 * make the OTD assertion pass on a breakdown nobody can justify.
 */
export function normalizeJunkFeeItems(raw: unknown): JunkFeeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry && typeof entry === "object" ? normalizeOne(entry as RawFeeItem) : null))
    .filter((x): x is JunkFeeItem => x !== null);
}

/** Total of every item, in cents. Used by the OTD assertion, where classification is irrelevant. */
export function feeItemsTotalCents(items: JunkFeeItem[]): number {
  return items.reduce((sum, item) => sum + item.amountCents, 0);
}

/**
 * Total of the items that are junk, in cents — the Best Price ranking dimension.
 *
 * `isJunk === undefined` counts as JUNK. These are pre-classification rows, and the column is
 * named `junk_fee_items`: everything a writer put there was intended as a junk fee before the
 * server started classifying. Treating unknown as not-junk would quietly zero the ranking
 * dimension for every legacy row instead of degrading honestly.
 */
export function junkFeeTotalCents(items: JunkFeeItem[]): number {
  return items.filter((i) => i.isJunk !== false).reduce((sum, item) => sum + item.amountCents, 0);
}

/**
 * The dollars pre-image of a canonical list — what a reverted deployment would read.
 *
 * Exists so the revert path is testable rather than merely asserted. `otd.ts` before this phase
 * computed `Math.round(amount * 100)`, so round-tripping must return the same cents.
 */
export function toPreImageDollars(items: JunkFeeItem[]): Array<{ name: string; amount: number }> {
  return items.map((i) => ({
    name: i.name,
    amount: i.amount ?? i.amountCents / 100,
  }));
}

// ── The wire schema ─────────────────────────────────────────────────────────────────────────────
//
// Defined HERE, beside `normalizeJunkFeeItems`, because the three accepted shapes are one fact and
// three routes were each asserting their own version of it — which is how `app/api/admin/offers`
// came to validate `{ label, amount }` while every other writer used `{ name, amount }`, and how
// `otd.ts` came to print `undefined` when rejecting a negative admin-shaped fee.
//
// Accepts all three shapes. `normalizeJunkFeeItems` is still the thing that converts; this only
// keeps malformed input out of it.

export const feeItemSchema = z
  .object({
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    amount: z.number().finite().optional(),
    amountCents: z.number().int().optional(),
    isJunk: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.label !== undefined, {
    message: "Each fee item needs a name",
  })
  .refine((v) => v.amount !== undefined || v.amountCents !== undefined, {
    message: "Each fee item needs an amount (amountCents preferred; amount is the legacy dollars form)",
  });

export const feeItemsSchema = z.array(feeItemSchema);
