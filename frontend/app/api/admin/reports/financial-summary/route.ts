// GET /api/admin/reports/financial-summary
// Returns aggregate financial metrics + monthly revenue trend (last 12 months).
// All numbers reflect actual DB state — not estimates.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const [depositStats, feeStats, feeRefundStats, rawDeposits, rawFees] = await Promise.all([
    // Aggregate deposits by status
    prisma.deposit.groupBy({
      by: ["status"],
      _sum: { amountCents: true },
      _count: { id: true },
    }),
    // Concierge fee aggregate from deals (paid)
    prisma.deal.aggregate({
      _sum: { feeAmountCents: true },
      _count: { id: true },
      where: { feePaidAt: { not: null } },
    }),
    // Concierge fee refund aggregate from deals (refunded)
    prisma.deal.aggregate({
      _sum: { feeRefundedAmountCents: true },
      _count: { id: true },
      where: { feeRefundedAt: { not: null } },
    }),
    // Monthly deposits (last 12 months)
    prisma.deposit.findMany({
      where: {
        status: "PAID",
        createdAt: { gte: new Date(Date.now() - 365 * 24 * 3600 * 1000) },
      },
      select: { amountCents: true, createdAt: true },
    }),
    // Monthly fees (last 12 months)
    prisma.deal.findMany({
      where: {
        feePaidAt: { gte: new Date(Date.now() - 365 * 24 * 3600 * 1000), not: null },
      },
      select: { feeAmountCents: true, feePaidAt: true },
    }),
  ]);

  // Build monthly trend (12 months)
  const months: Record<string, { month: string; deposits: number; fees: number; net: number }> = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    months[key] = { month: label, deposits: 0, fees: 0, net: 0 };
  }

  rawDeposits.forEach(d => {
    const key = `${d.createdAt.getFullYear()}-${String(d.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (months[key]) months[key].deposits += d.amountCents;
  });

  rawFees.forEach(d => {
    if (!d.feePaidAt) return;
    const key = `${d.feePaidAt.getFullYear()}-${String(d.feePaidAt.getMonth() + 1).padStart(2, "0")}`;
    if (months[key]) months[key].fees += d.feeAmountCents ?? 0;
  });

  const monthlyTrend = Object.values(months).map(m => ({
    ...m,
    net: m.deposits + m.fees,
  }));

  const depositsCollected = depositStats.find(d => d.status === "PAID")?._sum.amountCents ?? 0;
  const depositsRefunded  = depositStats.find(d => d.status === "REFUNDED")?._sum.amountCents ?? 0;
  const depositsPending   = depositStats.find(d => d.status === "PENDING")?._sum.amountCents ?? 0;
  const depositCount      = depositStats.find(d => d.status === "PAID")?._count.id ?? 0;

  const feesCollected  = feeStats._sum.feeAmountCents ?? 0;
  const feeCount       = feeStats._count.id ?? 0;
  const feesRefunded   = feeRefundStats._sum.feeRefundedAmountCents ?? 0;
  const feeRefundCount = feeRefundStats._count.id ?? 0;

  const netRevenue = depositsCollected - depositsRefunded + feesCollected - feesRefunded;

  return adminSuccess({
    summary: {
      depositsCollected,
      depositsRefunded,
      depositsPending,
      depositCount,
      feesCollected,
      feesRefunded,
      feeRefundCount,
      feeCount,
      netRevenue,
      monthlyTrend,
      generatedAt: new Date().toISOString(),
    },
  });
}
