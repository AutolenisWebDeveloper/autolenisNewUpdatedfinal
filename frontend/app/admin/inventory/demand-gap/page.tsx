import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { BarChart2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDemandGapPage() {
  await requireAdmin();
  // ENH-16: Segment demand vs. supply report.
  // Demand is measured from real buyer signals (vehicle requests naming the
  // make) — never estimated or fabricated.
  const [inventory, requests] = await Promise.all([
    prisma.inventoryItem.groupBy({
      by: ["make"],
      where: { isActive: true },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 20,
    }),
    prisma.vehicleRequest.groupBy({
      by: ["makePreference"],
      where: { makePreference: { not: null }, status: { notIn: ["CANCELLED"] } },
      _count: { id: true },
    }),
  ]);

  const demandByMake = new Map<string, number>();
  for (const r of requests) {
    if (!r.makePreference) continue;
    const key = r.makePreference.trim().toLowerCase();
    demandByMake.set(key, (demandByMake.get(key) ?? 0) + r._count.id);
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="demand-gap-page">
      <div className="flex items-center gap-3 mb-6"><BarChart2 size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Demand vs. Supply Analysis</h1></div>
      <p className="text-xs text-slate-500 mb-4">
        Demand = buyer vehicle requests naming the make (excluding cancelled). Gap &gt; 0 means more buyer requests than active listings.
      </p>
      {inventory.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-xl" data-testid="demand-gap-empty">
          <p className="font-medium text-slate-500">No active inventory</p>
          <p className="text-xs mt-1">Add inventory to see demand coverage by make.</p>
        </div>
      ) : (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>{["Make","Active Listings","Buyer Requests","Gap"].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.map(row => {
              const supply = row._count.id;
              const demand = demandByMake.get(row.make.trim().toLowerCase()) ?? 0;
              const gap = demand - supply;
              return (
                <tr key={row.make} data-testid={`demand-row-${row.make}`}>
                  <td className="px-4 py-3 font-medium">{row.make}</td>
                  <td className="px-4 py-3">{supply}</td>
                  <td className="px-4 py-3">{demand}</td>
                  <td className={`px-4 py-3 font-semibold ${gap > 0 ? "text-red-600" : "text-green-600"}`}>{gap > 0 ? `+${gap}` : gap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
