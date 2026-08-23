// Pure mapping: a saved search's free-form `filters` JSON → an InventoryItem
// where-clause. Extracted from the retired Inngest `savedSearchMatcherFn` so the
// saved-search matcher can run on the internal Vercel-Cron substrate while this
// mapping stays a small, dependency-free, unit-testable pure function (no
// prisma/supabase/server-only imports — only the Prisma type).
//
// Only the keys the buyer search UI writes are honored; unknown keys are ignored.
// Prices are stored as dollars in the filter and compared against price_cents.

import { Prisma } from "@prisma/client";

export function buildInventoryWhereFromFilters(
  filters: Record<string, unknown>,
): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {};
  const str = (k: string): string | null => {
    const v = filters[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const num = (k: string): number | null => {
    const v = filters[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
  };

  const make = str("make");
  if (make) where.make = { equals: make, mode: "insensitive" };
  const model = str("model");
  if (model) where.model = { equals: model, mode: "insensitive" };

  const yearMin = num("yearMin");
  const yearMax = num("yearMax");
  if (yearMin !== null || yearMax !== null) {
    where.year = {
      ...(yearMin !== null ? { gte: yearMin } : {}),
      ...(yearMax !== null ? { lte: yearMax } : {}),
    };
  }

  const priceMin = num("priceMin");
  const priceMax = num("priceMax");
  if (priceMin !== null || priceMax !== null) {
    where.priceCents = {
      ...(priceMin !== null ? { gte: Math.round(priceMin * 100) } : {}),
      ...(priceMax !== null ? { lte: Math.round(priceMax * 100) } : {}),
    };
  }

  const mileageMax = num("mileageMax");
  if (mileageMax !== null) where.mileage = { lte: mileageMax };

  for (const k of ["condition", "bodyType", "transmission", "drivetrain", "fuelType"] as const) {
    const v = str(k);
    if (v) (where as Record<string, unknown>)[k] = { equals: v, mode: "insensitive" };
  }

  return where;
}
