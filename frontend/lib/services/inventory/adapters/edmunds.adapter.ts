// Edmunds adapter — independently failure-isolated
// Edmunds has a public REST API (no key required for basic searches)

import { logger } from "@/lib/logger";
import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";
import { buildSourceKey } from "./IInventoryAdapter";

interface EdmundsListing {
  vin?: string;
  year: number;
  make: { name: string };
  model: { name: string };
  trim?: string;
  mileage?: number;
  prices?: { displayPrice?: number };
  photos?: Array<{ href: string }>;
  dealer?: { name: string; phone?: string; location?: { city: string; stateCode: string } };
  vehicleInfo?: { styleInfo?: { trim: string } };
}

export class EdmundsAdapter implements IInventoryAdapter {
  readonly name = "edmunds";
  readonly sourceName = "Edmunds";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    try {
      const response = await fetch(this.buildApiUrl(params), {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as { inventories?: { results?: EdmundsListing[] } };
      const results = data.inventories?.results ?? [];
      const vehicles = results.slice(0, params.maxResults ?? 50).map(l => this.normalize(l)).filter(Boolean) as NormalizedVehicle[];

      return { adapter: this.name, vehicles, duration: Date.now() - start, fetchedAt: new Date() };
    } catch (error) {
      logger.error(`[Edmunds adapter] Error:`, error);
      return { adapter: this.name, vehicles: [], duration: Date.now() - start, error: String(error), fetchedAt: new Date() };
    }
  }

  private buildApiUrl(params: SearchParams): string {
    const query = new URLSearchParams({
      zip: params.zip ?? "10001",
      radius: (params.radius ?? 100).toString(),
      ...(params.make && { make: params.make }),
      ...(params.model && { model: params.model }),
      ...(params.yearMin && { "year.min": params.yearMin.toString() }),
      ...(params.yearMax && { "year.max": params.yearMax.toString() }),
      ...(params.priceMax && { "prices.displayPrice.max": params.priceMax.toString() }),
      pagesize: (params.maxResults ?? 50).toString(),
    });
    return `https://api.edmunds.com/api/inventory/v2/inventories?${query}`;
  }

  private normalize(listing: EdmundsListing): NormalizedVehicle | null {
    try {
      const price = listing.prices?.displayPrice;
      if (!price || price <= 0) return null;

      const vehicle: NormalizedVehicle = {
        vin: listing.vin,
        year: listing.year,
        make: listing.make.name,
        model: listing.model.name,
        trim: listing.trim ?? listing.vehicleInfo?.styleInfo?.trim,
        mileage: listing.mileage,
        priceCents: Math.round(price * 100),
        images: listing.photos?.map(p => p.href) ?? [],
        externalDealerName: listing.dealer?.name,
        externalDealerPhone: listing.dealer?.phone,
        externalDealerCity: listing.dealer?.location?.city,
        externalDealerState: listing.dealer?.location?.stateCode,
        externalListingUrl: `https://www.edmunds.com/vin/${listing.vin ?? ""}`,
        sourceAdapter: this.name,
        sourceUrl: `https://www.edmunds.com`,
        sourceKey: "",
      };
      vehicle.sourceKey = buildSourceKey(vehicle);
      return vehicle;
    } catch { return null; }
  }
}
