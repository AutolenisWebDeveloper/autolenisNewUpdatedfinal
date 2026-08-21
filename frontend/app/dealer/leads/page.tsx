import { requireDealer } from "@/lib/auth/dealer-session";
import Link from "next/link";
import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealerLeadsPage() {
  const dealer = await requireDealer();
  // Leads = auction invitations with buyer context
  // Select only the anonymized fields this view renders — never the full
  // auction row (which carries internal FKs like buyerId/depositId).
  const leads = await prisma.auctionInvitation.findMany({
    where: { dealerId: dealer.id },
    select: {
      id: true,
      auctionId: true,
      sentAt: true,
      auction: { select: { status: true } },
    },
    orderBy: { sentAt: "desc" },
    take: 20,
  });

  return (
    <PageContainer testId="dealer-leads-page">
      <PageHeader
        title="Leads"
        subtitle="Buyer auctions you've been invited to compete in."
        actions={<Badge variant="secondary">{leads.length}</Badge>}
      />
      {leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads yet"
          body="When you're invited to a buyer auction, it appears here as a lead."
          action={{ label: "View opportunities", href: "/dealer/opportunities", testId: "leads-empty-cta" }}
          testId="no-leads"
        />
      ) : (
        <div className="space-y-2">
          {leads.map((lead, i) => (
            <Link
              key={lead.id}
              href={`/dealer/auctions/${lead.auctionId}`}
              data-testid={`lead-item-${i}`}
              aria-label={`Open auction lead ${lead.auctionId.slice(-6)}`}
              className={cn(CARD, "flex items-center justify-between px-5 py-4 hover:border-al-primary/40 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus")}
            >
              <div>
                <p className="text-sm font-medium text-slate-800 font-mono tabular-nums">Auction Lead #{lead.auctionId.slice(-6)}</p>
                <p className="text-xs text-slate-500 tabular-nums">{lead.sentAt.toLocaleDateString()}</p>
              </div>
              <Badge variant={lead.auction.status === "ACTIVE" ? "green" : "secondary"} className="text-xs">{lead.auction.status}</Badge>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
