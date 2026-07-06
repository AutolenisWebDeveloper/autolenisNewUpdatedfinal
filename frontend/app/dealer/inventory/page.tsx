import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Package } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DealerInventoryPage() {
  const dealer = await requireDealer();
  const inventory = await prisma.inventoryItem.findMany({
    where: { dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="dealer-inventory-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Package size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">My Inventory</h1>
          <Badge variant="secondary">{inventory.length} vehicles</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" href="/dealer/inventory/feed-setup" data-testid="dms-feed-btn">DMS Feed</Button>
          <Link href="/dealer/inventory/add" data-testid="add-vehicle-btn">
            <Button size="sm"><Plus size={14} /> Add Vehicle</Button>
          </Link>
        </div>
      </div>

      {inventory.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-xl" data-testid="no-inventory">
          <Package size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 mb-2">No inventory yet</p>
          <p className="text-xs text-slate-400 mb-4">Set up a DMS feed to automatically sync your inventory, or add vehicles manually.</p>
          <Button variant="secondary" href="/dealer/inventory/feed-setup" data-testid="setup-feed-from-empty-btn">Set Up DMS Feed</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {inventory.map((item, i) => (
            <Link key={item.id} href={`/dealer/inventory/${item.id}`} data-testid={`inventory-item-${i}`}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all">
              <div className="aspect-[16/9] bg-slate-100">
                {item.images[0] && <img src={item.images[0]} alt={`${item.year} ${item.make} ${item.model}`} className="w-full h-full object-cover" />}
              </div>
              <div className="p-4">
                <p className="font-semibold text-slate-900 text-sm">{item.year} {item.make} {item.model}</p>
                {item.mileage && <p className="text-xs text-slate-400 mt-0.5">{item.mileage.toLocaleString()} mi</p>}
                <div className="flex items-center justify-between mt-3">
                  <p className="font-bold text-slate-900">${(item.priceCents / 100).toLocaleString()}</p>
                  <Badge variant={item.isActive ? "green" : "gray"} className="text-xs">{item.isActive ? "Active" : "Inactive"}</Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
