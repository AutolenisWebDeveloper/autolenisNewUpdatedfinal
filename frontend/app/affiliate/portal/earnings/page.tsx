import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { prisma } from "@/lib/prisma";
import { getCommissionSummary } from "@/lib/services/affiliate/commission.service";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp } from "lucide-react";
import { COMMISSION_RATES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function AffiliateEarningsPage() {
  const affiliate = await requireAffiliate();
  const [summary, commissions] = await Promise.all([
    getCommissionSummary(affiliate.id),
    prisma.commission.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // Per-level breakdown
  const byLevel = [1, 2, 3].map((lvl) => {
    const levelComms = commissions.filter((c) => c.level === lvl && c.status !== "REVERSED");
    const total = levelComms.reduce((s, c) => s + c.amountCents, 0);
    return { level: lvl, total, count: levelComms.length };
  });

  const maxLevelTotal = Math.max(...byLevel.map((b) => b.total), 1);

  const rates = [COMMISSION_RATES.LEVEL_1, COMMISSION_RATES.LEVEL_2, COMMISSION_RATES.LEVEL_3];
  const levelColors = ["bg-[#0B5FD1]", "bg-blue-500", "bg-emerald-500"];

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="affiliate-earnings-page">
      <div className="flex items-center gap-3 mb-6">
        <DollarSign size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Earnings</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Earned", value: `$${(summary.totalCents / 100).toLocaleString()}`, color: "text-slate-900" },
          { label: "Paid Out",     value: `$${(summary.paidCents / 100).toLocaleString()}`,   color: "text-green-600" },
          { label: "Pending",      value: `$${(summary.pendingCents / 100).toLocaleString()}`, color: "text-[#0B5FD1]" },
        ].map(s => (
          <div key={s.label} data-testid={`earnings-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-5 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 -mt-6 mb-8" data-testid="earnings-basis-note">
        Totals reflect settled commissions; reversed commissions are excluded.
      </p>

      {/* Level breakdown with horizontal bars */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-8" data-testid="earnings-level-breakdown">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-[#0B5FD1]" />
          <p className="text-sm font-semibold text-slate-800">Earnings by level</p>
        </div>
        <div className="space-y-4">
          {byLevel.map((b, i) => (
            <div key={b.level} data-testid={`earnings-level-row-${b.level}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">L{b.level}</span>
                  <span className="text-xs text-slate-400">{Math.round(rates[i] * 100)}% · {b.count} commission{b.count !== 1 ? "s" : ""}</span>
                </div>
                <span className="text-sm font-bold text-slate-900">${(b.total / 100).toLocaleString()}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${levelColors[i]}`}
                  style={{ width: `${Math.round((b.total / maxLevelTotal) * 100)}%` }}
                  data-testid={`earnings-level-bar-${b.level}`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Commission log */}
      {commissions.length === 0 ? (
        <div className="text-center py-16 text-slate-400" data-testid="no-commissions">
          <p>No commissions yet. Start referring buyers to earn.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {commissions.map(c => (
            <div key={c.id} data-testid={`commission-row-${c.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant={c.status === "PAID" ? "green" : c.status === "REVERSED" ? "destructive" : "secondary"} className="text-xs">
                    {c.status}
                  </Badge>
                  <span className="text-xs text-slate-400">Level {c.level} · {Math.round(c.rate * 100)}%</span>
                </div>
                <p className="text-xs text-slate-400">{c.createdAt.toLocaleDateString()}</p>
              </div>
              <p className={`font-bold text-sm ${c.status === "REVERSED" ? "text-red-500 line-through" : "text-slate-900"}`}>
                ${(c.amountCents / 100).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
