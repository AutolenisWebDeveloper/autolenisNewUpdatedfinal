// System 15 — Inventory Orchestrator
// Runs all configured adapters independently, deduplicates, assigns lanes, upserts to DB.
// Each adapter is failure-isolated — one adapter failing never blocks others.
//
// Active adapters:
//   - MarketCheckAdapter: real production aggregator (gated by MARKETCHECK_API_KEY)
//   - CustomAdapter: dealer-supplied feeds (instantiated per source row in DB)
//
// Removed in 2026-04 audit: AutoTrader, Cars.com, CarGurus, TrueCar, Edmunds web-scrape stubs
// (all returned [] pending production parsing implementation; dropped to keep healthScore honest).

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { InventoryLane } from "@prisma/client";
import type { NormalizedVehicle, AdapterRunResult, SearchParams } from "./adapters/IInventoryAdapter";
import { MarketCheckAdapter } from "./adapters/marketcheck.adapter";

// Built-in adapters. Adapter#search() owns its own no-op behavior when not configured.
const ADAPTERS = [new MarketCheckAdapter()];

// Lane assignment logic
// LANE_1: Dealer has an active AutoLenis account AND vehicle is explicitly linked
// LANE_2: External listing from a known dealer network (partner-adjacent)
// LANE_3: Open-market listing — no direct dealer relationship
export async function assignLane(
  vehicle: NormalizedVehicle,
  activeDealerIds: Set<string>
): Promise<InventoryLane> {
  // Check if external dealer name matches an active AutoLenis dealer
  if (vehicle.externalDealerName) {
    const matchedDealer = await prisma.dealer.findFirst({
      where: {
        dealershipName: { contains: vehicle.externalDealerName, mode: "insensitive" },
        status: "ACTIVE",
      },
    });
    if (matchedDealer) return InventoryLane.LANE_2; // Partner-adjacent (not fully verified)
  }
  return InventoryLane.LANE_3; // Open-market default
}

// Deduplication: VIN + source as the unique key (per V4 System 15 spec)
// Primary key: VIN (if present)
// Fallback: make:model:year:mileage:price composite
function deduplicateVehicles(results: AdapterRunResult[]): NormalizedVehicle[] {
  const seen = new Map<string, NormalizedVehicle>();

  for (const result of results) {
    for (const vehicle of result.vehicles) {
      const key = vehicle.sourceKey;
      if (!seen.has(key)) {
        seen.set(key, vehicle);
      }
      // If duplicate VIN from different sources, keep the one with more data
      else if (vehicle.images.length > (seen.get(key)?.images.length ?? 0)) {
        seen.set(key, vehicle);
      }
    }
  }

  return Array.from(seen.values());
}

// Health scoring — ENH-14
function computeAdapterHealth(results: AdapterRunResult[]): number {
  const successful = results.filter(r => !r.error).length;
  return Math.round((successful / results.length) * 100);
}

export interface OrchestratorRunResult {
  totalFetched: number;
  totalAfterDedup: number;
  upserted: number;
  deactivated: number;
  adapterResults: Array<{ adapter: string; count: number; duration: number; error?: string }>;
  healthScore: number;
  startedAt: Date;
  completedAt: Date;
}

