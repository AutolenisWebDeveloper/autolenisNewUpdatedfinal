// TrueCar adapter — independently failure-isolated

import { logger } from "@/lib/logger";
import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";

export class TrueCarAdapter implements IInventoryAdapter {
  readonly name = "truecar";
  readonly sourceName = "TrueCar";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    try {
      const response = await fetch(this.buildSearchUrl(params), {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0)",
          "Accept": "application/json, text/html",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const vehicles = await this.parseResponse(response);
      return { adapter: this.name, vehicles, duration: Date.now() - start, fetchedAt: new Date() };
    } catch (error) {
      logger.error(`[TrueCar adapter] Error:`, error);
      return { adapter: this.name, vehicles: [], duration: Date.now() - start, error: String(error), fetchedAt: new Date() };
    }
  }

  private buildSearchUrl(params: SearchParams): string {
    const makePart = params.make ? params.make.toLowerCase().replace(/\s+/g, "-") : "used-cars";
    return `https://www.truecar.com/used-cars-for-sale/listings/${makePart}/price-below-${params.priceMax ?? 50000}/?zip=${params.zip ?? "10001"}`;
  }

  private async parseResponse(response: Response): Promise<NormalizedVehicle[]> {
    try { await response.text(); return []; } catch { return []; }
  }
}
