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
import { resolveMarketConfig, MAX_CALLS_PER_SWEEP } from "./inventory-source-config.service";
import { cycleKeyFor, rollCycleForward, makeCallBudget, makeStaticBudget } from "./inventory-call-budget.service";

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
    // Some pages landed and some did not. PARTIAL already existed in the enum and was
    // unreachable; a paginated walk is the first thing that can legitimately produce it.
    case "PARTIAL": return SyncRunStatus.PARTIAL;
    case "BUDGET_EXHAUSTED": return SyncRunStatus.BUDGET_EXHAUSTED;
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
  // BUDGET_EXHAUSTED is excluded from the denominator for the same reason NOT_CONFIGURED
  // is: no request was refused upstream, we declined to send one. Scoring a deliberate,
  // correct spend-stop as a health failure would page an operator every night for the rest
  // of the month. It surfaces through its own once-per-cycle alert instead.
  const attempted = results.filter(r => r.outcome !== "NOT_CONFIGURED" && r.outcome !== "BUDGET_EXHAUSTED");
  if (attempted.length === 0) return null;
  // PARTIAL is deliberately NOT healthy: pages went missing.
  const healthy = attempted.filter(r => r.outcome === "SUCCESS" || r.outcome === "ZERO_RESULTS").length;
  return Math.round((healthy / attempted.length) * 100);
}

export interface AdapterOutcomeSummary {
  adapter: string;
  /** Distinct vehicles that survived normalize() and in-adapter dedup. */
  count: number;
  duration: number;
  configured: boolean;
  outcome: AdapterOutcome;
  upserted: number;
  syncRunId: string | null;
  error?: string;
  // Yield evidence. `count` alone cannot distinguish "the market is small" from "9 of 10
  // pages went missing", which is precisely the ambiguity that let short runs record
  // COMPLETED for months.
  apiCallsUsed?: number;
  rawListings?: number;
  numFound?: number | null;
  stopReason?: string | null;
  coverage?: string;
  maxDistMiles?: number | null;
}

export interface OrchestratorRunResult {
  totalFetched: number;
  totalAfterDedup: number;
  upserted: number;
  /** Provider HTTP calls dispatched across all adapters — the number the monthly cap is
   *  spent against. Recorded in CronJobLog.result so spend is auditable per run. */
  apiCallsUsed: number;
  /** Where market config came from: the inventory_sources row, or the env fallback. */
  configSource: "row" | "env" | null;
  /** The market actually swept, for the run record. */
  market: { zip: string; radiusMiles: number } | null;
  /** How many sources were actually configured (credential/feed present). */
  configuredSources: number;
  /** How many sources actually ran a fetch (configured, not NOT_CONFIGURED). */
  attemptedSources: number;
  /** Roll-up outcome for the whole run. PARTIAL = some sources succeeded, some failed. */
  outcome: "SUCCESS" | "PARTIAL" | "ZERO_RESULTS" | "NOT_CONFIGURED" | "DEFERRED" | "FAILED" | "BUDGET_EXHAUSTED";
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
  // An adapter that itself came back PARTIAL makes the whole run PARTIAL. These are plain
  // string comparisons, NOT a compile-checked switch, so a new AdapterOutcome added to the
  // union does not fail the build here — it falls silently through every branch and lands
  // on NOT_CONFIGURED. That is exactly what happened to PARTIAL: it existed in the enum and
  // this function reported a run that ingested 150 vehicles as an unconfigured provider.
  // Every member of the union must therefore be named explicitly.
  if (outcomes.some(o => o === "PARTIAL")) return "PARTIAL";
  // A run where some sources succeeded and others failed is PARTIAL — never a
  // clean SUCCESS that hides the failure.
  if (hasSuccess && hasFailure) return "PARTIAL";
  if (hasSuccess) return "SUCCESS";
  // With NO success, a real failure must surface — it must NOT be masked by a
  // sibling ZERO_RESULTS into looking like a clean, healthy empty run.
  if (outcomes.some(o => o === "FAILED")) return "FAILED";
  if (outcomes.some(o => o === "DEFERRED")) return "DEFERRED";
  // A deliberate spend-stop outranks ZERO_RESULTS: "we did not ask" and "we asked and the
  // market was empty" are different facts, and only one of them needs an operator.
  if (outcomes.some(o => o === "BUDGET_EXHAUSTED")) return "BUDGET_EXHAUSTED";
  if (outcomes.some(o => o === "ZERO_RESULTS")) return "ZERO_RESULTS";
  return "NOT_CONFIGURED";
}

