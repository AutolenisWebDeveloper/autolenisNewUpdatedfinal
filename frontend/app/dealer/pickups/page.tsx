import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerPickupDeals } from "@/lib/services/dealer/dealer-deals.service";
import { Badge } from "@/components/ui/badge";
import { Truck } from "lucide-react";
import PickupActionsClient from "@/components/dealer/PickupActionsClient";

export const dynamic = "force-dynamic";

export default async function DealerPickupsPage() {
  const dealer = await requireDealer();
  const pickups = await getDealerPickupDeals(dealer.id);

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-pickups-page">
      <div className="flex items-center gap-3 mb-6">
        <Truck size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Scheduled Pickups</h1>
        <Badge variant="secondary">{pickups.length}</Badge>
      </div>

      {pickups.length === 0 ? (
        <div className="text-center py-20 text-slate-400" data-testid="no-pickups">
          <Truck size={40} className="mx-auto mb-4 text-slate-300" />
          <p className="font-semibold text-slate-600">No scheduled pickups</p>
          <p className="text-sm mt-1">
            Deals in PICKUP_SCHEDULED stage will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pickups.map((deal) => {
            const shortId = deal.id.slice(0, 8);
            return (
              <div
                key={deal.id}
                data-testid={`pickup-item-${deal.id}`}
                className="bg-white border border-slate-200 rounded-xl p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-slate-900 font-mono">Deal #{shortId}</p>
                    {deal.pickup?.scheduledAt && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Scheduled: {deal.pickup.scheduledAt.toLocaleDateString()}
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      Created: {deal.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="blue">Pickup Scheduled</Badge>
                </div>
                <PickupActionsClient dealId={deal.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
