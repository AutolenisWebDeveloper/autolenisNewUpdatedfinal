// lib/services/shortlist/shortlist.service.ts
import { prisma } from "@/lib/prisma";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";
import { isShortlistItemAvailable } from "./shortlist-availability";

/**
 * How many of these shortlist entries point at a vehicle that is still on the market.
 *
 * The cap must count AVAILABLE candidates, not rows. ShortlistItem.inventoryItemId has no
 * foreign key and the stale sweep deactivates listings, so a buyer whose saved cars have
 * sold would otherwise be told their shortlist is full while holding zero usable
 * candidates — locked out of adding the replacement for the car that just sold.
 */
export async function countAvailableItems(
  items: Array<{ inventoryItemId: string }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: items.map(i => i.inventoryItemId) } },
    select: { id: true, isActive: true, priceCents: true },
  });
  const byId = new Map(rows.map(r => [r.id, r]));
  // A missing row counts as unavailable — it is simply gone.
  return items.reduce(
    (n, i) => n + (isShortlistItemAvailable(byId.get(i.inventoryItemId) ?? null) ? 1 : 0),
    0,
  );
}

export async function getOrCreateShortlist(buyerId: string) {
  return prisma.shortlist.upsert({ where: { buyerId }, create: { buyerId }, update: {}, include: { items: true } });
}

export async function addToShortlist(buyerId: string, inventoryItemId: string) {
  const shortlist = await getOrCreateShortlist(buyerId);
  if (await countAvailableItems(shortlist.items) >= MAX_SHORTLIST_ITEMS) {
    throw new Error(`Shortlist limited to ${MAX_SHORTLIST_ITEMS} items`);
  }
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
  // Readiness counts AVAILABLE candidates: a buyer whose every saved car has sold is not
  // ready to auction, however many rows their shortlist holds.
  const itemCount = shortlist ? await countAvailableItems(shortlist.items) : 0;
  return {
    isReady: hasPrequal && itemCount > 0,
    itemCount, hasPrequal: !!hasPrequal,
    nextStep: !hasPrequal ? "complete-prequal" : itemCount === 0 ? "add-vehicles" : "activate-auction",
  };
}
