// AMIPS Phase 1 — Dealer Intelligence pipeline.
//
// Populates the `dealer_intelligence` database from the existing Gemini Maps
// dealer cache (`DealerProspect`). For every dealer we compute a density score:
// the number of *same-brand* dealers within 30 miles, mapped onto the AMIPS
// dealer-competition curve. That score feeds the Market Score and the metro
// readiness rollups.
//
// DealerProspect carries no lat/lng, so we geocode each record from its ZIP
// (falling back to city/state) using the baked-in ZIP_COORDS table — no
// external API, no cost. Records that cannot be geocoded or that lack a brand
// are skipped (and reported), because density and Market Score both depend on
// brand + location.
//
// The sync is idempotent: rows are matched on (dealerName, brand, city, state)
// and updated in place, so re-running refreshes density without duplicating.

import { prisma } from "@/lib/prisma";
import {
  lookupZip,
  lookupCity,
  haversineMiles,
  type LatLng,
} from "@/lib/utils/zip-coords";
import { DEALER_DENSITY_RADIUS_MILES } from "@/lib/amips/metros";

export interface DealerSyncResult {
  synced: number;
  skipped: number;
  errors: number;
}

// Map a same-brand-within-30mi count onto the AMIPS dealer-competition curve
// (0–10). Mirrors the Market Score engine's dealer-competition buckets so the
// density score and the live Market Score never disagree.
export function dealerDensityScore(dealersWithin30mi: number): number {
  if (dealersWithin30mi <= 2) return 2;
  if (dealersWithin30mi <= 5) return 4;
  if (dealersWithin30mi <= 9) return 7;
  if (dealersWithin30mi <= 14) return 8;
  return 10; // 15+
}

// Resolve a prospect to a coordinate: ZIP first (most precise), then city/state.
function resolveCoords(p: {
  zip: string | null;
  city: string | null;
  state: string | null;
}): LatLng | null {
  if (p.zip) {
    const byZip = lookupZip(p.zip);
    if (byZip) return byZip;
  }
  return lookupCity(p.city, p.state);
}

interface GeoDealer {
  id: string;
  name: string;
  brand: string;
  city: string;
  state: string;
  zip: string;
  website: string | null;
  coords: LatLng;
}

/**
 * Sync Dealer Intelligence from the DealerProspect cache. Returns counts of
 * rows synced, skipped (no brand / not geocodable), and errored.
 */
export async function syncDealerIntelligence(): Promise<DealerSyncResult> {
  console.log("[amips-p1-dealer] starting dealer intelligence sync");

  const prospects = await prisma.dealerProspect.findMany({
    select: {
      id: true,
      name: true,
      brand: true,
      city: true,
      state: true,
      zip: true,
      website: true,
    },
  });

  console.log(`[amips-p1-dealer] loaded ${prospects.length} dealer prospects`);

  // Build the geocoded working set. Anything without a brand or resolvable
  // coordinate is skipped — density + Market Score need both.
  const geo: GeoDealer[] = [];
  let skipped = 0;
  for (const p of prospects) {
    const brand = p.brand?.trim();
    if (!brand) {
      skipped++;
      continue;
    }
    const coords = resolveCoords(p);
    if (!coords) {
      skipped++;
      continue;
    }
    geo.push({
      id: p.id,
      name: p.name,
      brand,
      city: p.city ?? "",
      state: p.state ?? "",
      zip: p.zip ?? "",
      website: p.website ?? null,
      coords,
    });
  }

  // Pre-bucket by brand so each density count only scans same-brand peers.
  const byBrand = new Map<string, GeoDealer[]>();
  for (const d of geo) {
    const list = byBrand.get(d.brand) ?? [];
    list.push(d);
    byBrand.set(d.brand, list);
  }

  let synced = 0;
  let errors = 0;

  for (const d of geo) {
    try {
      const peers = byBrand.get(d.brand) ?? [];
      // Count OTHER same-brand dealers within the density radius.
      let within = 0;
      for (const peer of peers) {
        if (peer.id === d.id) continue;
        if (haversineMiles(d.coords, peer.coords) <= DEALER_DENSITY_RADIUS_MILES) {
          within++;
        }
      }
      const density = dealerDensityScore(within);

      // Idempotent upsert by natural identity (no unique constraint on the
      // table, so match-then-write).
      const existing = await prisma.dealerIntelligence.findFirst({
        where: {
          dealerName: d.name,
          brand: d.brand,
          city: d.city,
          state: d.state,
        },
        select: { id: true },
      });

      const data = {
        dealerName: d.name,
        brand: d.brand,
        city: d.city,
        state: d.state,
        zip: d.zip,
        latitude: d.coords.lat,
        longitude: d.coords.lng,
        website: d.website,
        dealerDensityScore: density,
        dealersWithin30mi: within,
        dataSource: "gemini_maps_cache",
        lastUpdated: new Date(),
      };

      if (existing) {
        await prisma.dealerIntelligence.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await prisma.dealerIntelligence.create({
          // inventorySignal defaults to "normal" at the DB layer.
          data,
        });
      }
      synced++;
    } catch (err) {
      errors++;
      console.error(`[amips-p1-dealer] error syncing dealer ${d.name}:`, err);
    }
  }

  console.log(
    `[amips-p1-dealer] done — synced ${synced}, skipped ${skipped}, errors ${errors}`,
  );
  return { synced, skipped, errors };
}
