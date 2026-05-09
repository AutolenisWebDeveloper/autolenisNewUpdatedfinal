// lib/services/admin/admin-reports.service.ts
import { getFunnelData } from "@/lib/services/analytics/analytics.service";
import { getRevenuePipeline } from "@/lib/services/analytics/analytics.service";
import { getAffiliateMetrics } from "@/lib/services/analytics/affiliate-analytics.service";
import { prisma } from "@/lib/prisma";

export async function getFullDashboardReport() {
  const [funnel, pipeline, affiliates, activeDeals, activeAuctions] = await Promise.all([
    getFunnelData(), getRevenuePipeline(), getAffiliateMetrics(),
    prisma.deal.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } } }),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
  ]);
  return { funnel, pipeline, affiliates, activeDeals, activeAuctions, generatedAt: new Date() };
}
