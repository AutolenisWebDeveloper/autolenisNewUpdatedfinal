// lib/services/search/search.service.ts
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function searchInventory(params: {
  q?: string; make?: string; model?: string;
  yearMin?: number; yearMax?: number; maxPriceCents?: number;
  mileageMax?: number; budgetCap?: number; limit?: number;
}) {
  const where: Prisma.InventoryItemWhereInput = { isActive: true };
  if (params.budgetCap) where.priceCents = { lte: params.budgetCap };
  else if (params.maxPriceCents) where.priceCents = { lte: params.maxPriceCents };
  if (params.make) where.make = { contains: params.make, mode: "insensitive" };
  if (params.model) where.model = { contains: params.model, mode: "insensitive" };
  if (params.yearMin || params.yearMax) {
    where.year = {};
    if (params.yearMin) (where.year as Prisma.IntFilter).gte = params.yearMin;
    if (params.yearMax) (where.year as Prisma.IntFilter).lte = params.yearMax;
  }
  if (params.mileageMax) where.mileage = { lte: params.mileageMax };
  if (params.q && !params.make && !params.model) {
    where.OR = [
      { make: { contains: params.q, mode: "insensitive" } },
      { model: { contains: params.q, mode: "insensitive" } },
      { trim: { contains: params.q, mode: "insensitive" } },
    ];
  }
  return prisma.inventoryItem.findMany({
    where, take: params.limit ?? 24, orderBy: { createdAt: "desc" },
    select: { id: true, year: true, make: true, model: true, trim: true, mileage: true, priceCents: true, lane: true, images: true },
  });
}

export async function getMatchedVehicles(buyerId: string) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { preQualification: true } });
  const maxCents = buyer?.preQualification?.maxOtdAmountCents;
  return searchInventory({ budgetCap: maxCents, limit: 12 });
}
