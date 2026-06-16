// CarGurus adapter — independently failure-isolated

import { logger } from "@/lib/logger";
import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";

export class CarGurusAdapter implements IInventoryAdapter {
  readonly name = "cargurus";
  readonly sourceName = "CarGurus";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    try {
      const response = await fetch(this.buildSearchUrl(params), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const vehicles = await this.parseResponse(response);
      return { adapter: this.name, vehicles, duration: Date.now() - start, fetchedAt: new Date() };
    } catch (error) {
      logger.error(`[CarGurus adapter] Error:`, error);
      return { adapter: this.name, vehicles: [], duration: Date.now() - start, error: String(error), fetchedAt: new Date() };
    }
  }

  private buildSearchUrl(params: SearchParams): string {
    const query = new URLSearchParams({
      ...(params.zip && { zip: params.zip }),
      ...(params.make && { make: params.make }),
      ...(params.yearMin && { yrFrom: params.yearMin.toString() }),
      ...(params.yearMax && { yrTo: params.yearMax.toString() }),
      ...(params.priceMax && { maxPrice: params.priceMax.toString() }),
    });
    return `https://www.cargurus.com/Cars/inventoryListing/viewDetailsFilterViewInventoryListing.action?${query}`;
  }

  private async parseResponse(response: Response): Promise<NormalizedVehicle[]> {
    try { await response.text(); return []; } catch { return []; }
  }
}
