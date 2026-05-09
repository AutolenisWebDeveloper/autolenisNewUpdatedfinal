// lib/services/inventory/inventory-match.service.ts — ENH-6
import { prisma } from "@/lib/prisma";

export async function findMatchedVehicles(buyerId: string, limit = 12) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { preQualification: true } });
  const pref = await prisma.buyerInventoryPreference.findUnique({ where: { buyerId } });
  const maxCents = buyer?.preQualification?.maxOtdAmountCents;

  const where: Record<string, unknown> = { isActive: true };
  if (maxCents) where.priceCents = { lte: maxCents };
  if (pref?.preferredMakes?.length) where.make = { in: pref.preferredMakes };

  return prisma.inventoryItem.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, select: { id: true, year: true, make: true, model: true, priceCents: true, lane: true, images: true } });
}

export async function saveVehiclePreferences(buyerId: string, makes: string[], bodyStyles: string[], maxMileage?: number, minYear?: number) {
  return prisma.buyerInventoryPreference.upsert({
    where: { buyerId },
    create: { buyerId, preferredMakes: makes, preferredBodyStyles: bodyStyles, maxMileage, minYear },
    update: { preferredMakes: makes, preferredBodyStyles: bodyStyles, maxMileage, minYear },
  });
}
