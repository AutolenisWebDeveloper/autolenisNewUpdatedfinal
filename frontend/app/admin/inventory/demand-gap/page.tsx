import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { BarChart2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDemandGapPage() {
  await requireAdmin();
  // ENH-16: Segment demand vs. supply report
  const inventory = await prisma.inventoryItem.groupBy({
    by: ["make"],
    where: { isActive: true },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 20,
  });

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="demand-gap-page">
      <div className="flex items-center gap-3 mb-6"><BarChart2 size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Demand vs. Supply Analysis</h1></div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>{["Make","Active Listings","Est. Demand","Gap"].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.map(row => {
              const supply = row._count.id;
              const demand = Math.round(supply * (0.8 + Math.random() * 0.8)); // Placeholder
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
    </div>
  );
}
