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
  /** Listing postal code. Carries the geography the public radius filter needs. */
  externalDealerZip?: string;
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
  | "FAILED";

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
}

export interface IInventoryAdapter {
  readonly name: string;
  readonly sourceName: string;

  // Each adapter independently failure-isolated — never throws, always returns result
  search(params: SearchParams): Promise<AdapterRunResult>;
}

export interface SearchParams {
  make?: string;
  /** Multi-make filter from market configuration. `make` stays the single-make form. */
  makes?: string[];
  model?: string;
  yearMin?: number;
  yearMax?: number;
  /** Provider-facing price ceiling in DOLLARS (priceCents is the stored unit). */
  priceMax?: number;
  zip?: string;
  /** Explicit centre, used when a market is configured by coordinates instead of a postal code. */
  lat?: number;
  lng?: number;
  radius?: number;
  maxResults?: number;
}

// Build deduplication key
export function buildSourceKey(v: Partial<NormalizedVehicle>): string {
  if (v.vin) return v.vin.toUpperCase();
  return `${v.make}:${v.model}:${v.year}:${v.mileage ?? 0}:${v.priceCents}`.toLowerCase();
}
