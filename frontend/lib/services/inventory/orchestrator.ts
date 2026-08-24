// System 15 — Inventory Orchestrator
// Runs all configured adapters independently, deduplicates, assigns lanes, upserts to DB.
// Each adapter is failure-isolated — one adapter failing never blocks others.
//
// Active adapters:
//   - MarketCheckAdapter: real production aggregator (gated by MARKETCHECK_API_KEY)
//   - CustomAdapter: dealer-supplied feeds (instantiated per source row in DB)
//
// Batch 1 (truthfulness): every run now persists an InventorySyncRun per source with
// an explicit outcome (SUCCESS / ZERO_RESULTS / NOT_CONFIGURED / DEFERRED / FAILED),
// stamps provenance (sourceAdapter) on every ingested row, and computes healthScore
// ONLY over configured sources that actually ran. An unconfigured provider can never
// read as "100% healthy / 0 items".
//
// Removed in 2026-04 audit (files deleted in Batch 1): AutoTrader, Cars.com, CarGurus,
// TrueCar, Edmunds web-scrape stubs — they returned [] and inflated healthScore.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { InventoryLane, InventorySourceType, SyncRunStatus } from "@prisma/client";
import { normalizeVin, isValidVin } from "@/lib/utils/vin";
import type { NormalizedVehicle, AdapterRunResult, AdapterOutcome, SearchParams } from "./adapters/IInventoryAdapter";
import { MarketCheckAdapter } from "./adapters/marketcheck.adapter";

// Built-in adapters. Adapter#search() owns its own no-op behavior when not configured.
const ADAPTERS = [new MarketCheckAdapter()];

// Map an adapter's `name` to a first-class InventorySource (type + display name)
// so its runs can be recorded. Custom dealer-feed adapters use type CUSTOM.
export function inventorySourceForAdapter(adapterName: string): { type: InventorySourceType; name: string } {
  if (adapterName === "marketcheck") return { type: InventorySourceType.MARKETCHECK, name: "MarketCheck" };
  if (adapterName.startsWith("custom_")) return { type: InventorySourceType.CUSTOM, name: adapterName };
  return { type: InventorySourceType.CUSTOM, name: adapterName };
}

// Idempotent source registration — one row per (type, name). Best-effort: a
// monitoring/accounting write must never break the actual ingestion.
async function ensureInventorySource(type: InventorySourceType, name: string): Promise<string | null> {
  try {
    const source = await prisma.inventorySource.upsert({
      where: { type_name: { type, name } },
      create: { type, name },
      update: {},
      select: { id: true },
    });
    return source.id;
  } catch (e) {
    logger.warn(`[inventory-orchestrator] ensureInventorySource failed for ${type}/${name}:`, e);
    return null;
  }
}

// Translate an adapter outcome into the persisted SyncRunStatus.
function outcomeToStatus(outcome: AdapterOutcome): SyncRunStatus {
  switch (outcome) {
    case "SUCCESS": return SyncRunStatus.COMPLETED;
    case "ZERO_RESULTS": return SyncRunStatus.ZERO_RESULTS;
    case "NOT_CONFIGURED": return SyncRunStatus.NOT_CONFIGURED;
    case "DEFERRED": return SyncRunStatus.DEFERRED;
    case "FAILED": return SyncRunStatus.FAILED;
  }
}

// Lane assignment logic
// LANE_1: Dealer has an active AutoLenis account AND vehicle is explicitly linked
// LANE_2: External listing from a known dealer network (partner-adjacent)
// LANE_3: Open-market listing — no direct dealer relationship
export function assignLane(
  vehicle: NormalizedVehicle,
  activeDealerNames: string[]
): InventoryLane {
  // Partner-adjacent if the external dealer name matches an ACTIVE AutoLenis dealer.
  // Matched in memory against a single prefetched list — no per-vehicle DB query.
  if (vehicle.externalDealerName) {
    const ext = vehicle.externalDealerName.toLowerCase();
    if (activeDealerNames.some((name) => name.toLowerCase().includes(ext))) {
      return InventoryLane.LANE_2;
    }
  }
  return InventoryLane.LANE_3; // Open-market default
}