export async function runInventorySync(params: SearchParams = {}, mode: "full" | "priority" = "full"): Promise<OrchestratorRunResult> {
  const startedAt = new Date();

  // Run all adapters in parallel — each independently failure-isolated
  const adapterResults = await Promise.all(
    ADAPTERS.map(adapter => adapter.search({
      ...params,
      maxResults: mode === "full" ? 100 : 25,
    }))
  );

  const totalFetched = adapterResults.reduce((sum, r) => sum + r.vehicles.length, 0);

  // Deduplication pipeline
  const uniqueVehicles = deduplicateVehicles(adapterResults);

  // Get active dealers for lane assignment
  const activeDealers = await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const activeDealerIds = new Set(activeDealers.map(d => d.id));

  // Upsert to database with lane assignment
  let upserted = 0;
  for (const vehicle of uniqueVehicles) {
    const lane = await assignLane(vehicle, activeDealerIds);

    // Upsert by VIN or by source adapter + sourceKey
    const where = vehicle.vin
      ? { vin: vehicle.vin }
      : undefined;

    if (where) {
      // Price history tracking — ENH-10
      const existing = await prisma.inventoryItem.findFirst({ where });
      const priceHistory = existing
        ? [...((existing.priceHistory as Array<{price: number; date: string}>) ?? []), { price: vehicle.priceCents, date: new Date().toISOString() }].slice(-24) // Keep last 24 data points
        : [{ price: vehicle.priceCents, date: new Date().toISOString() }];

      await prisma.inventoryItem.upsert({
        where,
        create: {
          vin: vehicle.vin,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
          mileage: vehicle.mileage,
          priceCents: vehicle.priceCents,
          images: vehicle.images,
          description: vehicle.description,
          lane,
          isActive: true,
          lastSeenAt: new Date(),
          priceHistory,
          externalDealerName: vehicle.externalDealerName,
          externalDealerPhone: vehicle.externalDealerPhone,
          externalDealerCity: vehicle.externalDealerCity,
          externalDealerState: vehicle.externalDealerState,
          externalListingUrl: vehicle.externalListingUrl,
        },
        update: {
          priceCents: vehicle.priceCents,
          mileage: vehicle.mileage,
          images: vehicle.images.length > 0 ? vehicle.images : undefined,
          lane,
          isActive: true,
          lastSeenAt: new Date(),
          priceHistory,
        },
      });
      upserted++;
    } else {
      // No VIN — create only (no upsert possible without unique key)
      await prisma.inventoryItem.create({
        data: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
          mileage: vehicle.mileage,
          priceCents: vehicle.priceCents,
          images: vehicle.images,
          description: vehicle.description,
          lane,
          isActive: true,
          lastSeenAt: new Date(),
          priceHistory: [{ price: vehicle.priceCents, date: new Date().toISOString() }],
          externalDealerName: vehicle.externalDealerName,
          externalDealerCity: vehicle.externalDealerCity,
          externalDealerState: vehicle.externalDealerState,
          externalListingUrl: vehicle.externalListingUrl,
        },
      }).catch(() => {}); // Ignore duplicates
      upserted++;
    }
  }

  // ENH-5: Stale sweep — deactivate vehicles not seen in this run (for full sync only)
  let deactivated = 0;
  if (mode === "full") {
    const cutoff = new Date(Date.now() - 48 * 3600000); // 48 hours
    const staleResult = await prisma.inventoryItem.updateMany({
      where: { lastSeenAt: { lt: cutoff }, lane: { not: InventoryLane.LANE_1 }, isActive: true },
      data: { isActive: false },
    });
    deactivated = staleResult.count;
  }

  const completedAt = new Date();
  const healthScore = computeAdapterHealth(adapterResults);

  // ENH-14: Alert if health drops below threshold
  if (healthScore < 70) {
    await prisma.notification.create({
      data: {
        title: `Inventory Health Alert: ${healthScore}%`,
        body: `${adapterResults.filter(r => r.error).length} of ${adapterResults.length} adapters failed in the last sync run.`,
        type: "SYSTEM_ALERT",
      },
    }).catch(() => {});
  }

  return {
    totalFetched,
    totalAfterDedup: uniqueVehicles.length,
    upserted,
    deactivated,
    adapterResults: adapterResults.map(r => ({
      adapter: r.adapter,
      count: r.vehicles.length,
      duration: r.duration,
      error: r.error,
    })),
    healthScore,
    startedAt,
    completedAt,
  };
}

// Bootstrap seed — ENH deploy hook
export async function bootstrapInventory(): Promise<void> {
  // Seed with basic market coverage defaults
  const defaultMarkets = [
    { city: "New York", state: "NY", zip: "10001" },
    { city: "Los Angeles", state: "CA", zip: "90001" },
    { city: "Chicago", state: "IL", zip: "60601" },
    { city: "Houston", state: "TX", zip: "77001" },
    { city: "Atlanta", state: "GA", zip: "30301" },
  ];

  for (const market of defaultMarkets) {
    await runInventorySync({
      zip: market.zip,
      radius: 50,
      maxResults: 20,
    }, "priority").catch(err => {
      logger.error(`Bootstrap failed for ${market.city}:`, err);
    });
  }
}
