// lib/services/inventory/inventory-quality.service.ts — ENH-3
import { prisma } from "@/lib/prisma";

export async function computeQualityScore(inventoryItemId: string): Promise<number> {
  const item = await prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } });
  if (!item) return 0;

  let score = 0;
  if (item.vin) score += 25;                       // VIN verified
  if (item.images.length >= 4) score += 25;        // Sufficient photos
  else if (item.images.length >= 1) score += 10;
  if (item.mileage !== null) score += 10;          // Mileage disclosed
  if (item.description && item.description.length > 50) score += 15; // Good description
  if (item.trim) score += 10;                      // Trim level specified
  if (item.lane === "LANE_1") score += 15;         // Verified dealer

  const qualityScore = Math.min(100, score);

  await prisma.inventoryQualityScore.upsert({
    where: { inventoryItemId },
    create: { inventoryItemId, score: qualityScore, photoScore: Math.min(25, item.images.length * 6), dataScore: score - Math.min(25, item.images.length * 6), vinVerified: !!item.vin, priceScore: 100 },
    update: { score: qualityScore },
  });

  return qualityScore;
}
