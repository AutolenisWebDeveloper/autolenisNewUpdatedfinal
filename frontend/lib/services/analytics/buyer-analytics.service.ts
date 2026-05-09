// lib/services/analytics/buyer-analytics.service.ts
import { prisma } from "@/lib/prisma";

export async function getBuyerConversionMetrics() {
  const [total, qualified, deposited, dealSelected, completed] = await Promise.all([
    prisma.buyer.count(),
    prisma.preQualification.count({ where: { decision: "APPROVED" } }),
    prisma.deposit.count({ where: { status: "PAID" } }),
    prisma.deal.count(),
    prisma.deal.count({ where: { status: "COMPLETED" } }),
  ]);
  return { total, qualified, deposited, dealSelected, completed };
}
