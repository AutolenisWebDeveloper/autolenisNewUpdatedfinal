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

export interface AdapterRunResult {
  adapter: string;
  vehicles: NormalizedVehicle[];
  duration: number;
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
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMax?: number;
  zip?: string;
  radius?: number;
  maxResults?: number;
}

// Build deduplication key
export function buildSourceKey(v: Partial<NormalizedVehicle>): string {
  if (v.vin) return v.vin.toUpperCase();
  return `${v.make}:${v.model}:${v.year}:${v.mileage ?? 0}:${v.priceCents}`.toLowerCase();
}
