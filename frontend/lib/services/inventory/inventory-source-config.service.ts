// lib/services/inventory/inventory-source-config.service.ts
//
// The swept market as CONFIG rather than a code literal.
//
// Before this file, marketcheck.adapter.ts carried `zip: params.zip ?? "10001"` and both
// inventory crons called runInventorySync({}) with an empty params object — so the NYC
// fallback always won, 100% of ingested rows carried external_dealer_state='NY', and the
// market could not be changed without a deploy. inventory_sources held one row with no
// geography and no budget columns at all.
//
// Resolution order is ROW -> ENV -> NOT_CONFIGURED. There is deliberately no built-in
// default market: a source with neither a configured zip nor an env fallback makes ZERO
// calls and reports NOT_CONFIGURED, because silently sweeping some arbitrary city is how
// the original defect stayed invisible for months.
//
// The env tier is not a convenience — it is what lets the code ship BEFORE the migration
// is applied (Prisma selects every column a model declares, so a model declaring unmigrated
// columns raises P2022). A P2021/P2022 degrades to env; any other read error is an
// incident, not a config gap.

import type { InventorySourceType } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ── Provider ceilings (MarketCheck Free tier) ────────────────────────────────
// These are compiled in and min()-ed against whatever the DB row says, so a corrupt or
// hostile config row can never raise them.

/** Free and Basic plans are both restricted to a 100 mile radius. */
export const MAX_RADIUS_MILES = 100;
/** The `rows` parameter maxes at 50 per call. */
export const MAX_ROWS_PER_CALL = 50;
/** 50 rows x 10 pages = 500 listings = the provider's own deep-paging ceiling. */
export const MAX_CALLS_PER_SWEEP = 10;
/** `start + rows` may not exceed 500; `start` past num_found returns HTTP 422. */
export const PROVIDER_PAGINATION_LIMIT = 500;

/** 10 calls/day x 31 = 310 scheduled, leaving ~90 for the admin search tool and manual
 *  re-runs against a 500/month provider cap, with 100 untouched. */
export const DEFAULT_MONTHLY_CALL_BUDGET = 400;
export const DEFAULT_RADIUS_MILES = 100;

export interface MarketConfig {
  sourceId: string | null;
  zip: string;
  radiusMiles: number;
  /** True when the configured radius exceeded the provider ceiling and was reduced. */
  radiusClamped: boolean;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  /** Integer minor units. Converted to dollars only at the adapter's URL boundary. */
  priceMaxCents?: number;
  rowsPerCall: number;
  maxCallsPerRun: number;
  /** null means unmetered — reserved for non-MarketCheck (CUSTOM dealer feed) sources. */
  monthlyCallBudget: number | null;
  configSource: "row" | "env";
}

export type MarketConfigResult =
  | { ok: true; config: MarketConfig }
  | {
      ok: false;
      sourceId: string | null;
      reason: "not_configured" | "source_inactive" | "config_read_error";
      error?: string;
    };

/**
 * Clamp a configured radius into the provider's allowed band.
 *
 * null/undefined returns the DEFAULT, never 1. Writing this as `Math.max(v ?? 1, 1)` —
 * or any variant that coerces null through a numeric floor — silently produces a
 * ONE MILE market, which looks like an empty region rather than a misconfiguration.
 */
export function clampRadius(v: number | null | undefined): { miles: number; clamped: boolean } {
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return { miles: DEFAULT_RADIUS_MILES, clamped: false };
  }
  const n = Math.floor(v);
  if (n > MAX_RADIUS_MILES) return { miles: MAX_RADIUS_MILES, clamped: true };
  if (n < 1) return { miles: 1, clamped: true };
  return { miles: n, clamped: false };
}

/**
 * Row value wins; then env; then the default. Never returns null.
 *
 * "Unset means unlimited" is the failure mode that produced 191 consecutive HTTP 429s —
 * a misconfigured environment must never be the reason an unbounded spend is permitted.
 * An explicit 0 on the row IS honoured: that is the freeze-spend switch.
 */
export function resolveMonthlyBudget(rowValue: number | null | undefined): number {
  if (typeof rowValue === "number" && Number.isFinite(rowValue) && rowValue >= 0) {
    return Math.floor(rowValue);
  }
  const raw = Number(process.env.MARKETCHECK_MONTHLY_CALL_BUDGET);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_MONTHLY_CALL_BUDGET;
}

function envZip(): string | null {
  const raw = (process.env.INVENTORY_SWEEP_ZIP ?? "").trim();
  return /^\d{5}$/.test(raw) ? raw : null;
}

