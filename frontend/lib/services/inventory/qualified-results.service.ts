// lib/services/inventory/qualified-results.service.ts
//
// THE LIVE, PREQUAL-GATED BUYER SEARCH (§22a; §8.2 Phase 4).
//
// This is not the public catalogue. `app/(public)/inventory` reads the swept `inventory_items`
// table and is open to anyone; this asks the provider a question shaped by ONE buyer's approval
// — their location, their approved amount, their condition and criteria — and it costs a call
// from the same monthly ledger the daily sweep spends from.
//
// FIVE PROPERTIES, each of which the repository has got wrong somewhere:
//
//   1. A PROVIDER FAILURE IS NEVER AN EMPTY MARKET. §22a L1079. "No cars near you" is a claim
//      about the world; "we could not reach the market" is a claim about us. The outcome
//      enum keeps them apart and `marketKnown` is the flag a surface must read before it
//      writes the word "none". A ZERO_RESULTS run is a real, reportable empty market — the
//      distinction only works because both exist.
//   2. THE 100-MILE CEILING IS AUTOLENIS POLICY. It comes from
//      `shortlist-radius.SHORTLIST_RADIUS_MILES` and reaches the provider as a parameter
//      DERIVED from policy. It is deliberately NOT `inventory_sources.radius_miles` (that
//      governs the sweep) and deliberately NOT whatever the plan happens to allow. If the plan
//      allows less, the provider says so and the run FAILS loudly — that is an operations
//      problem to surface, never a licence to quietly search a smaller circle.
//   3. THE SYSTEM NEVER AUTO-SAVES TO THE SHORTLIST. This service writes no buyer-owned row.
//      It returns an ACTION per card and the buyer takes it, or does not.
//   4. AN UNQUALIFIED OR UNPLACEABLE BUYER SPENDS ZERO CALLS. Both gates run before the
//      ledger is touched.
//   5. LANE 2/3 DEALER IDENTITY NEVER REACHES A BUYER CARD. The normalized vehicle carries the
//      dealership's name, phone, email and listing URL; `toCard` does not copy them. The car's
//      city and state DO travel, because a distance with no place attached is not legible.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   * R58's over-ceiling flag ("this is $X above your approved amount"). Owner ruling
//     2026-09-10: an assumed tax rate producing a number a buyer reads as real is a claim we
//     cannot support. DEFERRED with that reason. The headroom below is a SEARCH ceiling, not a
//     statement to the buyer about affordability.
//   * Any write to `auction_vehicles` or `shortlist_items`. Candidates are Stage 4's, and they
//     are the buyer's choice.

