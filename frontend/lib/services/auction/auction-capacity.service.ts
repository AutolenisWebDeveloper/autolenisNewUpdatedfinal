// lib/services/auction/auction-capacity.service.ts
import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_LOAD = 5;

export async function getDealerCapacity(dealerId: string): Promise<number> {
  const config = await prisma.dealerCapacityConfig.findUnique({ where: { dealerId } });
  return config?.maxAuctionLoad ?? DEFAULT_MAX_LOAD;
}

// A2 — read-only accessor for a registered dealer's self-declared makes.
// upsertCapacityConfig remains the SOLE writer of preferredMakes; the rooftop
// make-signal reads through here and never mutates it. Returns [] when unset.
export async function getPreferredMakes(dealerId: string): Promise<string[]> {
  const config = await prisma.dealerCapacityConfig.findUnique({
    where: { dealerId },
    select: { preferredMakes: true },
  });
  return config?.preferredMakes ?? [];
}

export async function isDealerAtCapacity(dealerId: string): Promise<boolean> {
  const [dealer, maxLoad] = await Promise.all([
    prisma.dealer.findUnique({ where: { id: dealerId }, select: { currentAuctionLoad: true } }),
    getDealerCapacity(dealerId),
  ]);
  return (dealer?.currentAuctionLoad ?? 0) >= maxLoad;
}

export async function upsertCapacityConfig(dealerId: string, maxLoad: number, preferredMakes: string[], priceRange?: { min?: number; max?: number }) {
  return prisma.dealerCapacityConfig.upsert({
    where: { dealerId },
    create: { dealerId, maxAuctionLoad: maxLoad, preferredMakes, preferredPriceMin: priceRange?.min, preferredPriceMax: priceRange?.max },
    update: { maxAuctionLoad: maxLoad, preferredMakes, preferredPriceMin: priceRange?.min, preferredPriceMax: priceRange?.max },
  });
}
