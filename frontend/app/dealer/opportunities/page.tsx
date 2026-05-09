// Feature 21 — Auction Opportunity Feed
// Shows real active auction invitations for this dealer that have no submitted offer yet
// Empty state if no opportunities are available

import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Sparkles, Clock, ArrowRight, Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DealerOpportunitiesPage() {
  const dealer = await requireDealer();

  // Active invitations where dealer hasn't submitted an offer yet — single query
  const opportunities = await prisma.auctionInvitation.findMany({
    where: {
      dealerId: dealer.id,
      auction: { status: "ACTIVE" },
      NOT: {
        auction: {
          offers: { some: { dealerId: dealer.id, status: "SUBMITTED" } },
        },
      },
    },
    include: {
      auction: { include: { deposit: { select: { status: true } } } },
    },
    orderBy: { sentAt: "desc" },
    take: 20,
  });

  function timeRemainingLabel(endsAt: Date | null): string {
    if (!endsAt) return "Unknown";
    const ms = endsAt.getTime() - Date.now();
    if (ms <= 0) return "Closing soon";
    const hrs = Math.floor(ms / 3600000);
    if (hrs < 1) return "< 1 hour";
    if (hrs < 24) return `${hrs}h remaining`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h remaining`;
  }

  function urgencyColor(endsAt: Date | null): string {
    if (!endsAt) return "text-slate-500";
    const hrs = (endsAt.getTime() - Date.now()) / 3600000;
    if (hrs < 6) return "text-red-600";
    if (hrs < 12) return "text-amber-600";
    return "text-green-600";
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-opportunities-page">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Buyer Opportunities</h1>
        {opportunities.length > 0 && (
          <Badge>{opportunities.length} open</Badge>
        )}
      </div>

      {opportunities.length === 0 ? (
        <div className="text-center py-20 text-slate-400" data-testid="no-opportunities">
          <Sparkles size={40} className="mx-auto mb-4 text-slate-300" />
          <p className="font-semibold text-slate-600">No open opportunities right now</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            You&apos;ve responded to all active invitations, or no new auctions match your profile yet.
            Check back soon — new buyer requests are matched daily.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {opportunities.map(inv => (
            <div
              key={inv.id}
              data-testid={`opportunity-${inv.id}`}
              className="bg-white border-2 border-[#0B5FD1]/20 rounded-xl p-5 hover:border-[#0B5FD1]/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <Badge variant="green">Active Auction</Badge>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <Gavel size={14} className="text-slate-400 shrink-0" />
                    <p className="text-sm font-medium text-slate-700 truncate">
                      Auction #{inv.auctionId.slice(0, 8)}
                    </p>
                  </div>
                  <div className={`flex items-center gap-1.5 text-sm font-medium mt-1 ${urgencyColor(inv.auction.endsAt)}`}
                    data-testid={`opportunity-time-${inv.id}`}>
                    <Clock size={13} />
                    {timeRemainingLabel(inv.auction.endsAt)}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Invitation received {inv.sentAt.toLocaleDateString()}
                  </p>
                </div>
                <Button
                  href={`/dealer/quick-offer/${inv.auctionId}`}
                  size="sm"
                  data-testid={`submit-offer-btn-${inv.id}`}
                >
                  Submit Offer <ArrowRight size={13} className="ml-1" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-6">
        Opportunities are matched to your inventory, location, and tier. Invitations expire when the auction closes.
      </p>
    </div>
  );
}
