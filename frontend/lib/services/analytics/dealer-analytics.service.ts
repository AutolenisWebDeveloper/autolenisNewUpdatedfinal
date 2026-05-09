// lib/services/analytics/dealer-analytics.service.ts
import { prisma } from "@/lib/prisma";

export async function getPlatformDealerMetrics() {
  const [total, active, avgOffers, topTier] = await Promise.all([
    prisma.dealer.count(),
    prisma.dealer.count({ where: { status: "ACTIVE" } }),
    prisma.offer.count().then(c => prisma.auction.count({ where: { status: "CLOSED" } }).then(a => a > 0 ? c / a : 0)),
    prisma.dealer.count({ where: { tier: "PLATINUM" } }),
  ]);
  return { total, active, avgOffersPerAuction: avgOffers, platinumDealers: topTier };
}
