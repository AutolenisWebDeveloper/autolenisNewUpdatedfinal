// /admin/reports/buyers — buyer funnel with stage-to-stage conversion.
// All counts from real records, scoped to the selected date range.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { parseReportRange } from "@/lib/admin/report-range";
import { DateRangeForm, FunnelRow } from "@/components/admin/ReportControls";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buyer Funnel — Admin" };

interface SP { searchParams: Promise<{ from?: string; to?: string }> }

export default async function BuyerReportPage({ searchParams }: SP) {
  await requireAdmin();
  const range = parseReportRange(await searchParams);
  const createdRange = { gte: range.from, lte: range.to };

  let stages: { label: string; count: number }[] = [];
  let loadError: string | null = null;

  try {
    const [registrations, onboarded, prequalSubmitted, prequalApproved, depositsPaid, auctionsActive, offersReceived, dealsCompleted] = await Promise.all([
      prisma.buyer.count({ where: { createdAt: createdRange } }),
      prisma.buyer.count({ where: { createdAt: createdRange, onboardingComplete: true } }),
      prisma.preQualification.count({ where: { createdAt: createdRange } }),
      prisma.preQualification.count({ where: { createdAt: createdRange, decision: "APPROVED" } }),
      prisma.deposit.count({ where: { createdAt: createdRange, status: "PAID" } }),
      prisma.auction.count({ where: { createdAt: createdRange } }),
      prisma.offer.count({ where: { createdAt: createdRange, status: "SUBMITTED" } }),
      prisma.deal.count({ where: { createdAt: createdRange, status: "COMPLETED" } }),
    ]);
    stages = [
      { label: "Registrations", count: registrations },
      { label: "Onboardings", count: onboarded },
      { label: "Prequals Submitted", count: prequalSubmitted },
      { label: "Prequals Approved", count: prequalApproved },
      { label: "Deposits Paid", count: depositsPaid },
      { label: "Auctions Active", count: auctionsActive },
      { label: "Offers Received", count: offersReceived },
      { label: "Deals Completed", count: dealsCompleted },
    ];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load buyer metrics";
  }

  const max = Math.max(...stages.map(s => s.count), 1);

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-reports-buyers-page">
      <div className="flex items-center gap-3 mb-1">
        <Users size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Buyer Funnel</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">Stage-to-stage conversion across the buyer lifecycle.</p>

      <DateRangeForm fromInput={range.fromInput} toInput={range.toInput} />

      {loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm" data-testid="reports-buyers-error">
          Couldn&apos;t load buyer metrics: {loadError}
        </div>
      ) : stages.every(s => s.count === 0) ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm" data-testid="reports-buyers-empty">
          No buyer activity in this date range.
        </div>
      ) : (
        <div className="space-y-3">
          {stages.map((s, i) => (
            <FunnelRow key={s.label} label={s.label} count={s.count} prev={i > 0 ? stages[i - 1].count : undefined} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}
