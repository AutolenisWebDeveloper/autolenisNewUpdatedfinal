// IInventoryAdapter — contract all 5 adapters must implement
// Each adapter is independently failure-isolated
// Failures are caught, logged, and don't block other adapters

export interface NormalizedVehicle {
  vin?: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage?: number;
  priceCents: number;
  images: string[];
  description?: string;

  // Lane 2/3 external dealer data — NEVER exposed to buyers directly
  externalDealerName?: string;
  externalDealerPhone?: string;
  externalDealerCity?: string;
  externalDealerState?: string;
  externalListingUrl?: string;

  // Deduplication key: VIN (primary) or composite (fallback)
  sourceKey: string; // VIN or "make:model:year:mileage:price"
  sourceAdapter: string;
  sourceUrl: string;
}

// Batch 1 — a truthful, mutually-exclusive outcome for a single adapter run.
// This is the anti-fake-success primitive: an unconfigured source is
// NOT_CONFIGURED (skipped, never scored), an empty-but-successful fetch is
// ZERO_RESULTS, a transient failure is DEFERRED, and a hard failure is FAILED.
// Only SUCCESS means "real vehicles were ingested".
export type AdapterOutcome =
  | "SUCCESS"
  | "ZERO_RESULTS"
  | "NOT_CONFIGURED"
  | "DEFERRED"
  | "FAILED"
  // Some pages landed and some did not (e.g. 3 good pages then a 429). The collected
  // vehicles are still ingested — discarding good data is its own dishonesty — but the run
  // must never read as a clean SUCCESS.
  | "PARTIAL"
  // We deliberately stopped to protect the provider's monthly call cap. NOT a provider
  // failure and NOT an empty market: no request was refused upstream, we declined to send
  // one. Excluded from the health denominator for exactly that reason.
  | "BUDGET_EXHAUSTED";

/** Why a paginated walk stopped. Recorded on the run for operator diagnosis. */
export type StopReason =
  | "PAGE_CAP"            // spent the per-sweep call grant
  | "PROVIDER_CEILING"    // start reached the provider's 500-row deep-paging limit
  | "NUM_FOUND_REACHED"   // collected everything the provider said existed
  | "SHORT_PAGE"          // a page returned fewer rows than asked — end of the result set
  | "NO_NEW_KEYS"         // a page contributed zero new sourceKeys (start being ignored)
  | "BUDGET_EXHAUSTED"    // the monthly ledger refused the next call
  | "DEADLINE"            // wall-clock guard, before the platform function limit
  | "PROVIDER_ERROR";     // non-OK HTTP response

export interface AdapterRunResult {
  adapter: string;
  vehicles: NormalizedVehicle[];
  duration: number;
  /** Was the provider credential/feed present so a fetch was actually attempted? */
  configured: boolean;
  /** Truthful, mutually-exclusive outcome of this run. */
  outcome: AdapterOutcome;
  error?: string;
  fetchedAt: Date;

  // ── Yield evidence. Without these the outcome cannot be audited: `vehicles.length`
  // alone cannot distinguish "the market is small" from "9 of 10 pages went missing".
  /** HTTP calls actually dispatched to the provider. */
  apiCallsUsed?: number;
  /** Pages that returned 200. */
  pagesFetched?: number;
  /** Pages that returned non-OK. */
  pagesFailed?: number;
  /** Raw listing objects received, pre-normalize and pre-dedup. */
  rawListings?: number;
  /** The provider's own claimed total for this query, from page 0 only. */
  numFound?: number | null;
  /** Why the walk stopped. */
  stopReason?: StopReason | null;
  /** Largest `dist` seen — the cheapest proof the radius config actually took effect. */
  maxDistMiles?: number | null;
  /** Whether config came from the DB row or the env fallback. */
  configSource?: "row" | "env";
  /** Resolved market, for the run record. */
  market?: { zip: string; radiusMiles: number } | null;
  /** "OK" | "SHORT" | "UNKNOWN" — UNKNOWN means num_found was absent and the gate was inert. */
  coverage?: "OK" | "SHORT" | "UNKNOWN";
}

export interface IInventoryAdapter {
  readonly name: string;
  readonly sourceName: string;

  // Each adapter independently failure-isolated — never throws, always returns result
  search(params: SearchParams): Promise<AdapterRunResult>;
}

export interface SearchParams {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  /** Integer minor units. Converted to dollars only at the provider URL boundary. */
  priceMaxCents?: number;
  zip?: string;
  radius?: number;

  // ── Pagination + spend control ────────────────────────────────────────────
  /** Rows per call. Clamped to the provider maximum inside the adapter. */
  rowsPerCall?: number;
  /** Maximum calls this sweep may make. Clamped to the compiled per-sweep cap. */
  maxCalls?: number;
  /** Monthly ledger. Every call is drawn from it immediately before dispatch. */
  budget?: CallBudgetLike;
  /** Wall-clock stop, in epoch ms, well before the platform function limit. */
  deadlineAt?: number;
}

/** The slice of the call ledger an adapter needs. Kept structural so the adapter layer does
 *  not import a service — adapters normalize and fetch; they never reach into persistence. */
export interface CallBudgetLike {
  acquire(): Promise<boolean>;
  spent(): number;
}

// Build deduplication key
export function buildSourceKey(v: Partial<NormalizedVehicle>): string {
  if (v.vin) return v.vin.toUpperCase();
  return `${v.make}:${v.model}:${v.year}:${v.mileage ?? 0}:${v.priceCents}`.toLowerCase();
}
