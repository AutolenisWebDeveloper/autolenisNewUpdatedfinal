// Custom adapter template — ENH-20
// Allows admin to configure custom inventory adapters at runtime

import { logger } from "@/lib/logger";
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

    // Only JSON feeds are actually parsed today. XML/CSV are NOT_CONFIGURED
    // (unsupported) rather than a silent empty "success" — never let an
    // unimplemented format read as a healthy zero-vehicle sync.
    if (this.config.format !== "json") {
      logger.warn(`[Custom adapter: ${this.name}] format '${this.config.format}' not implemented — skipping (NOT_CONFIGURED).`);
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        configured: false,
        outcome: "NOT_CONFIGURED",
        error: `feed format '${this.config.format}' not implemented`,
        fetchedAt: new Date(),
      };
    }

    try {
      const response = await fetch(this.config.feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoLenis/1.0)" },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        return {
          adapter: this.name,
          vehicles: [],
          duration: Date.now() - start,
          configured: true,
          outcome: transient ? "DEFERRED" : "FAILED",
          error: `HTTP ${response.status}`,
          fetchedAt: new Date(),
        };
      }

      const vehicles = this.parseJson((await response.json()) as unknown);
      return {
        adapter: this.name,
        vehicles,
        duration: Date.now() - start,
        configured: true,
        outcome: vehicles.length > 0 ? "SUCCESS" : "ZERO_RESULTS",
        fetchedAt: new Date(),
      };
    } catch (error) {
      const isTimeout = error instanceof Error && /abort|timeout/i.test(error.message);
      logger.error(`[Custom adapter: ${this.name}] Error:`, error);
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start,
        configured: true,
        outcome: isTimeout ? "DEFERRED" : "FAILED",
        error: String(error),
        fetchedAt: new Date(),
      };
    }
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
