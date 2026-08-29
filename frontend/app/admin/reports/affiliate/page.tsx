// /admin/reports/affiliate — Gap Group 4.5 — affiliate performance report with CSV export

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES, PREMIUM_FEE_REMAINING_CENTS, MAX_COMMISSION_TOTAL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Download, Share2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminAffiliateReportPage() {
  await requireAdmin();

  const affiliates = await prisma.affiliate.findMany({
    include: {
      user: { select: { email: true } },
      commissions: { select: { amountCents: true, status: true, level: true } },
      children: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const stats = affiliates.map(a => {
    const totalEarned = a.commissions.filter(c => c.status !== "REVERSED").reduce((s, c) => s + c.amountCents, 0);
    const paidOut = a.commissions.filter(c => c.status === "PAID").reduce((s, c) => s + c.amountCents, 0);
    return {
      id: a.id,
      email: a.user.email,
      referralCode: a.referralCode,
      level: a.level,
      l1Count: a.children.length,
      totalEarned,
      paidOut,
      pending: totalEarned - paidOut,
      status: a.status,
    };
  });

  const totals = stats.reduce((acc, s) => ({
    totalEarned: acc.totalEarned + s.totalEarned,
    paidOut: acc.paidOut + s.paidOut,
    pending: acc.pending + s.pending,
  }), { totalEarned: 0, paidOut: 0, pending: 0 });

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-affiliate-report-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Share2 size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Affiliate Performance Report</h1>
        </div>
        <Button variant="secondary" size="sm" href="/api/admin/reports/affiliate?format=csv" data-testid="export-affiliate-csv-btn">
          <Download size={14} /> Export CSV
        </Button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Affiliates", value: affiliates.length.toString() },
          { label: "Total Earned", value: `$${(totals.totalEarned / 100).toLocaleString()}` },
          { label: "Paid Out", value: `$${(totals.paidOut / 100).toLocaleString()}` },
          { label: "Pending Payout", value: `$${(totals.pending / 100).toLocaleString()}` },
        ].map(s => (
          <div key={s.label} data-testid={`affiliate-report-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Commission rate reminder */}
      <div className="bg-al-primary/5 border border-al-primary/20 rounded-xl p-4 mb-6 text-sm text-slate-600" data-testid="commission-rate-info">
        <strong>Commission structure</strong> (sourced from lib/constants.ts): L1={Math.round(COMMISSION_RATES.LEVEL_1 * 100)}% · L2={Math.round(COMMISSION_RATES.LEVEL_2 * 100)}% · L3={Math.round(COMMISSION_RATES.LEVEL_3 * 100)}% of the ${PREMIUM_FEE_REMAINING_CENTS / 100} concierge-fee balance (the paid basis). Max payout: {Math.round(MAX_COMMISSION_TOTAL * 100)}% per deal across all levels.
      </div>

      {/* Affiliate table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm" data-testid="affiliate-table">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Email", "Code", "L1 Referrals", "Total Earned", "Paid", "Pending", "Status"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.map(s => (
              <tr key={s.id} data-testid={`affiliate-table-row-${s.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700 text-xs">{s.email}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.referralCode}</td>
                <td className="px-4 py-3 text-slate-700">{s.l1Count}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">${(s.totalEarned / 100).toLocaleString()}</td>
                <td className="px-4 py-3 text-green-600">${(s.paidOut / 100).toLocaleString()}</td>
                <td className="px-4 py-3 text-al-primary">${(s.pending / 100).toLocaleString()}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
