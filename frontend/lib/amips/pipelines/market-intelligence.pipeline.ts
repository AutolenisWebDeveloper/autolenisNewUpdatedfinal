// AMIPS Phase 1 — Market Intelligence pipeline.
//
// Populates the `market_intelligence` database for the top 25 US metros.
// Population comes from the free US Census Bureau API (2020 Decennial PL,
// no key required); if the call fails or a metro can't be matched we fall back
// to the hardcoded launch populations from Phase 0 — the pipeline never blocks
// on the network.
//
// Metro-level scores are computed from the dealer_intelligence rows that fall
// inside each metro (by distance from the metro center):
//   competitionScore   — avg same-brand density of metro dealers, on the
//                         AMIPS 0–10 curve. More competition = better for buyers.
//   inventoryScore     — avg inventory signal of metro dealers (0–10).
//   vehicleDemandScore — population-derived demand proxy (0–10).
//   buyerLeverageScore — weighted composite of the three.
//
// All upserts key on the model's (metroName, state) unique constraint.

import { prisma } from "@/lib/prisma";
import { haversineMiles, type LatLng } from "@/lib/utils/zip-coords";
import {
  getMetroDefs,
  METRO_MEMBERSHIP_RADIUS_MILES,
  type MetroDef,
} from "@/lib/amips/metros";
import { dealerDensityScore } from "@/lib/amips/pipelines/dealer-intelligence.pipeline";

export interface MarketSyncResult {
  metros: number;
  scored: number;
}

const CENSUS_BASE_URL = "https://api.census.gov/data/2020/dec/pl";

// Token used to match each metro against a Census CBSA NAME (which looks like
// "Los Angeles-Long Beach-Anaheim, CA Metro Area"). Lowercased substring match.
const CENSUS_MATCH_TOKEN: Record<string, string> = {
  "Los Angeles": "los angeles-long beach",
  "New York": "new york-newark",
  "Dallas-Fort Worth": "dallas-fort worth",
  Houston: "houston-",
  Chicago: "chicago-",
  Miami: "miami-",
  Atlanta: "atlanta-",
  "Washington DC": "washington-arlington",
  Phoenix: "phoenix-",
  Philadelphia: "philadelphia-",
  Detroit: "detroit-",
  Boston: "boston-",
  "San Antonio": "san antonio-",
  Austin: "austin-",
  Seattle: "seattle-",
  Denver: "denver-",
  Minneapolis: "minneapolis-",
  Tampa: "tampa-",
  Charlotte: "charlotte-",
  "San Diego": "san diego-",
  Portland: "portland-vancouver",
  "Las Vegas": "las vegas-",
  Nashville: "nashville-",
  Baltimore: "baltimore-",
  Sacramento: "sacramento-",
};

// Best-effort fetch of CBSA populations from the Census API. Returns a metro ->
// population map for whatever could be matched, or an empty map on any failure.
async function fetchCensusPopulations(): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    const url =
      `${CENSUS_BASE_URL}?get=NAME,P1_001N` +
      `&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[amips-p1-market] census api ${res.status}; using fallback`);
      return result;
    }
    // Shape: [["NAME","P1_001N","..."], ["Los Angeles-...","13200998",...], ...]
    const rows = (await res.json()) as string[][];
    const names = rows.slice(1).map((r) => ({
      name: (r[0] ?? "").toLowerCase(),
      pop: Number.parseInt(r[1] ?? "", 10),
    }));
    for (const [metro, token] of Object.entries(CENSUS_MATCH_TOKEN)) {
      const hit = names.find(
        (n) => n.name.includes(token) && Number.isFinite(n.pop),
      );
      if (hit) result.set(metro, hit.pop);
    }
    console.log(`[amips-p1-market] census matched ${result.size}/25 metros`);
  } catch (err) {
    console.warn("[amips-p1-market] census fetch failed; using fallback", err);
  }
  return result;
}

interface MetroDealer {
  coords: LatLng;
  dealersWithin30mi: number;
  inventorySignal: string;
}