// Deduplication: VIN + source as the unique key (per V4 System 15 spec)
// Primary key: VIN (if present); Fallback: make:model:year:mileage:price composite
function deduplicateVehicles(results: AdapterRunResult[]): NormalizedVehicle[] {
  const seen = new Map<string, NormalizedVehicle>();
  for (const result of results) {
    for (const vehicle of result.vehicles) {
      const key = vehicle.sourceKey;
      if (!seen.has(key)) {
        seen.set(key, vehicle);
      } else if (vehicle.images.length > (seen.get(key)?.images.length ?? 0)) {
        seen.set(key, vehicle);
      }
    }
  }
  return Array.from(seen.values());
}

// Health scoring — ENH-14, corrected in Batch 1.
// Only configured sources that actually RAN count toward health. Unconfigured
// sources are SKIPPED, not scored — so an all-unconfigured run yields null health,
// never a misleading 100%.
function computeHealthScore(results: AdapterRunResult[]): number | null {
  const attempted = results.filter(r => r.outcome !== "NOT_CONFIGURED");
  if (attempted.length === 0) return null;
  const healthy = attempted.filter(r => r.outcome === "SUCCESS" || r.outcome === "ZERO_RESULTS").length;
  return Math.round((healthy / attempted.length) * 100);
}

export interface AdapterOutcomeSummary {
  adapter: string;
  count: number;
  duration: number;
  configured: boolean;
  outcome: AdapterOutcome;
  upserted: number;
  syncRunId: string | null;
  error?: string;
}

export interface OrchestratorRunResult {
  totalFetched: number;
  totalAfterDedup: number;
  upserted: number;
  deactivated: number;
  /** How many sources were actually configured (credential/feed present). */
  configuredSources: number;
  /** How many sources actually ran a fetch (configured, not NOT_CONFIGURED). */
  attemptedSources: number;
  /** Roll-up outcome for the whole run. PARTIAL = some sources succeeded, some failed. */
  outcome: "SUCCESS" | "PARTIAL" | "ZERO_RESULTS" | "NOT_CONFIGURED" | "DEFERRED" | "FAILED";
  adapterResults: AdapterOutcomeSummary[];
  /** null when no configured source ran — NEVER defaulted to 100. */
  healthScore: number | null;
  startedAt: Date;
  completedAt: Date;
}

