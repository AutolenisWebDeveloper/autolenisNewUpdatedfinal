// /admin/reports/revenue — revenue summary for the selected range.
// All amounts summed from actual Stripe-backed Prisma records — never
// computed on the client and never hardcoded.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { parseReportRange } from "@/lib/admin/report-range";
import { DateRangeForm, StatCard } from "@/components/admin/ReportControls";
import { formatCentsAsUsd } from "@/lib/constants";
import { DollarSign } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revenue — Admin" };

interface SP { searchParams: Promise<{ from?: string; to?: string }> }

export default async function RevenueReportPage({ searchParams }: SP) {
  await requireAdmin();
  const range = parseReportRange(await searchParams);

  let data: {
    depositsCents: number; feesCents: number; depositRefundsCents: number;
    feeRefundsCents: number; commissionPaidCents: number;
  } | null = null;
  let loadError: string | null = null;

  try {
    const [deposits, fees, depositRefunds, feeRefunds, commissionsPaid] = await Promise.all([
      prisma.deposit.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", createdAt: { gte: range.from, lte: range.to } } }),
      prisma.deal.aggregate({ _sum: { feeAmountCents: true }, where: { feePaidAt: { gte: range.from, lte: range.to } } }),
      prisma.deposit.aggregate({ _sum: { amountCents: true }, where: { status: "REFUNDED", refundedAt: { gte: range.from, lte: range.to } } }),
      prisma.deal.aggregate({ _sum: { feeRefundedAmountCents: true }, where: { feeRefundedAt: { gte: range.from, lte: range.to } } }),
      prisma.commission.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", createdAt: { gte: range.from, lte: range.to } } }),
    ]);
    data = {
      depositsCents: deposits._sum.amountCents ?? 0,
      feesCents: fees._sum.feeAmountCents ?? 0,
      depositRefundsCents: depositRefunds._sum.amountCents ?? 0,
      feeRefundsCents: feeRefunds._sum.feeRefundedAmountCents ?? 0,
      commissionPaidCents: commissionsPaid._sum.amountCents ?? 0,
    };
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load revenue metrics";
  }

  const refundsTotal = data ? data.depositRefundsCents + data.feeRefundsCents : 0;
  const netRevenue = data ? data.feesCents - refundsTotal : 0;
  const netPlatformRevenue = data ? data.feesCents - refundsTotal - data.commissionPaidCents : 0;

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-reports-revenue-page">
      <div className="flex items-center gap-3 mb-1">
        <DollarSign size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Revenue</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">Collections, refunds, and net revenue for the selected range.</p>

      <DateRangeForm fromInput={range.fromInput} toInput={range.toInput} />

      {loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm" data-testid="reports-revenue-error">
          Couldn&apos;t load revenue metrics: {loadError}
        </div>
      ) : !data ? null : (
        <>
          <h2 className="text-xs font-semibold text-slate-400 uppercase mb-2">Collections</h2>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <StatCard label="Deposits Collected" value={formatCentsAsUsd(data.depositsCents)} />
            <StatCard label="Concierge Fees Collected" value={formatCentsAsUsd(data.feesCents)} accent="text-green-600" />
          </div>

          <h2 className="text-xs font-semibold text-slate-400 uppercase mb-2">Outflows</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <StatCard label="Refunds Issued" value={formatCentsAsUsd(refundsTotal)} accent="text-red-600"
              sub={`${formatCentsAsUsd(data.depositRefundsCents)} deposits · ${formatCentsAsUsd(data.feeRefundsCents)} fees`} />
            <StatCard label="Commission Payouts" value={formatCentsAsUsd(data.commissionPaidCents)} accent="text-red-600" />
          </div>

          <h2 className="text-xs font-semibold text-slate-400 uppercase mb-2">Net</h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Net Revenue (fees − refunds)" value={formatCentsAsUsd(netRevenue)}
              accent={netRevenue >= 0 ? "text-green-600" : "text-red-600"} />
            <StatCard label="Net Platform Revenue (− commissions)" value={formatCentsAsUsd(netPlatformRevenue)}
              accent={netPlatformRevenue >= 0 ? "text-green-600" : "text-red-600"} />
          </div>
        </>
      )}
    </div>
  );
}
