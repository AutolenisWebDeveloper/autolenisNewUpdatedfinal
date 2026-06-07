// AMIPS Phase 1 — Market Score batch computation.
//
// Pre-computes the AutoLenis Market Score for every (vehicle make/model) x
// (metro) combination that has enough data to be defensible:
//   - a VehicleIntelligence record for the make/model
//   - a MarketIntelligence record for the metro
//   - at least one DealerIntelligence record of that brand inside the metro
//
// Results are cached in `amips_market_scores` so the AMIPS-2 article generator
// reads a stored score instead of recomputing per page. Re-running refreshes
// every score in place (upsert on make/model/metro).

import { prisma } from "@/lib/prisma";
import { haversineMiles, type LatLng } from "@/lib/utils/zip-coords";
import {
  getMetroDefs,
  METRO_MEMBERSHIP_RADIUS_MILES,
  type MetroDef,
} from "@/lib/amips/metros";
import {
  computeMarketScore,
  type InventorySignal,
  type NegotiationDifficulty,
  type IncentiveStatus,
} from "@/lib/amips/market-score.service";

export interface MarketScoreBatchResult {
  combinations: number;
  computed: number;
  skipped: number;
}

// Derive incentive status from the vehicle's active-incentives text. We never
// invent strength: presence of "0%" / "apr" / "cash" signals strong incentives,
// any other non-empty text is "some", and empty is "none".
function incentiveStatusFrom(active: string | null): IncentiveStatus {
  if (!active || active.trim() === "") return "none";
  const t = active.toLowerCase();
  if (t.includes("0%") || t.includes("0 %") || t.includes("apr") || t.includes("cash back")) {
    return "strong";
  }
  return "some";
}

interface GeoDealer {
  brand: string;
  coords: LatLng;
}

// Count same-brand dealers inside a metro (membership radius from center).
function dealersForBrandInMetro(
  def: MetroDef,
  brand: string,
  dealers: GeoDealer[],
): number {
  let count = 0;
  for (const d of dealers) {
    if (d.brand !== brand) continue;
    if (haversineMiles(def.center, d.coords) <= METRO_MEMBERSHIP_RADIUS_MILES) {
      count++;
    }
  }
  return count;
}

/**
 * Compute and cache Market Scores across all qualifying make/model x metro
 * combinations. Returns how many combinations were considered, computed, and
 * skipped (no qualifying dealer).
 */
export async function computeMarketScoreBatch(): Promise<MarketScoreBatchResult> {
  console.log("[amips-p1-scores] starting market score batch");

  const [vehicles, markets, dealers] = await Promise.all([
    prisma.vehicleIntelligence.findMany({
      select: {
        make: true,
        model: true,
        negotiationDifficulty: true,
        activeIncentives: true,
      },
    }),
    prisma.marketIntelligence.findMany({
      select: { metroName: true, state: true, inventoryScore: true },
    }),
    prisma.dealerIntelligence.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      select: { brand: true, latitude: true, longitude: true },
    }),
  ]);

  const geoDealers: GeoDealer[] = dealers.map((d) => ({
    brand: d.brand,
    coords: { lat: d.latitude as number, lng: d.longitude as number },
  }));

  // Distinct make/model from VehicleIntelligence (trims collapse to one curve).
  const vehicleByMakeModel = new Map<
    string,
    { make: string; model: string; negotiationDifficulty: string; activeIncentives: string | null }
  >();
  for (const v of vehicles) {
    const key = `${v.make}|${v.model}`;
    if (!vehicleByMakeModel.has(key)) vehicleByMakeModel.set(key, v);
  }

  const metroDefs = getMetroDefs();
  const marketByMetro = new Map(markets.map((m) => [m.metroName, m]));

  // Map a metro's market-level inventory score back to a signal bucket so the
  // per-vehicle score reflects local supply rather than a flat default.
  const inventorySignalForMetro = (metro: string): InventorySignal => {
    const inv = marketByMetro.get(metro)?.inventoryScore ?? null;
    if (inv === null) return "normal";
    if (inv <= 3) return "low";
    if (inv >= 8) return "high";
    return "normal";
  };

  let combinations = 0;
  let computed = 0;
  let skipped = 0;

  for (const v of vehicleByMakeModel.values()) {
    for (const def of metroDefs) {
      // Require a MarketIntelligence record for the metro.
      if (!marketByMetro.has(def.metro)) continue;
      combinations++;

      const dealerCount = dealersForBrandInMetro(def, v.make, geoDealers);
      if (dealerCount < 1) {
        skipped++;
        continue;
      }

      const result = computeMarketScore({
        dealersWithin30mi: dealerCount,
        inventorySignal: inventorySignalForMetro(def.metro),
        negotiationDifficulty: v.negotiationDifficulty as NegotiationDifficulty,
        incentiveStatus: incentiveStatusFrom(v.activeIncentives),
      });

      await prisma.amipsMarketScore.upsert({
        where: {
          make_model_metro: { make: v.make, model: v.model, metro: def.metro },
        },
        create: {
          make: v.make,
          model: v.model,
          metro: def.metro,
          state: def.state,
          dealerCount,
          overallBuyerAdvantage: result.overallBuyerAdvantage,
          scoreJson: JSON.stringify(result),
          computedAt: new Date(),
        },
        update: {
          state: def.state,
          dealerCount,
          overallBuyerAdvantage: result.overallBuyerAdvantage,
          scoreJson: JSON.stringify(result),
          computedAt: new Date(),
        },
      });
      computed++;
    }
  }

  console.log(
    `[amips-p1-scores] done — combinations ${combinations}, computed ${computed}, skipped ${skipped}`,
  );
  return { combinations, computed, skipped };
}
