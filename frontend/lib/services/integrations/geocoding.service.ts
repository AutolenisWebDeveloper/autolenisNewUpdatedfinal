// Y5 — Geocoding adapter (Block A / unified sourcing).
//
// Resolves a US ZIP to coordinates through a three-tier chain that is cheap-first
// and fails CLOSED:
//   1. static ZIP_COORDS  — instant, free, authoritative for covered metros
//   2. persistent cache   — a prior Google result (SearchCache, searchType "geocoding")
//   3. Google Geocoding   — only on a static+cache miss, only when a key is set
//
// Every external effect (static lookup, cache, Google) is injectable so unit
// tests never hit prisma or the network. The real Google call has a hard timeout
// and returns null (never throws) on any error — an unresolvable ZIP degrades to
// "no coordinates", never a thrown request-path failure. Per the integration
// constitution: one typed adapter, lazy secret read, hard timeout, fail-closed.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { lookupZip } from "@/lib/utils/zip-coords";

export interface LatLng {
  lat: number;
  lng: number;
}

export type GeocodeSource = "static" | "cache" | "google";

export interface GeocodeResult extends LatLng {
  source: GeocodeSource;
}

export interface GeocodeDeps {
  staticLookup: (zip: string) => LatLng | null;
  cacheGet: (key: string) => Promise<LatLng | null>;
  cacheSet: (key: string, val: LatLng) => Promise<void>;
  googleGeocode: (query: string) => Promise<LatLng | null>;
  apiKeyPresent: () => boolean;
}

// Coordinates are immutable for a ZIP, so cache them for a long time.
const GEOCODE_CACHE_TTL_HOURS = 24 * 90; // 90 days
const GOOGLE_TIMEOUT_MS = 10_000;
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

function normalizeZip(zip: string): string | null {
  const clean = (zip || "").trim().slice(0, 5);
  // Only a well-formed 5-digit US ZIP is worth a lookup; anything else (blank,
  // partial, alpha) fails closed here so it never wastes a Google call.
  return /^\d{5}$/.test(clean) ? clean : null;
}

function cacheKeyForZip(zip: string): string {
  return `geocoding:zip:${zip}`;
}

// ─── default cache (SearchCache, searchType "geocoding") ──────────────────────

async function defaultCacheGet(cacheKey: string): Promise<LatLng | null> {
  try {
    const row = await prisma.searchCache.findUnique({ where: { cacheKey } });
    if (!row || row.expiresAt < new Date()) return null;
    const r = row.result as { lat?: number; lng?: number } | null;
    if (r && typeof r.lat === "number" && typeof r.lng === "number") {
      return { lat: r.lat, lng: r.lng };
    }
    return null;
  } catch (err) {
    logger.error("[geocoding] cache lookup failed:", err);
    return null;
  }
}

async function defaultCacheSet(cacheKey: string, val: LatLng): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + GEOCODE_CACHE_TTL_HOURS);
    const zip = cacheKey.split(":")[2] ?? null;
    await prisma.searchCache.upsert({
      where: { cacheKey },
      create: { cacheKey, searchType: "geocoding", zip, result: val as object, expiresAt },
      update: { result: val as object, expiresAt },
    });
  } catch (err) {
    logger.error("[geocoding] cache write failed:", err);
  }
}

// ─── Google Geocoding response parsing (pure) ─────────────────────────────────

export function parseGoogleGeocodeResponse(json: unknown): LatLng | null {
  if (!json || typeof json !== "object") return null;
  const body = json as { status?: unknown; results?: unknown };
  if (body.status !== "OK" || !Array.isArray(body.results)) return null;
  const loc = (body.results[0] as { geometry?: { location?: { lat?: unknown; lng?: unknown } } })
    ?.geometry?.location;
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
  return { lat: loc.lat, lng: loc.lng };
}

// ─── default Google adapter (real HTTP, hard timeout, fail-closed) ────────────

