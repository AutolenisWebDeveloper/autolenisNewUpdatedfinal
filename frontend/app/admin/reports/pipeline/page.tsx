// Feature 23 — Admin Revenue Pipeline Forecasting
// Stage breakdown with weighted projections, risk overlay, CSV export
// Math: projection = active deals at stage × completion_rate × $499 fee

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { BarChart2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PREMIUM_FEE_CENTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const STAGE_WEIGHTS: Record<string, number> = {
  FINANCING_PENDING: 0.65,
  FEE_PENDING: 0.70,
  FEE_PAID: 0.75,
  INSURANCE_PENDING: 0.80,
  CONTRACT_PENDING: 0.82,
  CONTRACT_REVIEW: 0.85,
  CONTRACT_APPROVED: 0.90,
  SIGNING_PENDING: 0.92,
  SIGNED: 0.97,
  PICKUP_SCHEDULED: 0.99,
};

export default async function AdminPipelinePage() {
  await requireAdmin();

  const deals = await prisma.deal.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
    select: { status: true, offer: { select: { otdPriceCents: true } } },
  });

  const stageBreakdown = deals.reduce((acc, d) => {
    const status = d.status;
    if (!acc[status]) acc[status] = { count: 0, otdTotal: 0, weight: STAGE_WEIGHTS[status] ?? 0.5 };
    acc[status].count++;
    acc[status].otdTotal += d.offer.otdPriceCents;
    return acc;
  }, {} as Record<string, { count: number; otdTotal: number; weight: number }>);

  const totalProjected = Object.values(stageBreakdown).reduce(
    (sum, s) => sum + s.count * (PREMIUM_FEE_CENTS / 100) * s.weight, 0
  );

  const completedDeals = await prisma.deal.count({ where: { status: "COMPLETED" } });
  const totalRevenue = completedDeals * (PREMIUM_FEE_CENTS / 100);

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-pipeline-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BarChart2 size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Revenue Pipeline</h1>
        </div>
        <Button variant="secondary" size="sm" href="/api/admin/reports/pipeline?format=csv" data-testid="export-pipeline-csv-btn">
          <Download size={14} />Export CSV
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Projected Revenue", value: `$${totalProjected.toFixed(0)}`, sub: "Weighted by stage completion" },
          { label: "Active Deals", value: deals.length.toString(), sub: "Across all pipeline stages" },
          { label: "Total Realized", value: `$${totalRevenue.toLocaleString()}`, sub: `${completedDeals} completed deals` },
        ].map(kpi => (
          <div key={kpi.label} data-testid={`pipeline-kpi-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-2xl font-bold text-slate-900">{kpi.value}</p>
            <p className="text-sm font-medium text-slate-600 mt-0.5">{kpi.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Stage breakdown */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="pipeline-stage-breakdown">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Stage", "Deals", "Weight", "Projected Revenue"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Object.entries(stageBreakdown).sort((a, b) => b[1].weight - a[1].weight).map(([stage, data]) => (
              <tr key={stage} data-testid={`pipeline-stage-${stage.toLowerCase().replace(/_/g, "-")}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-700 text-xs">{stage.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">{data.count}</td>
                <td className="px-4 py-3 text-slate-500">{Math.round(data.weight * 100)}%</td>
                <td className="px-4 py-3 font-semibold text-green-600">${(data.count * (PREMIUM_FEE_CENTS / 100) * data.weight).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-4 text-center">
        Pipeline projection = deals at stage × ${PREMIUM_FEE_CENTS / 100} concierge fee × stage completion weight.
        <Button variant="link" size="sm" href="/admin/reports/risk" className="text-xs ml-1" data-testid="link-to-risk-from-pipeline">
          View risk overlay →
        </Button>
      </p>
    </div>
  );
}
