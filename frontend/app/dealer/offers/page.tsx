import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeader, EmptyState, CARD, CARD_HOVER, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealerOffersPage() {
  const dealer = await requireDealer();
  // PROJECTED, not `include`d — §29 P3 and the §13-D22 guard. The list renders four fields; an
  // unprojected read also returns `disqualified_reason` (which embeds the buyer's approved amount
  // as a dollar figure), the rank columns, and every auction column including `buyerId`. Nothing
  // rendered them, which made this an over-read rather than a disclosure — and one edit away from
  // being one.
  const offers = await prisma.offer.findMany({
    where: { dealerId: dealer.id },
    select: { id: true, status: true, otdPriceCents: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const statusVariant: Record<string, "green" | "blue" | "gray" | "amber" | "destructive"> = {
    ACCEPTED: "green", SUBMITTED: "blue", DRAFT: "amber", DECLINED: "gray", WITHDRAWN: "gray",
  };

  return (
    <PageContainer testId="dealer-offers-page">
      <PageHeader
        title="My Offers"
        subtitle="Every out-the-door offer you've submitted, newest first."
        actions={<Badge variant="secondary">{offers.length}</Badge>}
      />
      {offers.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No offers submitted yet"
          body="When you submit an out-the-door offer on an auction, it appears here with its status."
          action={{ label: "Browse opportunities", href: "/dealer/opportunities", testId: "offers-empty-cta" }}
          testId="no-offers"
        />
      ) : (
        <div className="space-y-2">
          {offers.map(offer => (
            <Link key={offer.id} href={`/dealer/offers/${offer.id}`} data-testid={`offer-item-${offer.id}`}
              className={cn(CARD, CARD_HOVER, "flex items-center justify-between px-5 py-4")}>
              <div className="flex items-center gap-3">
                <Badge variant={statusVariant[offer.status] ?? "gray"} className="text-xs">{offer.status}</Badge>
                <span className={cn("text-sm", FIGURE)}>${(offer.otdPriceCents / 100).toLocaleString()}</span>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">{offer.createdAt.toLocaleDateString()}</span>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
