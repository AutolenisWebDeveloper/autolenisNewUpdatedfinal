// lib/services/dealer/dealer-analytics.service.ts
import { prisma } from "@/lib/prisma";

export async function getDealerAnalyticsSummary(dealerId: string, days = 90) {
  const since = new Date(Date.now() - days * 24 * 3600000);
  const [invitations, offers, accepted, inventory] = await Promise.all([
    prisma.auctionInvitation.count({ where: { dealerId, sentAt: { gte: since } } }),
    prisma.offer.count({ where: { dealerId, createdAt: { gte: since } } }),
    prisma.offer.count({ where: { dealerId, status: "ACCEPTED", createdAt: { gte: since } } }),
    prisma.inventoryItem.count({ where: { dealerId, isActive: true } }),
  ]);
  return { invitations, offers, accepted, inventory, winRate: offers > 0 ? (accepted / offers) * 100 : 0 };
}