// Roll a set of per-adapter outcomes into one run-level outcome.
// Exported for deterministic verification of the PARTIAL (mixed-outcome) rule,
// which the single-adapter live orchestrator cannot exercise on its own.
export function rollUpOutcome(outcomes: AdapterOutcome[]): OrchestratorRunResult["outcome"] {
  const hasSuccess = outcomes.some(o => o === "SUCCESS");
  const hasFailure = outcomes.some(o => o === "FAILED" || o === "DEFERRED");
  // A run where some sources succeeded and others failed is PARTIAL — never a
  // clean SUCCESS that hides the failure.
  if (hasSuccess && hasFailure) return "PARTIAL";
  if (hasSuccess) return "SUCCESS";
  // With NO success, a real failure must surface — it must NOT be masked by a
  // sibling ZERO_RESULTS into looking like a clean, healthy empty run.
  if (outcomes.some(o => o === "FAILED")) return "FAILED";
  if (outcomes.some(o => o === "DEFERRED")) return "DEFERRED";
  if (outcomes.some(o => o === "ZERO_RESULTS")) return "ZERO_RESULTS";
  return "NOT_CONFIGURED";
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

  // Prefetch ACTIVE dealer names once for in-memory lane assignment (no N+1).
  const activeDealerNames = (await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { dealershipName: true } })).map((d) => d.dealershipName);

  // Upsert to database with lane assignment + provenance. Track per-adapter upsert
  // counts so each source's InventorySyncRun reflects what IT actually ingested.
  const upsertedByAdapter = new Map<string, number>();
  let upserted = 0;
  for (const vehicle of uniqueVehicles) {
    const lane = assignLane(vehicle, activeDealerNames);

    // VIN identity: normalize + shape-validate. A malformed VIN is NOT written to
    // the global @unique slot — it falls through to the no-VIN create path so it
    // can never collide with or overwrite a valid record.
    const normalizedVin = vehicle.vin ? normalizeVin(vehicle.vin) : undefined;
    const vin = normalizedVin && isValidVin(normalizedVin) ? normalizedVin : undefined;

    if (vin) {
      const existing = await prisma.inventoryItem.findFirst({ where: { vin } });
      const priceHistory = existing
        ? [...((existing.priceHistory as Array<{ price: number; date: string }>) ?? []), { price: vehicle.priceCents, date: new Date().toISOString() }].slice(-24)
        : [{ price: vehicle.priceCents, date: new Date().toISOString() }];

      await prisma.inventoryItem.upsert({
        where: { vin },
        create: {
          vin,
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
          sourceAdapter: vehicle.sourceAdapter, // provenance — Batch 1
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
          sourceAdapter: vehicle.sourceAdapter, // keep provenance current
          priceHistory,
        },
      });
    } else {
      // No usable VIN — create only (no unique key to upsert on).
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
          sourceAdapter: vehicle.sourceAdapter, // provenance — Batch 1
          priceHistory: [{ price: vehicle.priceCents, date: new Date().toISOString() }],
          externalDealerName: vehicle.externalDealerName,
          externalDealerCity: vehicle.externalDealerCity,
          externalDealerState: vehicle.externalDealerState,
          externalListingUrl: vehicle.externalListingUrl,
        },
      }).catch(() => {}); // Ignore duplicates
    }
    upserted++;
    upsertedByAdapter.set(vehicle.sourceAdapter, (upsertedByAdapter.get(vehicle.sourceAdapter) ?? 0) + 1);
  }

  // ENH-5: Stale sweep — deactivate vehicles not seen in this run (full sync only)
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
  const healthScore = computeHealthScore(adapterResults);

  // Record one InventorySyncRun per source — the durable, truthful evidence that a
  // sync occurred and what it did. Best-effort: accounting never breaks ingestion.
  const adapterSummaries: AdapterOutcomeSummary[] = [];
  for (const r of adapterResults) {
    const { type, name } = inventorySourceForAdapter(r.adapter);
    const sourceId = await ensureInventorySource(type, name);
    const perAdapterUpserted = upsertedByAdapter.get(r.adapter) ?? 0;
    let syncRunId: string | null = null;
    if (sourceId) {
      try {
        const runRow = await prisma.inventorySyncRun.create({
          data: {
            sourceId,
            status: outcomeToStatus(r.outcome),
            vehiclesFetched: r.vehicles.length,
            vehiclesUpserted: perAdapterUpserted,
            vehiclesDeactivated: 0, // deactivation is cross-source; reported at run level below
            healthScore: r.outcome === "NOT_CONFIGURED" ? null : (r.outcome === "FAILED" || r.outcome === "DEFERRED" ? 0 : 100),
            error: r.error ?? null,
            startedAt,
            completedAt,
          },
          select: { id: true },
        });
        syncRunId = runRow.id;
        await prisma.inventorySource.update({
          where: { id: sourceId },
          data: { lastRunAt: completedAt, lastRunStatus: r.outcome, vehiclesLastCount: r.vehicles.length },
        }).catch(() => {});
      } catch (e) {
        logger.warn(`[inventory-orchestrator] InventorySyncRun write failed for ${r.adapter}:`, e);
      }
    }
    adapterSummaries.push({
      adapter: r.adapter,
      count: r.vehicles.length,
      duration: r.duration,
      configured: r.configured,
      outcome: r.outcome,
      upserted: perAdapterUpserted,
      syncRunId,
      error: r.error,
    });
  }

  const configuredSources = adapterResults.filter(r => r.configured).length;
  const attemptedSources = adapterResults.filter(r => r.outcome !== "NOT_CONFIGURED").length;
  const overall = rollUpOutcome(adapterResults.map(r => r.outcome));

  // ENH-14: Alert only on a genuine failure among sources that actually ran — never
  // for an unconfigured source (that is an ops config gap, not a health incident).
  if (healthScore !== null && healthScore < 70 && attemptedSources > 0) {
    await prisma.notification.create({
      data: {
        title: `Inventory Health Alert: ${healthScore}%`,
        body: `${adapterResults.filter(r => r.outcome === "FAILED" || r.outcome === "DEFERRED").length} of ${attemptedSources} running sources failed in the last sync.`,
        type: "SYSTEM_ALERT",
      },
    }).catch(() => {});
  }

  return {
    totalFetched,
    totalAfterDedup: uniqueVehicles.length,
    upserted,
    deactivated,
    configuredSources,
    attemptedSources,
    outcome: overall,
    adapterResults: adapterSummaries,
    healthScore,
    startedAt,
    completedAt,
  };
}

// Bootstrap seed — ENH deploy hook
export async function bootstrapInventory(): Promise<void> {
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
