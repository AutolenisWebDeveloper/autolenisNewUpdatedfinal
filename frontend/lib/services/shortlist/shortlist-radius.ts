// lib/services/shortlist/shortlist-radius.ts
//
// The single gate deciding what ACTION a listing card offers. It never decides whether the
// card is rendered.
//
// Transaction-flow spec s22a: the catalogue is swept on a schedule and served from
// inventory_items, and no buyer action triggers a third-party API call. Two ceilings exist and
// they are deliberately different:
//
//   SHORTLIST is inventory-backed and capped at 100 miles, because that is the data provider's
//     radius restriction -- we simply have no catalogue beyond it.
//   SOURCING is rooftop-backed (dealer_rooftops), runs its own radius ladder, and is NOT bounded
//     by this constant. See lib/services/auction/coverage.service.ts. Nothing here may be
//     imported there, and this file deliberately imports nothing from lib/services/inventory --
//     the provider cap must not leak into a path that does not answer to the provider.
//
// The previous behaviour was the inverse of this design: the public catalogue applied
// `?zip=&radiusMiles=` as a WHERE and dropped every row outside it (and every row with null
// coordinates, which -- since the adapter never wrote any -- was all of them). Distance is a
// label and a sort order here, never a filter.

import { haversineMiles } from "@/lib/utils/zip-coords";

/** The data provider's radius restriction. Shortlist only; sourcing is not bound by it. */
export const SHORTLIST_RADIUS_MILES = 100;

/** Not seen in this long -> show a stale flag. Display-level warning; the action survives. */
export const STALE_FLAG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Not seen in this long -> no longer shortlist-eligible. The card still renders. */
export const SHORTLIST_FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type Freshness = "FRESH" | "STALE" | "EXPIRED";

/** What the card offers. Never "hidden" -- that is not one of the outcomes. */
export type ShortlistAction = "ADD" | "REQUEST_SIMILAR" | "NEED_ZIP";

export type GateReason =
  | "OK"
  | "NO_ZIP"
  | "OUT_OF_RADIUS"
  | "DISTANCE_UNKNOWN"
  | "STALE_LISTING"
  | "UNAVAILABLE";

export interface ListingGateFacts {
  /** Miles from the buyer. `null` = the listing could not be placed on the map. */
  distanceMiles: number | null;
  isActive: boolean;
  priceCents: number;
  lastSeenAt: Date | null;
  lane: string;
  dealerId: string | null;
  addedByAdminId: string | null;
}

export interface GateContext {
  /** Whether we know where the buyer is. Without it no distance judgement is possible. */
  hasZip: boolean;
}

export interface GateResult {
  /**
   * Always true. Present as a field, and asserted by test, because "hide nothing" is the whole
   * point of the feature and a future edit that starts returning false should fail loudly
   * rather than quietly emptying the catalogue.
   */
  visible: true;
  action: ShortlistAction;
  reason: GateReason;
  freshness: Freshness;
}

/**
 * A row with no feed behind it can never be "re-seen", so the freshness windows are meaningless
 * for it: dealer-MANAGED inventory (LANE_1 *and* a real dealerId) and admin-entered vehicles.
 *
 * The LANE_1 label alone is NOT the invariant. It is mutable and was written without a dealer by
 * a 2026-06-23 admin bulk action, leaving 95 production rows that would otherwise read as
 * forever-fresh here exactly as they read as forever-protected in the stale sweep. Kept in
 * lock-step with isExecutableSupply() and staleSweepWhere().
 */
function exemptFromFreshness(f: Pick<ListingGateFacts, "lane" | "dealerId" | "addedByAdminId">): boolean {
  return (f.lane === "LANE_1" && f.dealerId != null) || f.addedByAdminId != null;
}

/** Age of the listing's last sighting. A never-seen row is EXPIRED, never FRESH. */
export function freshnessOf(lastSeenAt: Date | null | undefined, now: Date = new Date()): Freshness {
  if (lastSeenAt == null) return "EXPIRED";
  const age = now.getTime() - lastSeenAt.getTime();
  if (age >= SHORTLIST_FRESHNESS_WINDOW_MS) return "EXPIRED";
  if (age >= STALE_FLAG_WINDOW_MS) return "STALE";
  return "FRESH";
}

/**
 * Decide the card's action. Order matters:
 *
 *  1. No ZIP outranks everything -- we cannot judge distance, so we ask rather than guess.
 *  2. Availability, then freshness, then radius. All three failure modes land on the same
 *     "Find one like this near me" route, so a dead end never appears anywhere.
 */
