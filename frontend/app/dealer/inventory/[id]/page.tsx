import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { BarChart2, Eye, Heart, TrendingUp } from "lucide-react";
import { CARD, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

interface Props { params: Promise<{ id: string }> }

export default async function DealerInventoryDetailPage({ params }: Props) {
  const { id } = await params;
  const dealer = await requireDealer();
  const item = await prisma.inventoryItem.findFirst({ where: { id, dealerId: dealer.id } });
  if (!item) notFound();

  const specs: { label: string; value: string; mono?: boolean }[] = [
    { label: "Price", value: `$${(item.priceCents / 100).toLocaleString()}`, mono: true },
    { label: "Mileage", value: item.mileage ? `${item.mileage.toLocaleString()} mi` : "—", mono: true },
    { label: "VIN", value: item.vin ?? "Not provided", mono: true },
    { label: "Status", value: item.isActive ? "Active" : "Inactive" },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 md:p-8" data-testid="dealer-inventory-detail-page">
      <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight mb-1">{item.year} {item.make} {item.model}</h1>
      {item.trim && <p className="text-sm text-slate-500 mb-6">{item.trim}</p>}

      <div className="grid grid-cols-2 gap-4 mb-8">
        {specs.map(s => (
          <div key={s.label} className={cn(CARD, "p-4")}>
            <p className="text-xs text-slate-500 mb-0.5">{s.label}</p>
            <p className={s.mono ? "font-mono tabular-nums font-semibold text-slate-900 break-all" : "font-semibold text-slate-800"}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Analytics panel — dealer inventory performance */}
      <div className={cn(CARD, "p-5")} data-testid="inventory-analytics-panel">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={16} className="text-al-primary" />
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
                <p className={cn("text-lg", FIGURE)}>{m.value}</p>
                <p className="text-xs text-slate-500">{m.label}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-4">Full analytics available when buyers interact with your listing.</p>
      </div>
    </div>
  );
}
