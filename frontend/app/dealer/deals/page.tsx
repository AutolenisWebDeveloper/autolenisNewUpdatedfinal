import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDeals } from "@/lib/services/dealer/dealer-deals.service";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeader, EmptyState, CARD, CARD_HOVER } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
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
    <PageContainer testId="dealer-deals-page">
      <PageHeader
        title="My Deals"
        subtitle="Auctions you've won, tracked through contract, buyer signing, and pickup."
        actions={<Badge variant="secondary">{deals.length}</Badge>}
      />

      {deals.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No deals yet"
          body="When an offer is accepted, the deal appears here to guide you through to delivery."
          action={{ label: "View your offers", href: "/dealer/offers", testId: "deals-empty-cta" }}
          testId="no-deals"
        />
      ) : (
        <div className="space-y-2">
          {/* Header row */}
          <div className="grid grid-cols-3 px-5 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em]">
            <span>Deal ID</span>
            <span>Status</span>
            <span className="text-right">Date</span>
          </div>
          {deals.map((deal) => (
            <Link
              key={deal.id}
              href={`/dealer/deals/${deal.id}`}
              data-testid={`deal-item-${deal.id}`}
              className={cn(CARD, CARD_HOVER, "grid grid-cols-3 items-center px-5 py-4")}
            >
              <span className="font-mono tabular-nums font-semibold text-slate-900 text-sm truncate pr-2">
                #{deal.id.slice(0, 8)}
              </span>
              <Badge variant={statusVariant(deal.status)} className="text-xs w-fit">
                {deal.status}
              </Badge>
              <span className="text-xs text-slate-500 text-right tabular-nums">
                {deal.createdAt.toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