// Inventory signal -> 0–10, mirroring the Market Score engine.
function inventorySignalScore(signal: string): number {
  switch (signal) {
    case "low":
      return 2;
    case "high":
      return 9;
    default:
      return 5; // normal
  }
}

// Population -> 0–10 demand proxy. ~2M people maps to ~10; smaller metros scale
// down linearly and clamp.
function populationDemandScore(population: number | null): number {
  if (!population || population <= 0) return 0;
  const raw = (population / 2_000_000) * 10;
  return Math.min(10, Math.round(raw * 10) / 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function computeMetroScores(
  def: MetroDef,
  population: number | null,
  dealers: MetroDealer[],
): {
  competitionScore: number;
  inventoryScore: number;
  vehicleDemandScore: number;
  buyerLeverageScore: number;
} {
  const vehicleDemandScore = populationDemandScore(population);

  if (dealers.length === 0) {
    // No dealer coverage yet — competition/inventory unknown, demand only.
    return {
      competitionScore: 0,
      inventoryScore: 0,
      vehicleDemandScore,
      buyerLeverageScore: round1(vehicleDemandScore * 0.3),
    };
  }

  const avgWithin =
    dealers.reduce((s, d) => s + d.dealersWithin30mi, 0) / dealers.length;
  const competitionScore = dealerDensityScore(Math.round(avgWithin));

  const inventoryScore = round1(
    dealers.reduce((s, d) => s + inventorySignalScore(d.inventorySignal), 0) /
      dealers.length,
  );

  // Buyer leverage rises with competition, healthy inventory, and demand.
  const buyerLeverageScore = round1(
    competitionScore * 0.4 + inventoryScore * 0.3 + vehicleDemandScore * 0.3,
  );

  return { competitionScore, inventoryScore, vehicleDemandScore, buyerLeverageScore };
}

/**
 * Sync Market Intelligence for the top 25 metros. Returns the number of metros
 * upserted and how many received a non-zero buyer-leverage score.
 */
export async function syncMarketIntelligence(): Promise<MarketSyncResult> {
  console.log("[amips-p1-market] starting market intelligence sync");

  const defs = getMetroDefs();
  const censusPop = await fetchCensusPopulations();

  // Load all geocoded dealers once; filter per-metro by distance in memory.
  const dealers = await prisma.dealerIntelligence.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
    select: {
      latitude: true,
      longitude: true,
      dealersWithin30mi: true,
      inventorySignal: true,
    },
  });
  const geoDealers = dealers.map((d) => ({
    coords: { lat: d.latitude as number, lng: d.longitude as number },
    dealersWithin30mi: d.dealersWithin30mi ?? 0,
    inventorySignal: d.inventorySignal,
  }));

  let scored = 0;

  for (const def of defs) {
    const population = censusPop.get(def.metro) ?? def.population;

    const metroDealers = geoDealers.filter(
      (d) =>
        haversineMiles(def.center, d.coords) <= METRO_MEMBERSHIP_RADIUS_MILES,
    );

    const scores = computeMetroScores(def, population, metroDealers);
    if (scores.buyerLeverageScore > 0) scored++;

    await prisma.marketIntelligence.upsert({
      where: { metroName_state: { metroName: def.metro, state: def.state } },
      create: {
        metroName: def.metro,
        state: def.state,
        population,
        vehicleDemandScore: scores.vehicleDemandScore,
        competitionScore: scores.competitionScore,
        inventoryScore: scores.inventoryScore,
        buyerLeverageScore: scores.buyerLeverageScore,
        lastUpdated: new Date(),
      },
      update: {
        population,
        vehicleDemandScore: scores.vehicleDemandScore,
        competitionScore: scores.competitionScore,
        inventoryScore: scores.inventoryScore,
        buyerLeverageScore: scores.buyerLeverageScore,
        lastUpdated: new Date(),
      },
    });

    console.log(
      `[amips-p1-market] ${def.metro}, ${def.state}: pop=${population} ` +
        `dealers=${metroDealers.length} leverage=${scores.buyerLeverageScore}`,
    );
  }

  console.log(
    `[amips-p1-market] done — metros ${defs.length}, scored ${scored}`,
  );
  return { metros: defs.length, scored };
}
