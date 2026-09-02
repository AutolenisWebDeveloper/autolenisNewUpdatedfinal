// System 15 — Inventory Orchestrator
// Runs all configured adapters independently, deduplicates, assigns lanes, upserts to DB.
// Each adapter is failure-isolated — one adapter failing never blocks others.
//
// Active adapters:
//   - MarketCheckAdapter: real production aggregator (gated by MARKETCHECK_API_KEY
//     and by a configured market — see market-config.ts)
//
// NOT active: adapters/custom.adapter.ts. The header used to claim dealer-supplied
// feeds were "instantiated per source row in DB"; they never were — the previous
// code was a literal `[new MarketCheckAdapter()]`, and BUILTIN_ADAPTERS below still
// covers only MARKETCHECK. A CUSTOM InventorySource row is invisible to the sync.
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
import { InventoryLane, InventorySourceType, Prisma, SyncRunStatus } from "@prisma/client";
import { normalizeVin, isValidVin } from "@/lib/utils/vin";
import { lookupZip } from "@/lib/utils/zip-coords";
import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, AdapterOutcome, SearchParams } from "./adapters/IInventoryAdapter";
import { MarketCheckAdapter } from "./adapters/marketcheck.adapter";
import { resolveMarket, describeMarket, type MarketConfigRow, type ResolvedMarket } from "./market-config";
import { staleSweepWhere } from "./inventory-eligibility";

// Built-in adapters, keyed by the InventorySource type they serve. A SOURCE ROW
// selects its adapter — the inverse of the old arrangement, where an adapter
// invented a source name after the fact. That inversion is what lets one adapter
// serve several markets: one row per (type, market), each with its own geography.
const BUILTIN_ADAPTERS: ReadonlyArray<{ type: InventorySourceType; defaultName: string; make: () => IInventoryAdapter }> = [
  { type: InventorySourceType.MARKETCHECK, defaultName: "MarketCheck", make: () => new MarketCheckAdapter() },
];

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

/**
 * Postgres 42703 / Prisma P2022 — "column does not exist".
 *
 * The market_* columns arrive with a migration the owner applies out of band, and
 * Prisma selects every column a model declares. Between deploying this code and
 * applying that migration, an InventorySource read fails outright and would take
 * inventory sync down. This detects that ONE case — narrowed to OUR columns, never
 * a bare catch — so the window degrades to "env-configured market" instead. A
 * different pending column on the same table is a real schema problem and surfaces.
 */
function isMissingMarketColumnError(e: unknown): boolean {
  const err = e as
    | { code?: unknown; meta?: { column?: unknown; target?: unknown }; message?: unknown }
    | null;
  if (err?.code !== "P2022" && err?.code !== "42703") return false;
  // P2022 is raised by the Rust query engine, and which key carries the column
  // name has moved between Prisma versions (`meta.column`, `meta.target`) while
  // the message has always contained it ("The column `x` does not exist in the
  // current database."). Check all three rather than betting on one shape — a
  // guard that silently stops matching would turn the pre-migration window back
  // into an outage without any signal that it had.
  const haystack = [err?.meta?.column, err?.meta?.target, err?.message]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v))
    .join(" ");
  return haystack.includes("market_");
}

/** One adapter run against one configured market. */
export interface MarketPlan {
  type: InventorySourceType;
  sourceName: string;
  sourceId: string | null;
  adapter: IInventoryAdapter;
  market: ResolvedMarket;
}

// The exact fields a market plan needs. An explicit `select` keeps the compile-time
// link between schema.prisma and this feature: read through a `Record<string, unknown>`
// cast instead, every field would silently be `undefined` if a column were renamed or
// dropped, and `pnpm typecheck` would stay green with the whole path dead.
const MARKET_SOURCE_SELECT = {
  id: true,
  type: true,
  name: true,
  isActive: true,
  marketLabel: true,
  marketZip: true,
  marketLat: true,
  marketLng: true,
  marketRadiusMiles: true,
  marketMakes: true,
  marketPriceMaxCents: true,
  marketYearMin: true,
  marketYearMax: true,
} as const;

type MarketSourceRow = Prisma.InventorySourceGetPayload<{ select: typeof MARKET_SOURCE_SELECT }>;

