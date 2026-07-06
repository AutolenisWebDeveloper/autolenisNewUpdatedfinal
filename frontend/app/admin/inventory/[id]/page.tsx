// /admin/inventory/[id] — inventory item detail with analytics

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props { params: Promise<{ id: string }> }
export const dynamic = "force-dynamic";

export default async function AdminInventoryDetailPage({ params }: Props) {
  const { id } = await params;
  await requireAdmin();
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) notFound();

  const priceHistory = Array.isArray(item.priceHistory) ? item.priceHistory as Array<{price: number; date: string}> : [];

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-inventory-detail-page">
      <h1 className="text-xl font-bold text-slate-900 mb-1">{item.year} {item.make} {item.model}</h1>
      {item.trim && <p className="text-sm text-slate-400 mb-4">{item.trim}</p>}

      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: "Price", value: `$${(item.priceCents / 100).toLocaleString()}` },
          { label: "Mileage", value: item.mileage ? `${item.mileage.toLocaleString()} mi` : "—" },
          { label: "VIN", value: item.vin ?? "Not provided" },
          { label: "Lane", value: item.lane.replace("_", " ") },
          { label: "Status", value: item.isActive ? "Active" : "Inactive" },
          { label: "Last seen", value: item.lastSeenAt?.toLocaleDateString() ?? "—" },
        ].map(f => (
          <div key={f.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-400">{f.label}</p>
            <p className="font-semibold text-slate-800 mt-0.5">{f.value}</p>
          </div>
        ))}
      </div>

      {priceHistory.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <p className="font-semibold text-slate-800 text-sm mb-3">Price History ({priceHistory.length} points)</p>
          <div className="flex items-end gap-1 h-12">
            {priceHistory.slice(-12).map((p, i) => {
              const prices = priceHistory.slice(-12).map(ph => ph.price);
              const min = Math.min(...prices); const max = Math.max(...prices);
              const h = Math.max(4, Math.round(((p.price - min) / (max - min || 1)) * 40));
              return <div key={i} className="flex-1 bg-al-primary rounded-t opacity-70" style={{ height: `${h}px` }} title={`$${(p.price/100).toLocaleString()}`} />;
            })}
          </div>
        </div>
      )}

      {/* External dealer info — admin-visible */}
      {item.externalDealerName && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4" data-testid="external-dealer-info">
          <p className="text-xs font-semibold text-slate-400 uppercase mb-2">External Dealer (admin only)</p>
          <p className="text-sm font-medium text-slate-800">{item.externalDealerName}</p>
          {item.externalDealerCity && <p className="text-xs text-slate-500">{item.externalDealerCity}, {item.externalDealerState}</p>}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <Button size="sm" variant="secondary" data-testid="toggle-active-btn">
          {item.isActive ? "Deactivate" : "Activate"}
        </Button>
        <Button size="sm" variant="ghost" data-testid="force-resync-btn">Force Resync</Button>
      </div>
    </div>
  );
}