export async function runInventorySync(params: SearchParams = {}, mode: "full" | "priority" = "full"): Promise<OrchestratorRunResult> {
  const startedAt = new Date();

  // ── Resolve the swept market from config ──────────────────────────────────
  // Geography used to be `params.zip ?? "10001"` inside the adapter, and both crons passed
  // an empty params object, so the NYC fallback ALWAYS won. It is now config, resolved from
  // the inventory_sources row with an env fallback that keeps the code correct while the
  // migration is unapplied. An explicit caller argument still wins over both.
  const resolved = await resolveMarketConfig(InventorySourceType.MARKETCHECK, "MarketCheck");

  let searchParams: SearchParams = { ...params };
  let configSource: "row" | "env" | null = null;
  let market: { zip: string; radiusMiles: number } | null = null;
  let budget = undefined as SearchParams["budget"];
  let configFailure: { outcome: AdapterOutcome; error: string } | null = null;

  if (resolved.ok) {
    const c = resolved.config;
    configSource = c.configSource;
    market = { zip: c.zip, radiusMiles: c.radiusMiles };

    // A priority run is a manual re-check, not a sweep: one call, never ten.
    const granted = mode === "priority" ? 1 : Math.min(c.maxCallsPerRun, MAX_CALLS_PER_SWEEP);
    const cycleKey = cycleKeyFor(startedAt);

    if (c.configSource === "row" && c.sourceId) {
      await rollCycleForward(c.sourceId, cycleKey);
      budget = makeCallBudget(c.sourceId, cycleKey, c.monthlyCallBudget, granted);
    } else {
      // Config came from env, so the ledger columns do not exist yet. The compiled
      // per-sweep grant is still a hard bound: worst case 10 x 31 = 310 calls/month.
      budget = makeStaticBudget(granted);
    }

    searchParams = {
      zip: c.zip,
      radius: c.radiusMiles,
      make: c.make,
      model: c.model,
      yearMin: c.yearMin,
      yearMax: c.yearMax,
      priceMaxCents: c.priceMaxCents,
      rowsPerCall: c.rowsPerCall,
      maxCalls: granted,
      budget,
      // An explicit caller argument (e.g. an admin one-off) overrides resolved config.
      ...params,
    };
  } else {
    // A schema/config gap is NOT_CONFIGURED (an ops gap, not a health incident); a real
    // read failure is DEFERRED so a deploy-order mistake reads as the incident it is.
    configFailure = resolved.reason === "config_read_error"
      ? { outcome: "DEFERRED", error: resolved.error ?? "config read failed" }
      : { outcome: "NOT_CONFIGURED", error: resolved.reason === "source_inactive" ? "source is inactive" : "no market configured" };
  }

  // Run all adapters in parallel — each independently failure-isolated.
  // When config could not be resolved, no adapter is invoked at all: zero HTTP calls.
  const adapterResults: AdapterRunResult[] = configFailure
    ? ADAPTERS.map(a => ({
        adapter: a.name,
        vehicles: [],
        duration: 0,
        configured: configFailure!.outcome !== "NOT_CONFIGURED",
        outcome: configFailure!.outcome,
        error: configFailure!.error,
        fetchedAt: startedAt,
        apiCallsUsed: 0,
      }))
    : await Promise.all(ADAPTERS.map(adapter => adapter.search(searchParams)));

  const totalFetched = adapterResults.reduce((sum, r) => sum + r.vehicles.length, 0);

  // Deduplication pipeline
  const uniqueVehicles = deduplicateVehicles(adapterResults);

  // Prefetch ACTIVE dealer names once for in-memory lane assignment (no N+1).
  const activeDealerNames = (await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { dealershipName: true } })).map((d) => d.dealershipName);

  // Upsert to database with lane assignment + provenance. Track per-adapter upsert
  // counts so each source's InventorySyncRun reflects what IT actually ingested.
  // Prefetch existing rows for every VIN in ONE query. This used to be a findFirst per
  // vehicle inside the loop; at 500 vehicles that is 500 round-trips inside a serverless
  // function, which pagination would have turned from slow into a timeout.
  const candidateVins = uniqueVehicles
    .map(v => (v.vin ? normalizeVin(v.vin) : undefined))
    .filter((v): v is string => !!v && isValidVin(v));
  const existingByVin = new Map<string, { priceHistory: unknown }>();
  if (candidateVins.length > 0) {
    const rows = await prisma.inventoryItem.findMany({
      where: { vin: { in: candidateVins } },
      select: { vin: true, priceHistory: true },
    });
    for (const r of rows) if (r.vin) existingByVin.set(r.vin, { priceHistory: r.priceHistory });
  }

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
      const existing = existingByVin.get(vin);
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

  // The stale sweep used to run here too, with a SECOND copy of the same wrong predicate
  // (`lane != LANE_1`, no NULL branch on lastSeenAt). It now lives in exactly one place —
  // stale-sweep.service.ts, driven by the inventory-stale-sweep cron, under a dry-run
  // default and a blast-radius breaker. Ingestion must not silently deactivate rows as a
  // side effect: a sweep that hides inside a sync is a sweep nobody can dry-run.

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
        // `select` is REQUIRED, not stylistic. Without it Prisma returns every column the
        // model declares, so the moment schema.prisma names a column the database does not
        // have yet (the window between deploy and migrate) this throws P2022 — silently,
        // inside the catch below, taking the run accounting with it.
        await prisma.inventorySource.update({
          where: { id: sourceId },
          data: { lastRunAt: completedAt, lastRunStatus: r.outcome, vehiclesLastCount: r.vehicles.length },
          select: { id: true },
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
      apiCallsUsed: r.apiCallsUsed,
      rawListings: r.rawListings,
      numFound: r.numFound,
      stopReason: r.stopReason ?? null,
      coverage: r.coverage,
      maxDistMiles: r.maxDistMiles,
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
    apiCallsUsed: adapterResults.reduce((n, r) => n + (r.apiCallsUsed ?? 0), 0),
    configSource,
    market,
    configuredSources,
    attemptedSources,
    outcome: overall,
    adapterResults: adapterSummaries,
    healthScore,
    startedAt,
    completedAt,
  };
}

// Bootstrap seed — ENH deploy hook.
//
// This used to loop over a hardcoded NY/LA/Chicago/Houston/Atlanta array, ignoring whatever
// market was configured. Under pagination that would be up to 50 provider calls per button
// press — a tenth of the entire monthly allowance, spent by any SUPER_ADMIN clicking a
// fire-and-forget POST, on four markets AutoLenis does not serve.
//
// It now runs ONE budget-gated priority sweep of the configured market, which is also the
// last hardcoded geography removed from the codebase.
export async function bootstrapInventory(): Promise<void> {
  await runInventorySync({}, "priority").catch(err => {
    logger.error("[inventory-bootstrap] failed:", err);
  });
}
