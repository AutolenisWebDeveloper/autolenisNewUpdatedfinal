// lib/services/analytics/platform-analytics.service.ts
import { prisma } from "@/lib/prisma";
import { PREMIUM_FEE_CENTS } from "@/lib/constants";

export async function getPlatformKPIs() {
  const [buyers, dealers, deals, revenue, auctions] = await Promise.all([
    prisma.buyer.count(), prisma.dealer.count({ where: { status: "ACTIVE" } }),
    prisma.deal.count({ where: { status: "COMPLETED" } }),
    prisma.deal.count({ where: { status: "COMPLETED" } }).then(c => c * PREMIUM_FEE_CENTS),
    prisma.auction.count(),
  ]);
  return { totalBuyers: buyers, activeDealers: dealers, completedDeals: deals, totalRevenueCents: revenue, totalAuctions: auctions };
}