function envRadius(): number | null {
  const raw = Number(process.env.INVENTORY_SWEEP_RADIUS_MILES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

/** A five-digit US zip. Anything else is refused rather than guessed at. */
function validZip(v: unknown): string | null {
  return typeof v === "string" && /^\d{5}$/.test(v.trim()) ? v.trim() : null;
}

/** Prisma raises P2021 (table missing) / P2022 (column missing) when the model declares
 *  something the database does not have yet — i.e. the migration is written but unapplied.
 *  That is an expected, survivable state, distinct from a real read failure. */
function isSchemaGapError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** The one delegate this resolver touches. Declared with method shorthand (not a function
 *  property) so a narrower test double stays assignable under TS's bivariant method
 *  parameter check — the alternative is `any`, which would hide a real shape mismatch. */
interface InventorySourceDelegate {
  findFirst(args: {
    where: { type: InventorySourceType | string; name: string };
    select: Record<string, boolean>;
  }): Promise<unknown>;
}

type Db = { inventorySource: InventorySourceDelegate };

const CONFIG_SELECT = {
  id: true, isActive: true,
  centerZip: true, radiusMiles: true,
  filterMake: true, filterModel: true, filterYearMin: true, filterYearMax: true,
  filterPriceMaxCents: true,
  rowsPerCall: true, maxCallsPerRun: true,
  monthlyCallBudget: true, callsUsedThisCycle: true, budgetCycleKey: true,
} as const;

export async function resolveMarketConfig(
  type: InventorySourceType | string,
  name: string,
  deps?: { prisma?: Db },
): Promise<MarketConfigResult> {
  const db = (deps?.prisma ?? defaultPrisma) as unknown as Db;

  let row: Record<string, unknown> | null = null;
  let configSource: "row" | "env" = "row";

  try {
    row = (await db.inventorySource.findFirst({
      where: { type, name },
      select: CONFIG_SELECT,
    })) as Record<string, unknown> | null;
  } catch (e) {
    if (!isSchemaGapError(e)) {
      logger.error("[inventory-config] source read failed:", e);
      return {
        ok: false, sourceId: null, reason: "config_read_error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
    // Migration not applied yet. Retry with only the columns that certainly exist so the
    // is_active kill switch keeps working during the window, then take config from env.
    configSource = "env";
    try {
      row = (await db.inventorySource.findFirst({
        where: { type, name },
        select: { id: true, isActive: true },
      })) as Record<string, unknown> | null;
    } catch (e2) {
      logger.error("[inventory-config] narrow source read failed:", e2);
      return {
        ok: false, sourceId: null, reason: "config_read_error",
        error: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }

  const sourceId = (row?.id as string | undefined) ?? null;

  // Honoured in BOTH schema states — this is the kill switch that needs no deploy.
  if (row && row.isActive === false) {
    return { ok: false, sourceId, reason: "source_inactive", error: "source is inactive" };
  }

  const zip = (configSource === "row" ? validZip(row?.centerZip) : null) ?? envZip();
  if (!zip) {
    // No market configured anywhere. Zero calls, and it says so — never a silent default.
    return { ok: false, sourceId, reason: "not_configured" };
  }

  const rawRadius = configSource === "row"
    ? (row?.radiusMiles as number | null | undefined) ?? envRadius()
    : envRadius();
  const { miles, clamped } = clampRadius(rawRadius);

  const asInt = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined;
  const asStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  return {
    ok: true,
    config: {
      sourceId,
      zip,
      radiusMiles: miles,
      radiusClamped: clamped,
      make: configSource === "row" ? asStr(row?.filterMake) : undefined,
      model: configSource === "row" ? asStr(row?.filterModel) : undefined,
      yearMin: configSource === "row" ? asInt(row?.filterYearMin) : undefined,
      yearMax: configSource === "row" ? asInt(row?.filterYearMax) : undefined,
      priceMaxCents: configSource === "row" ? asInt(row?.filterPriceMaxCents) : undefined,
      // Compiled ceilings win over anything the row claims.
      rowsPerCall: Math.min(
        (configSource === "row" ? asInt(row?.rowsPerCall) : undefined) ?? MAX_ROWS_PER_CALL,
        MAX_ROWS_PER_CALL,
      ),
      maxCallsPerRun: Math.min(
        (configSource === "row" ? asInt(row?.maxCallsPerRun) : undefined) ?? MAX_CALLS_PER_SWEEP,
        MAX_CALLS_PER_SWEEP,
      ),
      monthlyCallBudget: resolveMonthlyBudget(
        configSource === "row" ? (row?.monthlyCallBudget as number | null | undefined) : null,
      ),
      configSource,
    },
  };
}