import crypto from "node:crypto";
import { InventorySourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { MarketCheckAdapter } from "./adapters/marketcheck.adapter";
import type { AdapterRunResult, NormalizedVehicle, SearchParams, StopReason } from "./adapters/IInventoryAdapter";
import { resolveMarketConfig } from "./inventory-source-config.service";
import { cycleKeyFor, rollCycleForward, makeCallBudget, makeStaticBudget } from "./inventory-call-budget.service";
import {
  SHORTLIST_RADIUS_MILES, shortlistGate, distanceMilesBetween,
  type Freshness, type GateReason, type ShortlistAction,
} from "@/lib/services/shortlist/shortlist-radius";
import { lookupCity, type LatLng } from "@/lib/utils/zip-coords";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";

/**
 * §13-D16, owner ruling 2026-09-10. The search ceiling is the approved out-the-door amount
 * plus 10%: an approval is a financing number, and the sticker price a buyer negotiates from
 * sits below the out-the-door total by tax, title and fees. Filtering at the bare approved
 * amount hides cars the buyer can actually transact on; filtering with no ceiling shows cars
 * they cannot. 1.10 is generous enough to cover the gap without pretending to compute it.
 */
export const APPROVED_AMOUNT_HEADROOM = 1.1;

/** One call per buyer search. 50 rows is the provider's page maximum. */
export const QUALIFIED_RESULTS_MAX_CALLS = 1;
export const QUALIFIED_RESULTS_ROWS = 50;

/**
 * Fewer in-radius cars than this and the surface LEADS with the custom-request path. The
 * results still render underneath — this is not a filter. The number is a judgement call, not
 * a cited requirement: §22a says "thin or zero results offer the request path" and does not
 * define thin.
 */
export const THIN_RESULTS_THRESHOLD = 3;

/** How long a cached provider answer may be served. Only read when the cache is enabled. */
export const QUERY_CACHE_TTL_MS = 15 * 60 * 1000;

export type QualifiedOutcome =
  | "OK"
  | "NEED_ZIP"
  | "NOT_QUALIFIED"
  | "NOT_CONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "BUDGET_EXHAUSTED";

export interface QualifiedCriteria {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  milesMax?: number;
  /** "used" | "new" | "certified". Absent means no condition preference expressed. */
  condition?: string;
  priceMinCents?: number;
}

/** What a buyer sees. Deliberately narrower than NormalizedVehicle — see property 5. */
export interface QualifiedCard {
  sourceKey: string;
  vin?: string;
  /**
   * The `inventory_items` row this listing corresponds to, matched on VIN, or null when the
   * sweep has not ingested it yet.
   *
   * PROPERTY 6, and it was found by writing the surface rather than by reading the spec. A
   * live provider result is not a row in our catalogue: `shortlist_items.inventory_item_id`
   * is a foreign key with RESTRICT, `auction_vehicles` points at the same table, and an
   * auction is run against a listing we hold. So a card we cannot resolve to a row CANNOT be
   * shortlisted, however near and fresh it is — it gets the request path instead, which is
   * the honest offer: we will go and get that car rather than pretend we already have it.
   *
   * Minting the row here instead would be a second write path into `inventory_items`, which
   * §8.2 reserves for the canonical ingestion service (match-then-mint), so it is not done.
   */
  inventoryItemId: string | null;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage?: number;
  priceCents: number;
  images: string[];
  /** The car's own location. Not the dealership's identity. */
  city?: string;
  state?: string;
  distanceMiles: number | null;
  freshness: Freshness;
  action: ShortlistAction;
  /** `NOT_IN_CATALOGUE` is this service's own reason; the rest are the gate's. */
  reason: GateReason | "NOT_IN_CATALOGUE";
  /** Provider staleness signals, surfaced because §22a puts freshness on every card. */
  daysOnLot?: number;
  providerLastSeenAt?: Date;
}

export interface QualifiedResultsView {
  outcome: QualifiedOutcome;
  cards: QualifiedCard[];
  /** How many the buyer could actually shortlist. Drives the empty state, never the grid. */
  inRadiusCount: number;
  hasZip: boolean;
  /** LEAD with the custom-request path: thin, empty, or we could not see the market. */
  offerRequestPath: boolean;
  /**
   * FALSE means we do not know what is out there — a failure, a deferral, a partial walk, or
   * a spend we declined. A surface must never render "no vehicles found" when this is false.
   */
  marketKnown: boolean;
  approvedAmountCents: number | null;
  priceCeilingCents: number | null;
  headroom: number;
  radiusMiles: number;
  zip: string | null;
  provider: {
    outcome: string | null;
    error?: string;
    stopReason?: StopReason | null;
    apiCallsUsed: number;
    numFound: number | null;
    outOfRadiusDropped?: number;
  };
  cache: { enabled: boolean; hit: boolean; key: string | null };
}

export interface QualifiedResultsDeps {
  /** Injected so the service can be exercised without a provider. */
  search?: (params: SearchParams) => Promise<AdapterRunResult>;
  /** Injected so the service can be exercised without the geocoder's cache or Google. */
  geocode?: (zip: string) => Promise<LatLng | null>;
  now?: Date;
}

/**
 * §13-D8 — the MarketCheck terms question — is UNANSWERED. Caching the provider's own listing
 * payload is exactly what those terms govern, so the cache is built and left OFF: answering D8
 * is a flag flip, not a rewrite.
 *
 * The TABLE is not new and needs no migration: `inventory_query_cache` (criteria_hash unique,
 * params, result, num_found, fetched_at, expires_at) already exists in production's physical
 * schema and had zero readers and zero writers before this service.
 */
export function isQueryCacheEnabled(): boolean {
  return (process.env.INVENTORY_QUERY_CACHE ?? "").trim().toLowerCase() === "on";
}

/** Stable across key order and across runs. Anything that changes the ANSWER changes the key. */
export function criteriaHashFor(input: {
  zip: string;
  radiusMiles: number;
  priceCeilingCents: number;
  criteria: QualifiedCriteria;
}): string {
  const c = input.criteria;
  const canonical = JSON.stringify([
    input.zip,
    input.radiusMiles,
    input.priceCeilingCents,
    c.make ?? null, c.model ?? null,
    c.yearMin ?? null, c.yearMax ?? null,
    c.milesMax ?? null, c.condition ?? null, c.priceMinCents ?? null,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Where the buyer is. Coordinates first; a ZIP we cannot place is not a location.
 *
 * Placing a ZIP goes through `geocodeZip` (static table -> cached Google result -> Google,
 * fail-closed), NOT through `lookupZip` directly. The static table holds 128 ZIPs and does not
 * contain 76011 — the market production is actually configured for — so a direct lookup would
 * answer NEED_ZIP to a buyer who typed the correct ZIP for the market being swept, with no way
 * forward. Found by test, on this service's first run.
 */
async function placeBuyer(
  buyer: { zip: string | null; city: string | null; state: string | null; latitude: number | null; longitude: number | null } | null,
  suppliedZip: string | undefined,
  geocode: (zip: string) => Promise<LatLng | null>,
): Promise<{ coords: LatLng | null; zip: string | null }> {
  const supplied = (suppliedZip ?? "").trim();
  const stored = (buyer?.zip ?? "").trim();
  const validSupplied = /^\d{5}$/.test(supplied) ? supplied : null;
  const validStored = /^\d{5}$/.test(stored) ? stored : null;
  const validZip = validSupplied ?? validStored;

  // A supplied ZIP is the buyer telling us where to look, so it outranks a stored coordinate.
  if (validSupplied) {
    const c = await geocode(validSupplied);
    if (c) return { coords: c, zip: validSupplied };
  }
  if (buyer?.latitude != null && buyer?.longitude != null) {
    return { coords: { lat: buyer.latitude, lng: buyer.longitude }, zip: validZip };
  }
  if (validStored) {
    const c = await geocode(validStored);
    if (c) return { coords: c, zip: validStored };
  }
  // City/state is the last resort and is coarse; it is enough to rank by, and the gate still
  // fails closed on any listing whose own coordinates are missing.
  const byCity = lookupCity(buyer?.city ?? null, buyer?.state ?? null);
  return { coords: byCity, zip: validZip };
}

/** Provider-side staleness. We are seeing the listing now; the PROVIDER may not have. */
function lastSeenOf(v: NormalizedVehicle, fetchedAt: Date): Date {
  return v.providerLastSeenAt ?? fetchedAt;
}

function toCard(
  v: NormalizedVehicle,
  buyerCoords: LatLng | null,
  fetchedAt: Date,
  now: Date,
  inventoryItemId: string | null,
): QualifiedCard {
  const raw = distanceMilesBetween(buyerCoords, v.latitude, v.longitude);
  const distanceMiles = raw === null ? null : Math.round(raw * 10) / 10;
  const gate = shortlistGate(
    {
      distanceMiles,
      isActive: true,           // a live provider result is, by definition, currently listed
      priceCents: v.priceCents,
      lastSeenAt: lastSeenOf(v, fetchedAt),
      lane: "LANE_3",           // aggregator supply: never exempt from the freshness windows
      dealerId: null,
      addedByAdminId: null,
    },
    { hasZip: buyerCoords !== null },
    now,
  );
  // A card we cannot resolve to a catalogue row is never shortlistable, whatever the gate
  // says: there is no id to write, and inventing one would put a car into an auction that
  // nothing else in the system knows about.
  const unresolved = inventoryItemId === null;
  const action = unresolved ? ("REQUEST_SIMILAR" as const) : gate.action;
  const reason = unresolved && gate.action === "ADD" ? ("NOT_IN_CATALOGUE" as const) : gate.reason;

  return {
    sourceKey: v.sourceKey,
    vin: v.vin,
    inventoryItemId,
    year: v.year, make: v.make, model: v.model, trim: v.trim,
    mileage: v.mileage, priceCents: v.priceCents, images: v.images,
    city: v.city, state: v.state,
    distanceMiles,
    freshness: gate.freshness, action, reason,
    daysOnLot: v.daysOnLot,
    providerLastSeenAt: v.providerLastSeenAt,
  };
}

/**
 * Which of these listings do we already hold? Matched on VIN, which is the vehicle identity
 * key the whole ingestion pipeline uses. One query for the page, not one per card.
 */
async function resolveCatalogueIds(vehicles: NormalizedVehicle[]): Promise<Map<string, string>> {
  const vins = [...new Set(vehicles.map((v) => v.vin).filter((v): v is string => !!v))];
  if (vins.length === 0) return new Map();
  try {
    const rows = await prisma.inventoryItem.findMany({
      where: { vin: { in: vins } },
      select: { id: true, vin: true },
    });
    return new Map(rows.filter((r) => r.vin).map((r) => [r.vin as string, r.id]));
  } catch (e) {
    // Fail CLOSED: with no resolution every card offers the request path, which is a worse
    // experience but never a broken shortlist write.
    logger.warn("[qualified-results] catalogue resolution failed; every card falls back to the request path:", e);
    return new Map();
  }
}

/** JSON round-trips Dates to strings. A cache hit must rebuild them or freshness misreads. */
function reviveVehicles(raw: unknown): NormalizedVehicle[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const v = { ...(r as NormalizedVehicle) };
    const seen = (r as { providerLastSeenAt?: unknown }).providerLastSeenAt;
    v.providerLastSeenAt = typeof seen === "string" ? new Date(seen) : (seen as Date | undefined);
    return v;
  });
}

function emptyView(
  outcome: QualifiedOutcome,
  over: Partial<QualifiedResultsView> = {},
): QualifiedResultsView {
  return {
    outcome,
    cards: [],
    inRadiusCount: 0,
    hasZip: false,
    offerRequestPath: true,
    marketKnown: false,
    approvedAmountCents: null,
    priceCeilingCents: null,
    headroom: APPROVED_AMOUNT_HEADROOM,
    radiusMiles: SHORTLIST_RADIUS_MILES,
    zip: null,
    provider: { outcome: null, apiCallsUsed: 0, numFound: null },
    cache: { enabled: isQueryCacheEnabled(), hit: false, key: null },
    ...over,
  };
}

export async function getQualifiedResults(
  input: { buyerId: string; criteria?: QualifiedCriteria; zip?: string },
  deps: QualifiedResultsDeps = {},
): Promise<QualifiedResultsView> {
  const now = deps.now ?? new Date();
  const criteria = input.criteria ?? {};

  // ── GATE 1: approval. Before any location work and before any spend. ──────
  const prequal = (await prisma.preQualification.findUnique({
    where: { buyerId: input.buyerId },
    select: { decision: true, expiresAt: true, maxOtdAmountCents: true },
  })) as { decision: string; expiresAt: Date; maxOtdAmountCents: number } | null;

  if (!isPrequalValid(prequal)) return emptyView("NOT_QUALIFIED");

  const approvedAmountCents = prequal!.maxOtdAmountCents;
  const priceCeilingCents = Math.round(approvedAmountCents * APPROVED_AMOUNT_HEADROOM);

  // ── GATE 2: location. We ask rather than guess, and we spend nothing. ─────
  const buyer = (await prisma.buyer.findUnique({
    where: { id: input.buyerId },
    select: { zip: true, city: true, state: true, latitude: true, longitude: true },
  })) as { zip: string | null; city: string | null; state: string | null; latitude: number | null; longitude: number | null } | null;

  const geocode = deps.geocode ?? (async (z: string) => {
    const hit = await geocodeZip(z);
    return hit ? { lat: hit.lat, lng: hit.lng } : null;
  });
  const { coords, zip } = await placeBuyer(buyer, input.zip, geocode);
  if (!coords || !zip) {
    return emptyView("NEED_ZIP", { approvedAmountCents, priceCeilingCents });
  }

  const base = {
    approvedAmountCents, priceCeilingCents, zip, hasZip: true,
    radiusMiles: SHORTLIST_RADIUS_MILES, headroom: APPROVED_AMOUNT_HEADROOM,
  };

  // ── The cache seam. Keyed on everything that changes the ANSWER. ──────────
  const cacheEnabled = isQueryCacheEnabled();
  const key = criteriaHashFor({ zip, radiusMiles: SHORTLIST_RADIUS_MILES, priceCeilingCents, criteria });

  if (cacheEnabled) {
    try {
      const row = (await prisma.inventoryQueryCache.findUnique({ where: { criteriaHash: key } })) as
        | { result: unknown; numFound: number; fetchedAt: Date; expiresAt: Date | null }
        | null;
      if (row && row.expiresAt && row.expiresAt > now) {
        // The gate is recomputed, never cached: freshness moves with the clock and the buyer's
        // location is not part of what was stored.
        const cachedVehicles = reviveVehicles(row.result);
        return render(cachedVehicles, coords, new Date(row.fetchedAt), now, await resolveCatalogueIds(cachedVehicles), {
          ...base,
          provider: { outcome: "CACHED", apiCallsUsed: 0, numFound: row.numFound },
          cache: { enabled: true, hit: true, key },
        });
      }
    } catch (e) {
      // A cache defect must never take the search down with it.
      logger.warn("[qualified-results] cache read failed; falling through to live:", e);
    }
  }

  // ── The provider. One call, drawn from the SAME ledger the daily sweep uses. ──
  if (!process.env.MARKETCHECK_API_KEY) {
    return emptyView("NOT_CONFIGURED", { ...base, cache: { enabled: cacheEnabled, hit: false, key } });
  }

  const resolved = await resolveMarketConfig(InventorySourceType.MARKETCHECK, "MarketCheck");
  if (!resolved.ok) {
    // Covers the `is_active` kill switch, an unconfigured market and a config read error. In
    // every one of them the honest answer is that we did not look, not that nothing is there.
    return emptyView("NOT_CONFIGURED", { ...base, cache: { enabled: cacheEnabled, hit: false, key } });
  }

  let budget;
  if (resolved.config.sourceId && resolved.config.configSource === "row") {
    const cycleKey = cycleKeyFor(now);
    await rollCycleForward(resolved.config.sourceId, cycleKey);
    budget = makeCallBudget(resolved.config.sourceId, cycleKey, resolved.config.monthlyCallBudget, QUALIFIED_RESULTS_MAX_CALLS);
  } else {
    budget = makeStaticBudget(QUALIFIED_RESULTS_MAX_CALLS);
  }

  const search = deps.search ?? ((p: SearchParams) => new MarketCheckAdapter().search(p));
  const run = await search({
    zip,
    // POLICY, not the source row's radius and not the provider's plan limit. See property 2.
    radius: SHORTLIST_RADIUS_MILES,
    rowsPerCall: QUALIFIED_RESULTS_ROWS,
    maxCalls: QUALIFIED_RESULTS_MAX_CALLS,
    budget,
    make: criteria.make,
    model: criteria.model,
    yearMin: criteria.yearMin,
    yearMax: criteria.yearMax,
    milesMax: criteria.milesMax,
    carType: criteria.condition,
    priceMaxCents: priceCeilingCents,
    priceMinCents: criteria.priceMinCents,
    // Nearest first at the provider, so a single page is the nearest page rather than an
    // arbitrary one. The gate re-sorts on our own distance regardless.
    sortBy: "dist",
    sortOrder: "asc",
  });

  const providerFacts = {
    outcome: run.outcome,
    error: run.error,
    stopReason: run.stopReason ?? null,
    apiCallsUsed: run.apiCallsUsed ?? 0,
    numFound: run.numFound ?? null,
    outOfRadiusDropped: run.outOfRadiusDropped,
  };
  const cacheFacts = { enabled: cacheEnabled, hit: false, key };

  if (run.outcome === "BUDGET_EXHAUSTED") {
    return emptyView("BUDGET_EXHAUSTED", { ...base, provider: providerFacts, cache: cacheFacts });
  }
  if (run.outcome === "NOT_CONFIGURED") {
    return emptyView("NOT_CONFIGURED", { ...base, provider: providerFacts, cache: cacheFacts });
  }
  // A failed or deferred run that produced nothing is NOT an empty market.
  if ((run.outcome === "FAILED" || run.outcome === "DEFERRED") && run.vehicles.length === 0) {
    return emptyView("PROVIDER_UNAVAILABLE", { ...base, provider: providerFacts, cache: cacheFacts });
  }

  // PARTIAL — and FAILED/DEFERRED that still returned cars — keep the cars and refuse to claim
  // the market is known. Discarding good data is its own dishonesty.
  const marketKnown = run.outcome === "SUCCESS" || run.outcome === "ZERO_RESULTS";

  if (cacheEnabled && marketKnown) {
    try {
      const data = {
        id: key,
        criteriaHash: key,
        buyerId: input.buyerId,
        params: { zip, radiusMiles: SHORTLIST_RADIUS_MILES, priceCeilingCents, criteria } as object,
        result: run.vehicles as unknown as object,
        numFound: run.numFound ?? run.vehicles.length,
        fetchedAt: run.fetchedAt ?? now,
        expiresAt: new Date(now.getTime() + QUERY_CACHE_TTL_MS),
      };
      await prisma.inventoryQueryCache.upsert({
        where: { criteriaHash: key },
        create: data,
        update: { result: data.result, numFound: data.numFound, fetchedAt: data.fetchedAt, expiresAt: data.expiresAt, params: data.params },
      });
    } catch (e) {
      logger.warn("[qualified-results] cache write failed; the search is unaffected:", e);
    }
  }

  return render(run.vehicles, coords, run.fetchedAt ?? now, now, await resolveCatalogueIds(run.vehicles), {
    ...base, marketKnown, provider: providerFacts, cache: cacheFacts,
  });
}

function render(
  vehicles: NormalizedVehicle[],
  coords: LatLng,
  fetchedAt: Date,
  now: Date,
  catalogueIds: Map<string, string>,
  over: Partial<QualifiedResultsView> & { provider: QualifiedResultsView["provider"]; cache: QualifiedResultsView["cache"] },
): QualifiedResultsView {
  const cards = vehicles.map((v) => toCard(v, coords, fetchedAt, now, (v.vin && catalogueIds.get(v.vin)) || null));
  // Nearest first. Unplaceable cars sort last — present, just not rankable.
  cards.sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY));
  const inRadiusCount = cards.reduce((n, c) => n + (c.action === "ADD" ? 1 : 0), 0);
  const marketKnown = over.marketKnown ?? true;
  return {
    outcome: "OK",
    cards,
    inRadiusCount,
    hasZip: true,
    offerRequestPath: !marketKnown || inRadiusCount < THIN_RESULTS_THRESHOLD,
    marketKnown,
    approvedAmountCents: over.approvedAmountCents ?? null,
    priceCeilingCents: over.priceCeilingCents ?? null,
    headroom: APPROVED_AMOUNT_HEADROOM,
    radiusMiles: SHORTLIST_RADIUS_MILES,
    zip: over.zip ?? null,
    provider: over.provider,
    cache: over.cache,
  };
}
