// lib/services/analytics/affiliate-analytics.service.ts
import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";

export async function getAffiliateMetrics() {
  const [total, active, totalPaid, pendingPayout] = await Promise.all([
    prisma.affiliate.count(),
    prisma.affiliate.count({ where: { status: "ACTIVE" } }),
    prisma.commission.aggregate({ where: { status: "PAID" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({ where: { status: { in: ["PENDING", "APPROVED"] } }, _sum: { amountCents: true } }),
  ]);
  return {
    total, active,
    totalPaidCents: totalPaid._sum.amountCents ?? 0,
    pendingPayoutCents: pendingPayout._sum.amountCents ?? 0,
    commissionRates: COMMISSION_RATES,
  };
}