async function defaultGoogleGeocode(query: string): Promise<LatLng | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null; // fail closed — never call without a key
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(query)}&components=country:US&key=${key}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      logger.warn(`[geocoding] Google HTTP ${res.status} for "${query}"`);
      return null;
    }
    return parseGoogleGeocodeResponse(await res.json());
  } catch (err) {
    logger.warn(
      `[geocoding] Google geocode failed for "${query}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function apiKeyPresentDefault(): boolean {
  return !!process.env.GOOGLE_GEOCODING_API_KEY;
}

// ─── geocodeZip ───────────────────────────────────────────────────────────────

export async function geocodeZip(
  zip: string,
  deps?: Partial<GeocodeDeps>,
): Promise<GeocodeResult | null> {
  const clean = normalizeZip(zip);
  if (!clean) return null;

  const staticLookup = deps?.staticLookup ?? lookupZip;
  const cacheGet = deps?.cacheGet ?? defaultCacheGet;
  const cacheSet = deps?.cacheSet ?? defaultCacheSet;
  const googleGeocode = deps?.googleGeocode ?? defaultGoogleGeocode;
  const apiKeyPresent = deps?.apiKeyPresent ?? apiKeyPresentDefault;

  // 1. static (free, authoritative)
  const staticHit = staticLookup(clean);
  if (staticHit) return { ...staticHit, source: "static" };

  const key = cacheKeyForZip(clean);

  // 2. cache (prior Google result)
  const cached = await cacheGet(key);
  if (cached) return { ...cached, source: "cache" };

  // 3. Google — only when configured; fail closed otherwise.
  if (!apiKeyPresent()) return null;
  let googled: LatLng | null = null;
  try {
    googled = await googleGeocode(clean);
  } catch (err) {
    logger.warn(
      `[geocoding] google tier threw for ${clean}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (!googled) return null;

  await cacheSet(key, googled);
  return { ...googled, source: "google" };
}

// ─── backfill: populate lat/lng on Dealer + DealerProspect from their ZIP ─────

export interface CoordRow {
  id: string;
  zip: string | null;
}

export interface BackfillDeps {
  loadDealers: (limit: number) => Promise<CoordRow[]>;
  loadProspects: (limit: number) => Promise<CoordRow[]>;
  updateDealer: (id: string, c: LatLng) => Promise<void>;
  updateProspect: (id: string, c: LatLng) => Promise<void>;
  geocode: (zip: string) => Promise<LatLng | null>;
}

export interface BackfillCounts {
  scanned: number;
  geocoded: number;
  skipped: number;
}

export interface BackfillResult {
  dealers: BackfillCounts;
  prospects: BackfillCounts;
}

// Bounded per pool per run: geocoding is sequential and a cold-cache miss can
// spend up to GOOGLE_TIMEOUT_MS each, so cap rows to stay well under the function
// timeout. The backfill is idempotent — ops re-run (or a cron) to drain the rest.
const BACKFILL_DEFAULT_LIMIT = 100;

// Default deps: only load rows missing coordinates but carrying a ZIP, so the
// backfill is idempotent (a second run re-selects nothing already resolved).
const defaultBackfillDeps: BackfillDeps = {
  loadDealers: (limit) =>
    prisma.dealer.findMany({
      where: { latitude: null, zip: { not: null } },
      select: { id: true, zip: true },
      take: limit,
    }),
  loadProspects: (limit) =>
    prisma.dealerProspect.findMany({
      where: { latitude: null, zip: { not: null } },
      select: { id: true, zip: true },
      take: limit,
    }),
  updateDealer: async (id, c) => {
    await prisma.dealer.update({ where: { id }, data: { latitude: c.lat, longitude: c.lng } });
  },
  updateProspect: async (id, c) => {
    await prisma.dealerProspect.update({
      where: { id },
      data: { latitude: c.lat, longitude: c.lng },
    });
  },
  geocode: async (zip) => {
    const r = await geocodeZip(zip);
    return r ? { lat: r.lat, lng: r.lng } : null;
  },
};

async function backfillRows(
  rows: CoordRow[],
  geocode: (zip: string) => Promise<LatLng | null>,
  update: (id: string, c: LatLng) => Promise<void>,
): Promise<BackfillCounts> {
  const counts: BackfillCounts = { scanned: rows.length, geocoded: 0, skipped: 0 };
  for (const row of rows) {
    if (!row.zip) {
      counts.skipped += 1;
      continue;
    }
    let coords: LatLng | null = null;
    try {
      coords = await geocode(row.zip);
    } catch (err) {
      logger.warn(`[geocoding] backfill geocode threw for ${row.id}:`, err);
    }
    if (!coords) {
      counts.skipped += 1; // unresolved — left null, retriable on a later run
      continue;
    }
    // Isolate the write too: one failed update must not abort the batch — the row
    // stays null-coord and is retried on a later run.
    try {
      await update(row.id, coords);
      counts.geocoded += 1;
    } catch (err) {
      logger.warn(`[geocoding] backfill update failed for ${row.id}:`, err);
      counts.skipped += 1;
    }
  }
  return counts;
}

export async function backfillCoordinates(
  deps?: Partial<BackfillDeps>,
  opts?: { limit?: number },
): Promise<BackfillResult> {
  const d = { ...defaultBackfillDeps, ...deps };
  const limit = opts?.limit ?? BACKFILL_DEFAULT_LIMIT;

  const [dealers, prospects] = await Promise.all([d.loadDealers(limit), d.loadProspects(limit)]);
  const [dealerCounts, prospectCounts] = await Promise.all([
    backfillRows(dealers, d.geocode, d.updateDealer),
    backfillRows(prospects, d.geocode, d.updateProspect),
  ]);

  logger.info(
    `[geocoding] backfill: dealers geocoded=${dealerCounts.geocoded}/${dealerCounts.scanned} ` +
      `prospects geocoded=${prospectCounts.geocoded}/${prospectCounts.scanned}`,
  );
  return { dealers: dealerCounts, prospects: prospectCounts };
}
