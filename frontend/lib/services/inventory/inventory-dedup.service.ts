// lib/services/inventory/inventory-dedup.service.ts
import type { NormalizedVehicle } from "./adapters/IInventoryAdapter";
import { buildSourceKey } from "./adapters/IInventoryAdapter";

export function deduplicateVehicleList(vehicles: NormalizedVehicle[]): NormalizedVehicle[] {
  const seen = new Map<string, NormalizedVehicle>();
  for (const v of vehicles) {
    const key = v.sourceKey || buildSourceKey(v);
    if (!seen.has(key) || (v.images.length > (seen.get(key)?.images.length ?? 0))) {
      seen.set(key, { ...v, sourceKey: key });
    }
  }
  return Array.from(seen.values());
}

export function buildCompositeKey(make: string, model: string, year: number, mileage?: number, priceCents?: number): string {
  return `${make}:${model}:${year}:${mileage ?? 0}:${priceCents ?? 0}`.toLowerCase();
}
