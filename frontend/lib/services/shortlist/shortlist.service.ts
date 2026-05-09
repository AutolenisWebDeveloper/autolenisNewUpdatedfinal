// lib/services/shortlist/shortlist.service.ts
import { prisma } from "@/lib/prisma";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";

export async function getOrCreateShortlist(buyerId: string) {
  return prisma.shortlist.upsert({ where: { buyerId }, create: { buyerId }, update: {}, include: { items: true } });
}

export async function addToShortlist(buyerId: string, inventoryItemId: string) {
  const shortlist = await getOrCreateShortlist(buyerId);
  if (shortlist.items.length >= MAX_SHORTLIST_ITEMS) throw new Error(`Shortlist limited to ${MAX_SHORTLIST_ITEMS} items`);
  const exists = shortlist.items.some(i => i.inventoryItemId === inventoryItemId);
  if (exists) throw new Error("Vehicle already in shortlist");
  return prisma.shortlistItem.create({ data: { shortlistId: shortlist.id, inventoryItemId, readinessState: "AUCTION_READY" } });
}

export async function removeFromShortlist(buyerId: string, itemId: string) {
  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId } });
  if (!shortlist) throw new Error("Shortlist not found");
  return prisma.shortlistItem.deleteMany({ where: { id: itemId, shortlistId: shortlist.id } });
}

export async function getShortlistReadiness(buyerId: string) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { preQualification: true } });
  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId }, include: { items: true } });
  const hasPrequal = buyer?.preQualification && buyer.preQualification.expiresAt > new Date();
  const itemCount = shortlist?.items.length ?? 0;
  return {
    isReady: hasPrequal && itemCount > 0,
    itemCount, hasPrequal: !!hasPrequal,
    nextStep: !hasPrequal ? "complete-prequal" : itemCount === 0 ? "add-vehicles" : "activate-auction",
  };
}
