// Phase 4 — backfill dealer_rooftops.latitude/longitude.
//
// WHY, GIVEN A BACKFILL ALREADY EXISTS. geocoding.service.backfillCoordinates
// already fills Dealer and DealerProspect coordinates from ZIP, driven by the
// geocode-backfill cron. It does not touch dealer_rooftops, which has 0/1,389
// coordinates. Prospects are meant to read geo THROUGH their rooftop rather than
// keeping a private copy, so the rooftop is the row that needs them. That cron is
// deliberately left alone — it serves other callers and is out of scope here.
//
// TWO SOURCES, STRONGEST FIRST, AND THEY ARE NOT EQUIVALENT:
//   dealer_intelligence  437 rows at 100% lat/lng. A real observed location for
//                        a specific dealership, matched on name + city + state.
//   zip centroid         the middle of a postal area, not the store. Good enough
//                        to rank "roughly how far", wrong for "where is it".
// The source is recorded on every write, because a consumer computing nearest
// dealer needs to know which of those two it is holding.
//
// PLAN AND APPLY ARE SEPARATE. This reads production data the owner has not
// authorised writing to, so producing the plan is inert by construction — the
// script prints it and exits unless explicitly told to apply.

import { logger } from "@/lib/logger";
import { normalizeDealerName } from "@/lib/services/dealer/dealer-identity.service";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";

export type GeoSource = "dealer_intelligence" | "zip_centroid";

export interface RooftopRow {
  id: string;
  displayName: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface IntelligenceRow {
  dealerName: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface GeoPlanEntry {
  rooftopId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  source: GeoSource;
}

export interface GeoPlanCounts {
  scanned: number;
  alreadyHasCoords: number;
  fromIntelligence: number;
  fromZipCentroid: number;
  unresolved: number;
}

export interface GeoPlan {
  entries: GeoPlanEntry[];
  counts: GeoPlanCounts;
  /** Rooftops nothing could resolve, so the gap is nameable rather than a silent shortfall. */
  unresolvedIds: string[];
}

export interface GeoApplyResult {
  written: number;
  failed: number;
}

export interface RooftopGeoDeps {
  prisma: PrismaClient;
  loadRooftops: () => Promise<RooftopRow[]>;
  loadIntelligence: () => Promise<IntelligenceRow[]>;
  geocodeZip: (zip: string) => Promise<{ lat: number; lng: number } | null>;
  writeRooftopCoords: (id: string, lat: number, lng: number, source: GeoSource) => Promise<void>;
}

/** name|city|state, using the SAME normalizer that built the rooftop key columns. */
function intelKey(name: string, city: string | null, state: string | null): string | null {
  const n = normalizeDealerName(name);
  const c = (city ?? "").trim().toLowerCase();
  const s = (state ?? "").trim().toLowerCase();
  if (!n || !c || !s) return null;
  return `${n}|${c}|${s}`;
}

/**
 * Decide what WOULD be written. Performs no writes.
 *
 * Reads production rows, so inertness is the point: the caller inspects the plan
 * and decides, rather than discovering afterwards what changed.
 */
export async function planRooftopGeoBackfill(deps?: Partial<RooftopGeoDeps>): Promise<GeoPlan> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const loadRooftops =
    deps?.loadRooftops ??
    (() =>
      prisma.dealerRooftop.findMany({
        where: { latitude: null },
        select: { id: true, displayName: true, city: true, state: true, zip: true, latitude: true, longitude: true },
      }));
  const loadIntelligence =
    deps?.loadIntelligence ??
    (() =>
      prisma.dealerIntelligence.findMany({
        where: { latitude: { not: null }, longitude: { not: null } },
        select: { dealerName: true, city: true, state: true, latitude: true, longitude: true },
      }));
  const geocode = deps?.geocodeZip ?? (async (zip: string) => {
    const r = await geocodeZip(zip);
    return r ? { lat: r.lat, lng: r.lng } : null;
  });

  const rooftops = await loadRooftops();
  const intelligence = await loadIntelligence();

  // Index intelligence by name|city|state. Rows with null coordinates are not
  // indexed at all — writing a null as if it were a location is worse than
  // leaving the rooftop unresolved and retriable.
  const byKey = new Map<string, IntelligenceRow>();
  for (const i of intelligence) {
    if (i.latitude === null || i.longitude === null) continue;
    const key = intelKey(i.dealerName, i.city, i.state);
    if (key && !byKey.has(key)) byKey.set(key, i);
  }

  const entries: GeoPlanEntry[] = [];
  const unresolvedIds: string[] = [];
  const counts: GeoPlanCounts = {
    scanned: rooftops.length,
    alreadyHasCoords: 0,
    fromIntelligence: 0,
    fromZipCentroid: 0,
    unresolved: 0,
  };

  for (const r of rooftops) {
    if (r.latitude !== null && r.longitude !== null) {
      counts.alreadyHasCoords += 1;
      continue;
    }

    const key = intelKey(r.displayName, r.city, r.state);
    const match = key ? byKey.get(key) : undefined;
    if (match && match.latitude !== null && match.longitude !== null) {
      entries.push({
        rooftopId: r.id,
        displayName: r.displayName,
        latitude: match.latitude,
        longitude: match.longitude,
        source: "dealer_intelligence",
      });
      counts.fromIntelligence += 1;
      continue;
    }

    if (r.zip) {
      const coords = await geocode(r.zip);
      if (coords) {
        entries.push({
          rooftopId: r.id,
          displayName: r.displayName,
          latitude: coords.lat,
          longitude: coords.lng,
          source: "zip_centroid",
        });
        counts.fromZipCentroid += 1;
        continue;
      }
    }

    // Nothing resolved it. Named, not silently dropped — an unresolved rooftop
    // is a gap someone can go and fix.
    counts.unresolved += 1;
    unresolvedIds.push(r.id);
  }

  return { entries, counts, unresolvedIds };
}

/**
 * Write a plan. Separate call, and the only thing here that mutates.
 *
 * Per-entry error isolation: one failed write must not abandon the rest, and the
 * unwritten rooftop stays null-coord and retriable on a later run.
 */
export async function applyRooftopGeoBackfill(
  plan: GeoPlan,
  deps?: Partial<RooftopGeoDeps>,
): Promise<GeoApplyResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const write =
    deps?.writeRooftopCoords ??
    (async (id: string, lat: number, lng: number) => {
      await prisma.dealerRooftop.update({ where: { id }, data: { latitude: lat, longitude: lng } });
    });

  let written = 0;
  let failed = 0;
  for (const e of plan.entries) {
    try {
      await write(e.rooftopId, e.latitude, e.longitude, e.source);
      written += 1;
    } catch (err) {
      failed += 1;
      logger.warn(`[rooftop-geo] write failed for ${e.rooftopId} (${e.displayName}):`, err);
    }
  }
  return { written, failed };
}