/** Read the market columns off a source row, normalising Prisma Decimals to numbers. */
function marketConfigOf(row: MarketSourceRow): MarketConfigRow {
  const dec = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));
  return {
    marketLabel: row.marketLabel,
    marketZip: row.marketZip,
    marketLat: dec(row.marketLat),
    marketLng: dec(row.marketLng),
    marketRadiusMiles: row.marketRadiusMiles,
    marketMakes: row.marketMakes,
    marketPriceMaxCents: row.marketPriceMaxCents,
    marketYearMin: row.marketYearMin,
    marketYearMax: row.marketYearMax,
  };
}

/**
 * Which markets to sync, resolved BEFORE any adapter runs.
 *
 * Ordering defect this fixes: ensureInventorySource() used to run AFTER the
 * adapters, so on a fresh database the source row did not exist while the sync was
 * deciding what to query — market configuration cannot be read from a row created
 * later. Sources are resolved first, which also gives every run a real sourceId to
 * attribute its InventorySyncRun to.
 */
export async function resolveMarketPlans(params: SearchParams = {}): Promise<MarketPlan[]> {
  let activeRows: MarketSourceRow[] = [];
  let anyRowExists = new Set<InventorySourceType>();
  let migrationPending = false;
  try {
    const rows = await prisma.inventorySource.findMany({
      where: { type: { in: BUILTIN_ADAPTERS.map((a) => a.type) } },
      orderBy: { createdAt: "asc" },
      select: MARKET_SOURCE_SELECT,
    });
    anyRowExists = new Set(rows.map((r) => r.type));
    activeRows = rows.filter((r) => r.isActive);
  } catch (e) {
    if (!isMissingMarketColumnError(e)) throw e;
    migrationPending = true;
    logger.warn(
      "[inventory-orchestrator] inventory_sources is missing the market_* columns — the market-config " +
        "migration has not been applied. Falling back to INVENTORY_DEFAULT_MARKET_ZIP for this run.",
    );
  }

  const plans: MarketPlan[] = [];
  for (const builtin of BUILTIN_ADAPTERS) {
    const forType = activeRows.filter((r) => r.type === builtin.type);

    if (forType.length === 0) {
      // Rows exist for this type but every one is deactivated. `isActive: false` is
      // the operator's off switch and it must actually switch the source off —
      // the "no rows" branch below would otherwise re-register and run it from env,
      // so deactivating a source silently kept syncing it.
      if (anyRowExists.has(builtin.type)) {
        logger.info(`[inventory-orchestrator] ${builtin.type}: all sources deactivated — not syncing.`);
        continue;
      }
      // Genuinely no row yet (fresh database, or the migration is still pending).
      // Register one so the run is accounted for, and resolve from explicit + env.
      const sourceId = migrationPending ? null : await ensureInventorySource(builtin.type, builtin.defaultName);
      plans.push({
        type: builtin.type,
        sourceName: builtin.defaultName,
        sourceId,
        adapter: builtin.make(),
        market: resolveMarket(params, null),
      });
      continue;
    }

    for (const row of forType) {
      plans.push({
        type: builtin.type,
        sourceName: row.name,
        sourceId: row.id,
        adapter: builtin.make(),
        market: resolveMarket(params, marketConfigOf(row)),
      });
    }
  }
  return plans;
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
//
// The winning vehicle carries the index of the PLAN that produced it. With one
// adapter serving several markets, `sourceAdapter` is "marketcheck" for all of
// them, so attributing upserts by adapter name would collapse every market into a
// single count. Two markets that overlap (a car listed within both radii) are one
// vehicle, credited to the first plan that returned it.
interface DedupedVehicle { vehicle: NormalizedVehicle; planIndex: number }

function deduplicateVehicles(results: AdapterRunResult[]): DedupedVehicle[] {
  const seen = new Map<string, DedupedVehicle>();
  results.forEach((result, planIndex) => {
    for (const vehicle of result.vehicles) {
      const key = vehicle.sourceKey;
      const current = seen.get(key);
      if (!current) {
        seen.set(key, { vehicle, planIndex });
      } else if (vehicle.images.length > current.vehicle.images.length) {
        // Richer record wins, but the ORIGINAL plan keeps the credit.
        seen.set(key, { vehicle, planIndex: current.planIndex });
      }
    }
  });
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
  /** The InventorySource row this run belongs to. */
  sourceName: string;
  /** Human-readable market queried, e.g. "Dallas-Fort Worth 75201 r=75mi (source)". */
  market: string;
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
  /** How many source rows had a usable market centre. Zero means nothing was queried. */
  configuredMarkets: number;
  /** Per-vehicle writes that failed. Non-zero means the run ingested partially. */
  upsertFailures: number;
  /** Why the full-sync sweep did not run, or null when it did (or was not due). */
  sweepSkippedReason: string | null;
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

  // Resolve WHICH MARKETS to sync before anything runs (see resolveMarketPlans).
  const plans = await resolveMarketPlans(params);
  for (const plan of plans) {
    logger.info(`[inventory-orchestrator] ${plan.sourceName}: ${describeMarket(plan.market)}`);
  }

  // Run every plan in parallel — each independently failure-isolated. An
  // unconfigured market never reaches its adapter: it short-circuits to
  // NOT_CONFIGURED so it is skipped from the health denominator rather than
  // scored, exactly as a missing credential is.
  const adapterResults = await Promise.all(
    plans.map(async (plan): Promise<AdapterRunResult> => {
      if (!plan.market.configured) {
        logger.warn(
          `[inventory-orchestrator] ${plan.sourceName} has no market configured — skipping. ` +
            `Set its market_zip (or market_lat/market_lng), or INVENTORY_DEFAULT_MARKET_ZIP in env.`,
        );
        return {
          adapter: plan.adapter.name,
          vehicles: [],
          duration: 0,
          configured: false,
          outcome: "NOT_CONFIGURED",
          error: "no_market_configured",
          fetchedAt: new Date(),
        };
      }
      return plan.adapter.search({ ...plan.market.params, maxResults: mode === "full" ? 100 : 25 });
    }),
  );

  const totalFetched = adapterResults.reduce((sum, r) => sum + r.vehicles.length, 0);

  // Deduplication pipeline
  const uniqueVehicles = deduplicateVehicles(adapterResults);

  // Prefetch ACTIVE dealer names once for in-memory lane assignment (no N+1).
  const activeDealerNames = (await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { dealershipName: true } })).map((d) => d.dealershipName);

  // Upsert to database with lane assignment + provenance. Track per-adapter upsert
  // counts so each source's InventorySyncRun reflects what IT actually ingested.
  const upsertedByPlan = new Map<number, number>();
  let upserted = 0;
  let upsertFailures = 0;
  for (const { vehicle, planIndex } of uniqueVehicles) {
    const lane = assignLane(vehicle, activeDealerNames);

    // Listing geography. Without it every aggregator row has NULL coordinates and
    // the public catalogue's ZIP+radius filter (app/api/public/inventory/route.ts:
    // bounding box on latitude/longitude, then a haversine pass) drops the row.
    // Repointing the market to Dallas would otherwise leave a Dallas buyer with
    // zero results — the market change would be invisible to the people it is for.
    const listingZip = vehicle.externalDealerZip?.trim().slice(0, 5) || undefined;
    const coords = listingZip ? lookupZip(listingZip) : null;
    const geography = {
      city: vehicle.externalDealerCity,
      state: vehicle.externalDealerState,
      zip: listingZip,
      ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
    };

    // One row must not abort the batch. The VIN path is a findFirst then upsert on
    // a globally unique column, so a concurrent run can lose that race with P2002;
    // letting it throw left every REMAINING vehicle un-stamped, and an un-stamped
    // vehicle is a sweep candidate. Failures are counted and reported, never
    // swallowed — and a non-zero count blocks this run's sweep (see below).
    try {

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
          ...geography,
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
          ...geography,
          priceCents: vehicle.priceCents,
          mileage: vehicle.mileage,
          images: vehicle.images.length > 0 ? vehicle.images : undefined,
          // NEVER restamp lane or provenance on a DEALER-OWNED row. assignLane()
          // can only return LANE_2/LANE_3, so an aggregator run that happened to
          // carry a dealer's VIN used to demote that dealer's LANE_1 listing and
          // overwrite sourceAdapter from "dealer_manual" to "marketcheck" —
          // silently converting dealer inventory into aggregator inventory.
          ...(existing?.dealerId ? {} : { lane, sourceAdapter: vehicle.sourceAdapter }),
          isActive: true,
          lastSeenAt: new Date(),
          priceHistory,
        },
      });
    } else {
      // No usable VIN — create only (no unique key to upsert on).
      await prisma.inventoryItem.create({
        data: {
          ...geography,
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
      });
    }
    upserted++;
    upsertedByPlan.set(planIndex, (upsertedByPlan.get(planIndex) ?? 0) + 1);
    } catch (e) {
      upsertFailures++;
      logger.warn(`[inventory-orchestrator] upsert failed for ${vehicle.sourceKey}:`, e);
    }
  }
  if (upsertFailures > 0) {
    logger.error(`[inventory-orchestrator] ${upsertFailures} of ${uniqueVehicles.length} vehicle writes failed.`);
  }

  // ENH-5: Stale sweep — deactivate vehicles not seen in this run (full sync only).
  //
  // Uses the SAME predicate as the inventory-stale-sweep cron (staleSweepWhere in
  // inventory-eligibility.ts). It used to carry its own hand-copied copy, including
  // the `lane: { not: LANE_1 }` filter that exempted 95 production rows which had
  // no dealer behind them and so never aged out.
  //
  // GATED ON RUN HEALTH. The sweep deactivates rows this run did not re-stamp, so
  // running it after a provider failure or a partial write empties the catalogue
  // for a reason that has nothing to do with the listings. The old lane exemption
  // masked this; with the exemption correctly narrowed it becomes live and
  // destructive — eight consecutive 6-hourly MarketCheck outages span the 48h
  // window and would take the entire external catalogue down. Skipping costs
  // nothing: the window gives eight runs of slack, and the standalone
  // inventory-stale-sweep cron still runs every 30 minutes.
  let deactivated = 0;
  let sweepSkippedReason: string | null = null;
  if (mode === "full") {
    const unhealthy = adapterResults.filter((r) => r.outcome === "FAILED" || r.outcome === "DEFERRED");
    if (unhealthy.length > 0) {
      sweepSkippedReason = `${unhealthy.length} source(s) failed or deferred this run`;
    } else if (upsertFailures > 0) {
      sweepSkippedReason = `${upsertFailures} vehicle write(s) failed this run`;
    }
    if (sweepSkippedReason) {
      logger.warn(`[inventory-orchestrator] stale sweep SKIPPED: ${sweepSkippedReason}.`);
    } else {
      const staleResult = await prisma.inventoryItem.updateMany({
        where: staleSweepWhere(),
        data: { isActive: false },
      });
      deactivated = staleResult.count;
    }
  }

  const completedAt = new Date();
  const healthScore = computeHealthScore(adapterResults);

  // Record one InventorySyncRun per source — the durable, truthful evidence that a
  // sync occurred and what it did. Best-effort: accounting never breaks ingestion.
  const adapterSummaries: AdapterOutcomeSummary[] = [];
  for (let i = 0; i < adapterResults.length; i++) {
    const r = adapterResults[i]!;
    const plan = plans[i]!;
    // The source row was resolved BEFORE the run; only fall back to registering one
    // when the market-config migration is still pending (sourceId null).
    const sourceId = plan.sourceId ?? (await ensureInventorySource(plan.type, plan.sourceName));
    const perAdapterUpserted = upsertedByPlan.get(i) ?? 0;
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
      sourceName: plan.sourceName,
      market: describeMarket(plan.market),
    });
  }

  const configuredSources = adapterResults.filter(r => r.configured).length;
  const attemptedSources = adapterResults.filter(r => r.outcome !== "NOT_CONFIGURED").length;
  const configuredMarkets = plans.filter(p => p.market.configured).length;
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
    configuredMarkets,
    upsertFailures,
    sweepSkippedReason,
    startedAt,
    completedAt,
  };
}

// Bootstrap seed — ENH deploy hook.
//
// This used to iterate a hardcoded five-market array (New York, Los Angeles,
// Chicago, Houston, Atlanta) and was the second place a New York default was baked
// into the codebase. Markets are configuration now, so bootstrap runs a priority
// sync over whatever markets are actually configured; with none configured it
// ingests nothing and says so, instead of seeding five cities the business does
// not serve.
export async function bootstrapInventory(): Promise<OrchestratorRunResult | null> {
  // No params: the market comes from configuration, and `mode` already decides
  // maxResults inside runInventorySync — passing one here would be a silent no-op.
  const result = await runInventorySync({}, "priority").catch((err) => {
    logger.error("[inventory-orchestrator] bootstrap failed:", err);
    return null;
  });
  if (result && result.configuredMarkets === 0) {
    logger.warn(
      "[inventory-orchestrator] bootstrap ingested nothing: no market is configured. " +
        "Configure an InventorySource market, or set INVENTORY_DEFAULT_MARKET_ZIP.",
    );
  }
  return result;
}
