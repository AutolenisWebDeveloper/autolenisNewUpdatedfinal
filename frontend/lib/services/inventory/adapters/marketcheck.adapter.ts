// MarketCheck adapter — production inventory aggregator.
// Activates when MARKETCHECK_API_KEY is set AND a market centre is supplied.
// Skips gracefully otherwise.
//
// The centre used to be `params.zip ?? "10001"` — Manhattan — and both sync crons
// called the orchestrator with no params, so every scheduled run queried New York
// regardless of where the business actually operates. There is no default market
// any more: an uncentred search reports NOT_CONFIGURED and ingests nothing, which
// is the same anti-fake-success posture this adapter already takes for a missing
// API key. A wrong market is worse than no market.
// See lib/services/inventory/market-config.ts for how the centre is resolved.
//
// API: https://www.marketcheck.com/automotive-api/
// Endpoint: GET /v2/search/car/active?api_key=...&zip=...&radius=...&rows=...
//
// Free-tier plans return up to 50 listings/call; paid tiers return up to 1000.

import { logger } from "@/lib/logger";
import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";
import { buildSourceKey } from "./IInventoryAdapter";
import { DEFAULT_RADIUS_MILES } from "../market-config";

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

    // Not configured — report NOT_CONFIGURED so the orchestrator SKIPS this
    // source from the health denominator rather than scoring an empty no-op as
    // "100% healthy". A missing credential is never a successful sync.
    if (!apiKey) {
      logger.warn("[MarketCheck adapter] MARKETCHECK_API_KEY not set — skipping. Provision the key in env to activate this source.");
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        configured: false,
        outcome: "NOT_CONFIGURED",
        fetchedAt: new Date(),
      };
    }

    // No centre — no search. A postal code, or BOTH coordinates.
    const hasCentre = Boolean(params.zip) || (params.lat !== undefined && params.lng !== undefined);
    if (!hasCentre) {
      logger.warn(
        "[MarketCheck adapter] no market centre configured — skipping. Set the InventorySource market columns, " +
          "or INVENTORY_DEFAULT_MARKET_ZIP in env, to activate this source.",
      );
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        configured: false,
        outcome: "NOT_CONFIGURED",
        error: "no_market_configured",
        fetchedAt: new Date(),
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
        // 429 / 5xx are transient — DEFERRED (retry next run), not a hard FAILED.
        const transient = response.status === 429 || response.status >= 500;
        return {
          adapter: this.name,
          vehicles: [],
          duration: Date.now() - start,
          configured: true,
          outcome: transient ? "DEFERRED" : "FAILED",
          error: `MarketCheck HTTP ${response.status}: ${response.statusText}`,
          fetchedAt: new Date(),
        };
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
        configured: true,
        // A successful call that returns nothing is ZERO_RESULTS — a legitimate
        // business result, explicitly distinct from an execution failure.
        outcome: vehicles.length > 0 ? "SUCCESS" : "ZERO_RESULTS",
        fetchedAt: new Date(),
      };
    } catch (error) {
      // Network abort / timeout — transient, DEFERRED.
      const isTimeout = error instanceof Error && /abort|timeout/i.test(error.message);
      logger.error("[MarketCheck adapter] Error:", error);
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        configured: true,
        outcome: isTimeout ? "DEFERRED" : "FAILED",
        error: error instanceof Error ? error.message : String(error),
        fetchedAt: new Date(),
      };
    }
  }

  // Callers must have established a centre before this runs (see search()).
  private buildApiUrl(params: SearchParams, apiKey: string): string {
    // MarketCheck accepts a postal-code centre or a lat/long centre; both take radius.
    const centre: Record<string, string> = params.zip
      ? { zip: params.zip }
      : { latitude: String(params.lat), longitude: String(params.lng) };

    // `makes` (market config) and `make` (a single-make search) are the same
    // provider parameter — MarketCheck takes a comma-separated list.
    const makeFilter = params.makes && params.makes.length > 0
      ? params.makes.join(",")
      : params.make;

    const query = new URLSearchParams({
      api_key: apiKey,
      car_type: "used",
      include_facets: "false",
      ...centre,
      radius: String(params.radius ?? DEFAULT_RADIUS_MILES),
      rows: String(Math.min(params.maxResults ?? 50, 50)),
      ...(makeFilter ? { make: makeFilter } : {}),
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
        externalDealerZip: listing.dealer?.zip,
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
