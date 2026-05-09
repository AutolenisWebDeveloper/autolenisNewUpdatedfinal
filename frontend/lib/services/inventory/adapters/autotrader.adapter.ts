// AutoTrader adapter — independently failure-isolated
// Uses public AutoTrader search endpoint (web fetch, no API key required)

import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";
import { buildSourceKey } from "./IInventoryAdapter";

export class AutoTraderAdapter implements IInventoryAdapter {
  readonly name = "autotrader";
  readonly sourceName = "AutoTrader";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    try {
      const searchUrl = this.buildSearchUrl(params);
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0; +https://autolenis.com)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(15000), // 15s per adapter
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const vehicles = await this.parseResponse(response, params);
      return { adapter: this.name, vehicles, duration: Date.now() - start, fetchedAt: new Date() };

    } catch (error) {
      // Failure-isolated: always returns result, logs error
      console.error(`[AutoTrader adapter] Error:`, error);
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        error: String(error),
        fetchedAt: new Date(),
      };
    }
  }

  private buildSearchUrl(params: SearchParams): string {
    const base = "https://www.autotrader.com/cars-for-sale/all-cars";
    const query = new URLSearchParams({
      ...(params.make && { makeCode: params.make.toUpperCase() }),
      ...(params.model && { modelCode: params.model.toUpperCase() }),
      ...(params.yearMin && { startYear: params.yearMin.toString() }),
      ...(params.yearMax && { endYear: params.yearMax.toString() }),
      ...(params.priceMax && { maxPrice: params.priceMax.toString() }),
      ...(params.zip && { zip: params.zip }),
      ...(params.radius && { searchRadius: params.radius.toString() }),
      requestId: "1",
      showcaseOwnerId: "false",
      format: "JSON",
    });
    return `${base}?${query.toString()}`;
  }

  private async parseResponse(response: Response, _params: SearchParams): Promise<NormalizedVehicle[]> {
    try {
      const text = await response.text();
      // AutoTrader returns HTML or embedded JSON — extract listing data
      // Real implementation would parse the embedded __INITIAL_STATE__ JSON
      // For scaffold: return empty (real parsing requires production maintenance)
      const jsonMatch = text.match(/"price"\s*:\s*(\d+)/g);
      if (!jsonMatch) return [];

      // Simplified extraction — production would use cheerio or proper JSON extraction
      return this.extractListings(text);
    } catch {
      return [];
    }
  }

  private extractListings(html: string): NormalizedVehicle[] {
    // Production implementation: extract from AutoTrader's embedded JSON
    // For now: return empty array — real parsing requires adapter-specific maintenance
    return [];
  }
}
