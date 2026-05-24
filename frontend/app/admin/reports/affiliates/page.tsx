// /admin/reports/affiliates — affiliate status, referral, and commission totals.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { parseReportRange } from "@/lib/admin/report-range";
import { DateRangeForm, StatCard } from "@/components/admin/ReportControls";
import { formatCentsAsUsd } from "@/lib/constants";
import { Share2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Affiliate Report — Admin" };

interface SP { searchParams: Promise<{ from?: string; to?: string }> }

export default async function AffiliateReportPage({ searchParams }: SP) {
  await requireAdmin();
  const range = parseReportRange(await searchParams);
  const createdRange = { gte: range.from, lte: range.to };

  let data: {
    active: number; pending: number; suspended: number;
    signups: number; conversions: number;
    earnedCents: number; paidCents: number; pendingCents: number;
  } | null = null;
  let loadError: string | null = null;

  try {
    const [active, pending, suspended, signups, conversions, earned, paid, pend] = await Promise.all([
      prisma.affiliate.count({ where: { status: "ACTIVE" } }),
      prisma.affiliate.count({ where: { status: "PENDING" } }),
      prisma.affiliate.count({ where: { status: "SUSPENDED" } }),
      prisma.affiliateReferral.count({ where: { signedUpAt: createdRange } }),
      prisma.affiliateReferral.count({ where: { signedUpAt: createdRange, firstDealAt: { not: null } } }),
      prisma.commission.aggregate({ _sum: { amountCents: true }, where: { createdAt: createdRange, status: { in: ["PENDING", "APPROVED", "PAID"] } } }),
      prisma.commission.aggregate({ _sum: { amountCents: true }, where: { createdAt: createdRange, status: "PAID" } }),
      prisma.commission.aggregate({ _sum: { amountCents: true }, where: { createdAt: createdRange, status: "PENDING" } }),
    ]);
    data = {
      active, pending, suspended, signups, conversions,
      earnedCents: earned._sum.amountCents ?? 0,
      paidCents: paid._sum.amountCents ?? 0,
      pendingCents: pend._sum.amountCents ?? 0,
    };
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load affiliate metrics";
  }

  const convRate = data && data.signups > 0 ? Math.round((data.conversions / data.signups) * 100) : 0;

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-reports-affiliates-page">
      <div className="flex items-center gap-3 mb-1">
        <Share2 size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Affiliate Report</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">Affiliate roster, referral conversions, and commission totals.</p>

      <DateRangeForm fromInput={range.fromInput} toInput={range.toInput} />

      {loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm" data-testid="reports-affiliates-error">
          Couldn&apos;t load affiliate metrics: {loadError}
        </div>
      ) : !data ? null : (
        <>
          <h2 className="text-xs font-semibold text-slate-400 uppercase mb-2">Roster</h2>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Active" value={data.active.toLocaleString()} accent="text-green-600" />
            <StatCard label="Pending" value={data.pending.toLocaleString()} accent="text-amber-600" />
            <StatCard label="Suspended" value={data.suspended.toLocaleString()} accent="text-red-600" />
          </div>

          <h2 className="text-xs font-semibold text-slate-400 uppercase mb-2">Referrals (selected range)</h2>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <StatCard label="Signups" value={data.signups.toLocaleString()} />
            <StatCard label="Conversions" value={data.conversions.toLocaleString()} sub={`${convRate}% conversion`} />
          </div>

          <h2 className="text-xs font-semibold text-slate-400 uppercase mb-2">Commissions (selected range)</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Earned" value={formatCentsAsUsd(data.earnedCents)} />
            <StatCard label="Paid" value={formatCentsAsUsd(data.paidCents)} accent="text-green-600" />
            <StatCard label="Pending" value={formatCentsAsUsd(data.pendingCents)} accent="text-amber-600" />
          </div>
        </>
      )}
    </div>
  );
}
