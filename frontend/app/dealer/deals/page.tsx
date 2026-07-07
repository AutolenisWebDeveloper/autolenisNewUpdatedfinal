import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDeals } from "@/lib/services/dealer/dealer-deals.service";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Handshake } from "lucide-react";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "green" | "blue" | "secondary" {
  if (["SIGNED", "PICKUP_COMPLETE", "COMPLETED"].includes(status)) return "green";
  if (
    [
      "CONTRACT_PENDING",
      "CONTRACT_REVIEW",
      "CONTRACT_APPROVED",
      "SIGNING_PENDING",
      "PICKUP_SCHEDULED",
    ].includes(status)
  )
    return "blue";
  return "secondary";
}

export default async function DealerDealsPage() {
  const dealer = await requireDealer();
  const deals = await getDealerDeals(dealer.id);

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-deals-page">
      <div className="flex items-center gap-3 mb-6">
        <Handshake size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">My Deals</h1>
        <Badge variant="secondary">{deals.length}</Badge>
      </div>

      {deals.length === 0 ? (
        <div className="text-center py-20 text-slate-400" data-testid="no-deals">
          <Handshake size={40} className="mx-auto mb-4 text-slate-300" />
          <p className="font-semibold text-slate-600">No deals yet</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            When an offer is accepted, the deal appears here to guide you through to delivery.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header row */}
          <div className="grid grid-cols-3 px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            <span>Deal ID</span>
            <span>Status</span>
            <span className="text-right">Date</span>
          </div>
          {deals.map((deal) => (
            <Link
              key={deal.id}
              href={`/dealer/deals/${deal.id}`}
              data-testid={`deal-item-${deal.id}`}
              className="grid grid-cols-3 items-center bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-al-primary/30 transition-colors"
            >
              <span className="font-semibold text-slate-900 text-sm font-mono truncate pr-2">
                #{deal.id.slice(0, 8)}
              </span>
              <Badge variant={statusVariant(deal.status)} className="text-xs w-fit">
                {deal.status}
              </Badge>
              <span className="text-xs text-slate-400 text-right">
                {deal.createdAt.toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
