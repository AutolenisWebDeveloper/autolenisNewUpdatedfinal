// /admin/reports/dealers — dealer activity metrics for the selected range.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { parseReportRange } from "@/lib/admin/report-range";
import { DateRangeForm, StatCard } from "@/components/admin/ReportControls";
import { Building2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dealer Metrics — Admin" };

interface SP { searchParams: Promise<{ from?: string; to?: string }> }

export default async function DealerReportPage({ searchParams }: SP) {
  await requireAdmin();
  const range = parseReportRange(await searchParams);
  const createdRange = { gte: range.from, lte: range.to };

  let metrics: { activeDealers: number; invitations: number; bids: number; wins: number; avgOtd: number } | null = null;
  let loadError: string | null = null;

  try {
    const [activeDealers, invitations, bids, wins, avg] = await Promise.all([
      prisma.dealer.count({ where: { status: "ACTIVE" } }),
      prisma.auctionInvitation.count({ where: { sentAt: createdRange } }),
      prisma.offer.count({ where: { createdAt: createdRange, status: "SUBMITTED" } }),
      // A "won" bid = an offer that became a deal in range.
      prisma.deal.count({ where: { createdAt: createdRange } }),
      prisma.offer.aggregate({ _avg: { otdPriceCents: true }, where: { createdAt: createdRange, status: "SUBMITTED" } }),
    ]);
    metrics = {
      activeDealers,
      invitations,
      bids,
      wins,
      avgOtd: Math.round(avg._avg.otdPriceCents ?? 0),
    };
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load dealer metrics";
  }

  const responseRate = metrics && metrics.invitations > 0 ? Math.round((metrics.bids / metrics.invitations) * 100) : 0;
  const winRate = metrics && metrics.bids > 0 ? Math.round((metrics.wins / metrics.bids) * 100) : 0;

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-reports-dealers-page">
      <div className="flex items-center gap-3 mb-1">
        <Building2 size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Dealer Metrics</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">Invitation response and win rates for the selected range.</p>

      <DateRangeForm fromInput={range.fromInput} toInput={range.toInput} />

      {loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm" data-testid="reports-dealers-error">
          Couldn&apos;t load dealer metrics: {loadError}
        </div>
      ) : !metrics || (metrics.invitations === 0 && metrics.bids === 0 && metrics.activeDealers === 0) ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm" data-testid="reports-dealers-empty">
          No dealer activity in this date range.
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Active Dealers" value={metrics.activeDealers.toLocaleString()} />
          <StatCard label="Invitations Sent" value={metrics.invitations.toLocaleString()} />
          <StatCard label="Bids Submitted" value={metrics.bids.toLocaleString()} sub={`${responseRate}% response rate`} />
          <StatCard label="Deals Won" value={metrics.wins.toLocaleString()} sub={`${winRate}% win rate`} />
          <StatCard label="Avg OTD Submitted" value={`$${(metrics.avgOtd / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        </div>
      )}
    </div>
  );
}
