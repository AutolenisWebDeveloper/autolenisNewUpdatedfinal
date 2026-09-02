// lib/services/inventory/market-config.ts
//
// THE SERVED MARKET — which geography the inventory aggregator is queried with.
//
// Before this module the answer was a single `??` in the MarketCheck adapter:
//
//     zip: params.zip ?? "10001"        // adapters/marketcheck.adapter.ts
//
// 10001 is Manhattan. Both sync crons call runInventorySync({}, ...) with no
// params, so that fallback won every scheduled run, and the catalogue came out
// 93% New York for a business serving Dallas-Fort Worth. Nothing in the database
// or the environment could change it.
//
// The market is now resolved in a fixed, documented order:
//
//   1. explicit  — SearchParams passed to runInventorySync (admin / manual runs)
//   2. source    — the InventorySource row's market_* columns
//   3. env       — INVENTORY_DEFAULT_MARKET_ZIP / _RADIUS_MILES / _MARKET_LABEL
//   4. nothing   — the source reports NOT_CONFIGURED and ingests no vehicles
//
// Step 4 is the point. There is deliberately NO compiled-in default market: a
// wrong market is worse than no market, and "silently syncing Manhattan" is
// exactly the failure this module exists to make impossible. An unconfigured
// source is a config gap the existing NOT_CONFIGURED outcome and health alerting
// already surface honestly (see IInventoryAdapter.AdapterOutcome).
//
// Env sits BELOW the database but ABOVE nothing on purpose: the market_* columns
// do not exist until the owner applies the migration, so a single Vercel env var
// re-points the market during the window before that happens.

import type { SearchParams } from "./adapters/IInventoryAdapter";

/**
 * A plain env map. Deliberately NOT NodeJS.ProcessEnv: env.d.ts declares the
 * platform's required variables, so that type cannot be satisfied by a test
 * fixture holding two keys.
 */
export type MarketEnv = Record<string, string | undefined>;

export const ENV_MARKET_ZIP = "INVENTORY_DEFAULT_MARKET_ZIP";
export const ENV_MARKET_RADIUS = "INVENTORY_DEFAULT_RADIUS_MILES";
export const ENV_MARKET_LABEL = "INVENTORY_DEFAULT_MARKET_LABEL";

/** Radius used when a centre is configured but no radius is. */
export const DEFAULT_RADIUS_MILES = 75;

/**
 * The market columns of an InventorySource row.
 *
 * Decimal columns arrive from Prisma as `Decimal`; callers pass them through
 * `Number()` (or null) before handing the row here, so this module stays free of
 * a Prisma runtime dependency and is unit-testable without a database.
 */
export interface MarketConfigRow {
  marketLabel: string | null;
  marketZip: string | null;
  marketLat: number | null;
  marketLng: number | null;
  marketRadiusMiles: number | null;
  marketMakes: string[];
  marketPriceMaxCents: number | null;
  marketYearMin: number | null;
  marketYearMax: number | null;
}

export type MarketOrigin = "explicit" | "source" | "env" | "none";

export interface ResolvedMarket {
  /** Human label for logs and the sync-run record. */
  label: string | null;
  /** Which layer supplied the CENTRE (the thing that decides the geography). */
  origin: MarketOrigin;
  /** False when no layer supplied a usable centre — the source must not run. */
  configured: boolean;
  params: SearchParams;
}

/** Absent, blank, or whitespace-only is NOT SET. */
function str(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A positive finite number, or undefined. Never NaN. */
function posNum(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A finite number (may be negative — longitudes are), or undefined. */
function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** A centre is a postal code, or BOTH coordinates. Half a pair centres nothing. */
function hasCentre(zip: string | undefined, lat: number | undefined, lng: number | undefined): boolean {
  return zip !== undefined || (lat !== undefined && lng !== undefined);
}

/**
 * Resolve the market for one source.
 *
 * `env` is injected rather than read from `process.env` directly so the
 * resolution order is testable without mutating the process environment.
 */
export function resolveMarket(
  explicit: SearchParams = {},
  row: MarketConfigRow | null,
  env: MarketEnv = process.env,
): ResolvedMarket {
  // ── layer 1: explicit ────────────────────────────────────────────────────
  const exZip = str(explicit.zip);
  const exLat = num(explicit.lat);
  const exLng = num(explicit.lng);
  if (hasCentre(exZip, exLat, exLng)) {
    return {
      label: null,
      origin: "explicit",
      configured: true,
      params: {
        ...explicit,
        zip: exZip,
        lat: exLat,
        lng: exLng,
        radius: posNum(explicit.radius) ?? DEFAULT_RADIUS_MILES,
      },
    };
  }

  // ── layer 2: the InventorySource row ─────────────────────────────────────
  //
  // A lower layer supplies the CENTRE, but it never overwrites a field the caller
  // stated explicitly. `runInventorySync({ radius: 25 })` with no zip must still
  // mean 25 miles around the configured centre, not the row's radius — otherwise
  // "explicit wins" would be true only for the one field that selects the layer.
  const rowZip = str(row?.marketZip);
  const rowLat = num(row?.marketLat);
  const rowLng = num(row?.marketLng);
  if (row && hasCentre(rowZip, rowLat, rowLng)) {
    const makes = (row.marketMakes ?? []).map((m) => str(m)).filter((m): m is string => m !== undefined);
    const priceMaxCents = posNum(row.marketPriceMaxCents);
    return {
      label: str(row.marketLabel) ?? null,
      origin: "source",
      configured: true,
      params: {
        ...explicit,
        zip: rowZip,
        lat: rowLat,
        lng: rowLng,
        radius: posNum(explicit.radius) ?? posNum(row.marketRadiusMiles) ?? DEFAULT_RADIUS_MILES,
        ...(explicit.makes === undefined && makes.length > 0 ? { makes } : {}),
        // priceCents is the stored unit; the provider's price_max is dollars.
        ...(explicit.priceMax === undefined && priceMaxCents !== undefined
          ? { priceMax: Math.round(priceMaxCents / 100) }
          : {}),
        ...(explicit.yearMin === undefined && posNum(row.marketYearMin) !== undefined
          ? { yearMin: posNum(row.marketYearMin) }
          : {}),
        ...(explicit.yearMax === undefined && posNum(row.marketYearMax) !== undefined
          ? { yearMax: posNum(row.marketYearMax) }
          : {}),
      },
    };
  }

  // ── layer 3: environment ─────────────────────────────────────────────────
  const envZip = str(env[ENV_MARKET_ZIP]);
  if (envZip !== undefined) {
    return {
      label: str(env[ENV_MARKET_LABEL]) ?? null,
      origin: "env",
      configured: true,
      params: {
        ...explicit,
        zip: envZip,
        radius: posNum(explicit.radius) ?? posNum(env[ENV_MARKET_RADIUS]) ?? DEFAULT_RADIUS_MILES,
      },
    };
  }

  // ── layer 4: nothing. Never a default market. ────────────────────────────
  return { label: null, origin: "none", configured: false, params: { ...explicit } };
}

/** One-line description for logs and operator-facing run records. */
export function describeMarket(market: ResolvedMarket): string {
  if (!market.configured) return "unconfigured";
  const centre = market.params.zip ?? `${market.params.lat},${market.params.lng}`;
  const label = market.label ? `${market.label} ` : "";
  return `${label}${centre} r=${market.params.radius}mi (${market.origin})`;
}
