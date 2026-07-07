import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Package } from "lucide-react";
import Link from "next/link";
import { PageContainer, PageHeader, EmptyState, CARD, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealerInventoryPage() {
  const dealer = await requireDealer();
  const inventory = await prisma.inventoryItem.findMany({
    where: { dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <PageContainer testId="dealer-inventory-page">
      <PageHeader
        title="My Inventory"
        subtitle="Vehicles you've listed or synced via your DMS feed."
        eyebrow={<Badge variant="secondary">{inventory.length} vehicles</Badge>}
        actions={
          <>
            <Button variant="secondary" size="sm" href="/dealer/inventory/feed-setup" data-testid="dms-feed-btn">DMS Feed</Button>
            <Button size="sm" href="/dealer/inventory/add" data-testid="add-vehicle-btn"><Plus size={14} /> Add Vehicle</Button>
          </>
        }
      />

      {inventory.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No inventory yet"
          body="Set up a DMS feed to automatically sync your inventory, or add vehicles manually."
          action={{ label: "Set up DMS feed", href: "/dealer/inventory/feed-setup", testId: "setup-feed-from-empty-btn" }}
          testId="no-inventory"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {inventory.map((item, i) => (
            <Link key={item.id} href={`/dealer/inventory/${item.id}`} data-testid={`inventory-item-${i}`}
              className={cn(CARD, "overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all")}>
              <div className="aspect-[16/9] bg-slate-100">
                {item.images[0] && <img src={item.images[0]} alt={`${item.year} ${item.make} ${item.model}`} className="w-full h-full object-cover" />}
              </div>
              <div className="p-4">
                <p className="font-semibold text-slate-900 text-sm">{item.year} {item.make} {item.model}</p>
                {item.mileage && <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{item.mileage.toLocaleString()} mi</p>}
                <div className="flex items-center justify-between mt-3">
                  <p className={cn("text-base", FIGURE)}>${(item.priceCents / 100).toLocaleString()}</p>
                  <Badge variant={item.isActive ? "green" : "gray"} className="text-xs">{item.isActive ? "Active" : "Inactive"}</Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
