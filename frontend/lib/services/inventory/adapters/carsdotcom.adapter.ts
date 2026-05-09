// Cars.com adapter — independently failure-isolated

import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";

export class CarsDotComAdapter implements IInventoryAdapter {
  readonly name = "carsdotcom";
  readonly sourceName = "Cars.com";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    try {
      const searchUrl = this.buildSearchUrl(params);
      const response = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0)" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const vehicles = await this.parseResponse(response);
      return { adapter: this.name, vehicles, duration: Date.now() - start, fetchedAt: new Date() };

    } catch (error) {
      console.error(`[Cars.com adapter] Error:`, error);
      return { adapter: this.name, vehicles: [], duration: Date.now() - start, error: String(error), fetchedAt: new Date() };
    }
  }

  private buildSearchUrl(params: SearchParams): string {
    const query = new URLSearchParams({
      ...(params.make && { makes: `[]=${params.make.toLowerCase()}` }),
      ...(params.yearMin && { year_min: params.yearMin.toString() }),
      ...(params.yearMax && { year_max: params.yearMax.toString() }),
      ...(params.priceMax && { price_max: params.priceMax.toString() }),
      ...(params.zip && { zip: params.zip }),
      sort: "relevant",
    });
    return `https://www.cars.com/shopping/results/?${query.toString()}`;
  }

  private async parseResponse(response: Response): Promise<NormalizedVehicle[]> {
    try {
      // Production: parse Cars.com listing JSON from embedded scripts
      await response.text(); // Consume response
      return [];
    } catch { return []; }
  }
}
