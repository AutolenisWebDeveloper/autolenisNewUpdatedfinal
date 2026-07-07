// Feature 5 — Admin Funnel Analytics (rebuild from 51-line stub)
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { BarChart2 } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminFunnelPage() {
  await requireAdmin();
  const [buyers, prequals, shortlists, deposits, auctions, deals, completed] = await Promise.all([
    prisma.buyer.count(),
    prisma.preQualification.count({ where: { decision: "APPROVED" } }),
    prisma.shortlist.count(),
    prisma.deposit.count({ where: { status: "PAID" } }),
    prisma.auction.count(),
    prisma.deal.count(),
    prisma.deal.count({ where: { status: "COMPLETED" } }),
  ]);

  const stages = [
    { label: "Buyers Registered", count: buyers },
    { label: "Pre-Qualified", count: prequals },
    { label: "Shortlist Created", count: shortlists },
    { label: "Deposit Paid", count: deposits },
    { label: "Auction Created", count: auctions },
    { label: "Deal Selected", count: deals },
    { label: "Deal Completed", count: completed },
  ];

  const maxCount = Math.max(...stages.map(s => s.count), 1);
  const allZero = stages.every(s => s.count === 0);

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-funnel-page">
      <div className="flex items-center gap-3 mb-6"><BarChart2 size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Conversion Funnel</h1></div>
      {allZero && (
        <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-xl mb-4" data-testid="funnel-empty">
          <p className="font-medium text-slate-500">No funnel data yet</p>
          <p className="text-xs mt-1">Stages populate as buyers register and move through the pipeline.</p>
        </div>
      )}
      {!allZero && (
      <div className="space-y-3">
        {stages.map((stage, i) => {
          const prev = stages[i - 1];
          const dropoff = prev && prev.count > 0 ? Math.round((1 - stage.count / prev.count) * 100) : null;
          const width = Math.max(5, Math.round((stage.count / maxCount) * 100));
          return (
            <div key={stage.label} data-testid={`funnel-stage-${stage.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="font-medium text-slate-800">{stage.label}</span>
                <span className="text-slate-500">{stage.count.toLocaleString()}</span>
              </div>
              <div className="h-8 bg-slate-100 rounded-lg overflow-hidden">
                <div className="h-full bg-al-primary rounded-lg flex items-center px-3" style={{ width: `${width}%` }}>
                  <span className="text-xs text-white font-semibold">{stage.count}</span>
                </div>
              </div>
              {dropoff !== null && dropoff > 0 && (
                <p className="text-xs text-red-500 mt-0.5">↓ {dropoff}% drop-off</p>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
