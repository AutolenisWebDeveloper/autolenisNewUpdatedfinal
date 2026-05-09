// MarketCheck adapter — production inventory aggregator.
// Activates when MARKETCHECK_API_KEY is set. Skips gracefully otherwise.
//
// API: https://www.marketcheck.com/automotive-api/
// Endpoint: GET /v2/search/car/active?api_key=...&zip=...&radius=...&rows=...
//
// Free-tier plans return up to 50 listings/call; paid tiers return up to 1000.

import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";
import { buildSourceKey } from "./IInventoryAdapter";

interface MarketCheckListing {
  id?: string;
  vin?: string;
  build?: {
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    body_type?: string;
    engine?: string;
    transmission?: string;
    drivetrain?: string;
  };
  miles?: number;
  price?: number;
  msrp?: number;
  exterior_color?: string;
  interior_color?: string;
  media?: { photo_links?: string[] };
  vdp_url?: string;
  dealer?: {
    name?: string;
    phone?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

interface MarketCheckResponse {
  num_found?: number;
  listings?: MarketCheckListing[];
}

export class MarketCheckAdapter implements IInventoryAdapter {
  readonly name = "marketcheck";
  readonly sourceName = "MarketCheck";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    const apiKey = process.env.MARKETCHECK_API_KEY;

    // Gracefully skip when not configured — never fail the orchestrator
    if (!apiKey) {
      // eslint-disable-next-line no-console
      console.warn("[MarketCheck adapter] MARKETCHECK_API_KEY not set — skipping. Provision the key in env to activate this source.");
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        fetchedAt: new Date(),
        // Note: no `error` field so the orchestrator treats this as a clean no-op rather than a failure
      };
    }

    try {
      const url = this.buildApiUrl(params, apiKey);
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "AutoLenis/1.0",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        throw new Error(`MarketCheck HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as MarketCheckResponse;
      const listings = data.listings ?? [];
      const vehicles = listings
        .map((l) => this.normalize(l))
        .filter((v): v is NormalizedVehicle => v !== null);

      return {
        adapter: this.name,
        vehicles,
        duration: Date.now() - start,
        fetchedAt: new Date(),
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[MarketCheck adapter] Error:", error);
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        fetchedAt: new Date(),
      };
    }
  }

  private buildApiUrl(params: SearchParams, apiKey: string): string {
    const query = new URLSearchParams({
      api_key: apiKey,
      car_type: "used",
      include_facets: "false",
      zip: params.zip ?? "10001",
      radius: String(params.radius ?? 100),
      rows: String(Math.min(params.maxResults ?? 50, 50)),
      ...(params.make ? { make: params.make } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.yearMin ? { year_min: String(params.yearMin) } : {}),
      ...(params.yearMax ? { year_max: String(params.yearMax) } : {}),
      ...(params.priceMax ? { price_max: String(params.priceMax) } : {}),
    });
    return `https://api.marketcheck.com/v2/search/car/active?${query.toString()}`;
  }

  private normalize(listing: MarketCheckListing): NormalizedVehicle | null {
    try {
      const year = listing.build?.year;
      const make = listing.build?.make;
      const model = listing.build?.model;
      const price = listing.price;
      if (!year || !make || !model || !price || price <= 0) return null;

      const vehicle: NormalizedVehicle = {
        vin: listing.vin,
        year,
        make,
        model,
        trim: listing.build?.trim,
        mileage: listing.miles,
        priceCents: Math.round(price * 100),
        images: listing.media?.photo_links?.slice(0, 6) ?? [],
        externalDealerName: listing.dealer?.name,
        externalDealerPhone: listing.dealer?.phone,
        externalDealerCity: listing.dealer?.city,
        externalDealerState: listing.dealer?.state,
        externalListingUrl: listing.vdp_url,
        sourceAdapter: this.name,
        sourceUrl: "https://www.marketcheck.com",
        sourceKey: "",
      };
      vehicle.sourceKey = buildSourceKey(vehicle);
      return vehicle;
    } catch {
      return null;
    }
  }
}
