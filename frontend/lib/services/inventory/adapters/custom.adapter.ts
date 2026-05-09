// Custom adapter template — ENH-20
// Allows admin to configure custom inventory adapters at runtime

import type { IInventoryAdapter, NormalizedVehicle, AdapterRunResult, SearchParams } from "./IInventoryAdapter";
import { buildSourceKey } from "./IInventoryAdapter";

export interface CustomAdapterConfig {
  name: string;
  feedUrl: string;
  format: "json" | "xml" | "csv";
  mappings?: {
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    price?: string;
    mileage?: string;
  };
}

export class CustomAdapter implements IInventoryAdapter {
  readonly name: string;
  readonly sourceName: string;
  private config: CustomAdapterConfig;

  constructor(config: CustomAdapterConfig) {
    this.config = config;
    this.name = `custom_${config.name}`;
    this.sourceName = config.name;
  }

  async search(_params: SearchParams): Promise<AdapterRunResult> {
    const start = Date.now();
    try {
      const response = await fetch(this.config.feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0)" },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const vehicles = await this.parseFeed(response);
      return { adapter: this.name, vehicles, duration: Date.now() - start, fetchedAt: new Date() };
    } catch (error) {
      console.error(`[Custom adapter: ${this.name}] Error:`, error);
      return { adapter: this.name, vehicles: [], duration: Date.now() - start, error: String(error), fetchedAt: new Date() };
    }
  }

  private async parseFeed(response: Response): Promise<NormalizedVehicle[]> {
    if (this.config.format === "json") return this.parseJson(await response.json() as unknown);
    // XML and CSV parsing would go here
    await response.text();
    return [];
  }

  private parseJson(data: unknown): NormalizedVehicle[] {
    const items: unknown[] = Array.isArray(data) ? data : [(data as Record<string, unknown>).vehicles ?? []].flat();
    const m = this.config.mappings ?? {};

    return items.slice(0, 100).map((item) => {
      const i = item as Record<string, unknown>;
      const year = parseInt(String(i[m.year ?? "year"] ?? 0));
      const make = String(i[m.make ?? "make"] ?? "");
      const model = String(i[m.model ?? "model"] ?? "");
      const priceCents = Math.round(parseFloat(String(i[m.price ?? "price"] ?? 0)) * 100);

      if (!year || !make || !model || priceCents <= 0) return null;

      const v: NormalizedVehicle = {
        vin: String(i[m.vin ?? "vin"] ?? ""),
        year, make, model,
        mileage: parseInt(String(i[m.mileage ?? "mileage"] ?? 0)) || undefined,
        priceCents,
        images: [],
        sourceAdapter: this.name,
        sourceUrl: this.config.feedUrl,
        sourceKey: "",
      };
      v.sourceKey = buildSourceKey(v);
      return v;
    }).filter(Boolean) as NormalizedVehicle[];
  }
}