export function shortlistGate(
  facts: ListingGateFacts,
  ctx: GateContext,
  now: Date = new Date(),
): GateResult {
  const freshness = exemptFromFreshness(facts) ? "FRESH" : freshnessOf(facts.lastSeenAt, now);
  const base = { visible: true as const, freshness };

  if (!ctx.hasZip) return { ...base, action: "NEED_ZIP", reason: "NO_ZIP" };

  if (!facts.isActive || !(facts.priceCents > 0)) {
    return { ...base, action: "REQUEST_SIMILAR", reason: "UNAVAILABLE" };
  }
  if (freshness === "EXPIRED") {
    return { ...base, action: "REQUEST_SIMILAR", reason: "STALE_LISTING" };
  }
  // Fail CLOSED on an unplaceable listing: unprovable proximity is not proven proximity, and
  // shortlisting one would put a car we cannot reach into a 100-mile-scoped auction.
  if (facts.distanceMiles == null) {
    return { ...base, action: "REQUEST_SIMILAR", reason: "DISTANCE_UNKNOWN" };
  }
  if (facts.distanceMiles > SHORTLIST_RADIUS_MILES) {
    return { ...base, action: "REQUEST_SIMILAR", reason: "OUT_OF_RADIUS" };
  }
  return { ...base, action: "ADD", reason: "OK" };
}

// ── distance ────────────────────────────────────────────────────────────────

/**
 * Miles from the buyer to a listing, or `null` when either end cannot be placed.
 *
 * Prisma returns lat/lng as Decimal, and a listing that has never been geocoded carries null on
 * both — which was every ingested row until the adapter started writing the dealer's
 * coordinates. `null` here means "unknown", never "far": the gate decides what to do about it.
 */
export function distanceMilesBetween(
  buyer: { lat: number; lng: number } | null,
  lat: unknown,
  lng: unknown,
): number | null {
  if (!buyer) return null;
  const n = (v: unknown): number | null => {
    const x = typeof v === "number" ? v : v == null ? null : Number(v);
    return x != null && Number.isFinite(x) ? x : null;
  };
  const la = n(lat);
  const lo = n(lng);
  if (la === null || lo === null) return null;
  return haversineMiles(buyer, { lat: la, lng: lo });
}

// ── whole-catalogue gating ──────────────────────────────────────────────────

/** The columns a catalogue row must carry for the gate to judge it. */
export interface CatalogueRow {
  id: string;
  latitude: unknown;
  longitude: unknown;
  isActive: boolean;
  priceCents: number;
  lastSeenAt: Date | null;
  lane: string;
  dealerId: string | null;
  addedByAdminId: string | null;
}

export interface GatedRow<T> {
  row: T;
  /** Miles, rounded to one decimal for display. `null` when either end is unplaceable. */
  distanceMiles: number | null;
  gate: GateResult;
}

export interface GatedCatalogue<T> {
  gated: GatedRow<T>[];
  /** How many rows the buyer could actually shortlist. Drives the empty state — never the grid. */
  inRadiusCount: number;
  hasZip: boolean;
}

/**
 * Attach a distance and an action to every row, and order them nearest-first.
 *
 * The row count out ALWAYS equals the row count in. This function has no filter and must never
 * grow one: the page it feeds used to drop out-of-radius rows and rows with null coordinates,
 * and because the adapter had never written a coordinate that meant a buyer who typed a ZIP saw
 * an empty grid over a catalogue of 148 cars.
 *
 * `inRadiusCount` is how the page decides to LEAD with the custom-request path when nothing is
 * reachable — the catalogue still renders underneath as examples.
 */
export function gateCatalogue<T extends CatalogueRow>(
  rows: T[],
  buyerCoords: { lat: number; lng: number } | null,
  now: Date = new Date(),
): GatedCatalogue<T> {
  const hasZip = buyerCoords !== null;

  const gated: GatedRow<T>[] = rows.map((row) => {
    const raw = distanceMilesBetween(buyerCoords, row.latitude, row.longitude);
    const distanceMiles = raw === null ? null : Math.round(raw * 10) / 10;
    return {
      row,
      distanceMiles,
      gate: shortlistGate(
        {
          distanceMiles,
          isActive: row.isActive,
          priceCents: row.priceCents,
          lastSeenAt: row.lastSeenAt,
          lane: row.lane,
          dealerId: row.dealerId,
          addedByAdminId: row.addedByAdminId,
        },
        { hasZip },
        now,
      ),
    };
  });

  // Nearest-first only when we know where the buyer is. Unplaceable rows sort last — they are
  // still present, just not rankable against a distance.
  if (hasZip) {
    gated.sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY));
  }

  return {
    gated,
    inRadiusCount: gated.reduce((n, g) => n + (g.gate.action === "ADD" ? 1 : 0), 0),
    hasZip,
  };
}
