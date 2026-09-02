// lib/services/shortlist/shortlist-availability.ts
//
// A shortlist entry can outlive the vehicle it points at.
//
// ShortlistItem.inventoryItemId is a plain string with NO foreign key, and the stale sweep
// deactivates listings the market has moved on from. As of 2026-09-02, 10 of the 15 rows in
// production point at inventory the corrected sweep will deactivate — and the shortlist page
// filtered those items out entirely, so a buyer's saved car simply vanished, or (when the row
// still existed) rendered a live-looking card linking to a page that 404s.
//
// The rule this module implements: an unavailable item stays VISIBLE and is EXCLUDED from the
// request. It does not consume one of the five candidate slots, does not satisfy the auction
// activation gate, and cannot be carried into an auction — but the buyer still sees it, is
// told plainly that it is gone, and is offered a route forward: a Vehicle Request pre-filled
// from what they had chosen, so a dead listing becomes a live search instead of a dead end.

/** The inventory facts availability depends on. `null` models a row that no longer exists. */
export interface ShortlistInventoryFacts {
  isActive: boolean;
  priceCents: number;
}

export function isShortlistItemAvailable(inv: ShortlistInventoryFacts | null | undefined): boolean {
  if (!inv) return false;          // the referenced InventoryItem is gone (no FK to stop that)
  if (!inv.isActive) return false; // stale-swept or archived
  if (!(inv.priceCents > 0)) return false; // unquotable — nothing to take to auction
  return true;
}

export function countAvailable<T>(items: T[], available: (item: T) => boolean): number {
  return items.reduce((n, item) => n + (available(item) ? 1 : 0), 0);
}

// ── "Find one like this near me" ─────────────────────────────────────────────

/** The mileage stops the vehicle-request form offers. Must stay in lock-step with
 *  MILEAGE_STOPS in app/buyer/requests/new/page.tsx (pinned by test). */
export const MILEAGE_STOPS = ["25k", "50k", "75k", "100k", "Any"] as const;
export type MileageBand = (typeof MILEAGE_STOPS)[number];

const MILEAGE_BAND_MAX: Array<[MileageBand, number]> = [
  ["25k", 25_000], ["50k", 50_000], ["75k", 75_000], ["100k", 100_000],
];

/**
 * The smallest offered band that still contains this odometer reading.
 *
 * A band, not the exact figure: the buyer wanted a car *like* this one, and pinning their
 * search to 62,431 miles would exclude the obvious alternatives.
 */
export function mileageBandFor(mileage: number | null | undefined): MileageBand {
  if (mileage == null || !Number.isFinite(mileage) || mileage < 0) return "Any";
  for (const [band, max] of MILEAGE_BAND_MAX) {
    if (mileage <= max) return band;
  }
  return "Any";
}

/**
 * A budget band above the asking price, in integer cents.
 *
 * +10%, rounded UP to the nearest $1,000. The car they picked is gone, so quoting its exact
 * price as a ceiling would systematically exclude every comparable replacement — the market
 * has moved, and the listing they liked was by definition still on the market when they
 * saved it.
 */
export function priceBandCentsFor(priceCents: number | null | undefined): number | null {
  if (priceCents == null || !Number.isFinite(priceCents) || priceCents <= 0) return null;
  const withHeadroom = priceCents * 1.1;
  const thousandInCents = 100_000;
  return Math.ceil(withHeadroom / thousandInCents) * thousandInCents;
}

export interface SimilarVehicleSeed {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  mileage?: number | null;
  priceCents: number;
}

/**
 * Query keys accepted by /buyer/requests/new. Every key emitted below MUST appear here AND
 * be read by that page's hydration effect — a rename on either side silently produces an
 * empty form, which looks like the feature working. Pinned by test against the page source.
 */
export const REQUEST_PREFILL_KEYS = [
  "makePreference", "modelPreference", "trim", "yearMin", "yearMax", "maxMileage", "maxBudgetCents",
] as const;

/**
 * A pre-filled Vehicle Request for a vehicle that is no longer available.
 *
 * Year is widened to a +/-1 window for the same reason the price is banded: an exact-year
 * filter on a car that has already sold is a filter that matches nothing.
 */
export function buildSimilarRequestHref(v: SimilarVehicleSeed): string {
  const params = new URLSearchParams();
  params.set("makePreference", v.make);
  params.set("modelPreference", v.model);
  if (v.trim) params.set("trim", v.trim);
  params.set("yearMin", String(v.year - 1));
  params.set("yearMax", String(v.year + 1));
  params.set("maxMileage", mileageBandFor(v.mileage));
  const band = priceBandCentsFor(v.priceCents);
  if (band !== null) params.set("maxBudgetCents", String(band));
  return `/buyer/requests/new?${params.toString()}`;
}
