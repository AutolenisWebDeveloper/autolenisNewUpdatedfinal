import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart2, Eye, Heart, TrendingUp } from "lucide-react";

interface Props { params: Promise<{ id: string }> }

export default async function DealerInventoryDetailPage({ params }: Props) {
  const { id } = await params;
  const dealer = await requireDealer();
  const item = await prisma.inventoryItem.findFirst({ where: { id, dealerId: dealer.id } });
  if (!item) notFound();

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-inventory-detail-page">
      <h1 className="text-xl font-bold text-slate-900 mb-1">{item.year} {item.make} {item.model}</h1>
      {item.trim && <p className="text-sm text-slate-400 mb-6">{item.trim}</p>}

      <div className="grid grid-cols-2 gap-4 mb-8">
        {[
          { label: "Price", value: `$${(item.priceCents / 100).toLocaleString()}` },
          { label: "Mileage", value: item.mileage ? `${item.mileage.toLocaleString()} mi` : "—" },
          { label: "VIN", value: item.vin ?? "Not provided" },
          { label: "Status", value: item.isActive ? "Active" : "Inactive" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-0.5">{s.label}</p>
            <p className="font-semibold text-slate-800">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Analytics panel — dealer inventory performance */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="inventory-analytics-panel">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={16} className="text-[#0B5FD1]" />
          <p className="font-semibold text-slate-800 text-sm">Performance Analytics</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { icon: Eye, label: "Views", value: "—" },
            { icon: Heart, label: "Shortlist adds", value: "—" },
            { icon: TrendingUp, label: "Shortlist rate", value: "—" },
            { icon: BarChart2, label: "Quality score", value: "—" },
          ].map(m => (
            <div key={m.label} data-testid={`inventory-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="flex items-center gap-3">
              <m.icon size={15} className="text-slate-400" />
              <div>
                <p className="text-lg font-bold text-slate-900">{m.value}</p>
                <p className="text-xs text-slate-400">{m.label}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-4">Full analytics available when buyers interact with your listing.</p>
      </div>
    </div>
  );
}
