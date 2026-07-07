// System 4C — Admin request analytics (4C.13)
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { BarChart2 } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminRequestsAnalyticsPage() {
  await requireAdmin();
  const [total, active, offersSent, dealsCreated, cancelled] = await Promise.all([
    prisma.vehicleRequest.count(),
    prisma.vehicleRequest.count({ where: { status: { in: ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"] } } }),
    prisma.vehicleRequest.count({ where: { status: "OFFER_SENT" } }),
    prisma.vehicleRequest.count({ where: { status: "DEAL_CREATED" } }),
    prisma.vehicleRequest.count({ where: { status: "CANCELLED" } }),
  ]);

  const conversionRate = total > 0 ? Math.round((dealsCreated / total) * 100) : 0;

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-requests-analytics-page">
      <div className="flex items-center gap-3 mb-6"><BarChart2 size={20} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">System 4C Analytics</h1></div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: "Total Requests", value: total },
          { label: "Active", value: active },
          { label: "Offers Sent", value: offersSent },
          { label: "Deals Created", value: dealsCreated },
          { label: "Cancelled", value: cancelled },
          { label: "Conversion Rate", value: `${conversionRate}%` },
        ].map(s => (
          <div key={s.label} data-testid={`4c-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-al-primary">{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
