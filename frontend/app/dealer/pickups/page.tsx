import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerPickupDeals } from "@/lib/services/dealer/dealer-deals.service";
import { Badge } from "@/components/ui/badge";
import { Truck } from "lucide-react";
import PickupActionsClient from "@/components/dealer/PickupActionsClient";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealerPickupsPage() {
  const dealer = await requireDealer();
  const pickups = await getDealerPickupDeals(dealer.id);

  return (
    <PageContainer testId="dealer-pickups-page">
      <PageHeader
        title="Scheduled Pickups"
        subtitle="Won deals scheduled for vehicle handoff."
        actions={<Badge variant="secondary">{pickups.length}</Badge>}
      />

      {pickups.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No scheduled pickups"
          body="Deals in the PICKUP_SCHEDULED stage will appear here."
          testId="no-pickups"
        />
      ) : (
        <div className="space-y-4">
          {pickups.map((deal) => {
            const shortId = deal.id.slice(0, 8);
            return (
              <div
                key={deal.id}
                data-testid={`pickup-item-${deal.id}`}
                className={cn(CARD, "p-5")}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-slate-900 font-mono tabular-nums">Deal #{shortId}</p>
                    {deal.pickup?.scheduledAt && (
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        Scheduled: {deal.pickup.scheduledAt.toLocaleDateString()}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
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
    </PageContainer>
  );
}
