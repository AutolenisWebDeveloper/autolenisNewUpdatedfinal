import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Gavel, Clock, ArrowRight, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealerAuctionsPage() {
  const dealer = await requireDealer();
  const invitations = await prisma.auctionInvitation.findMany({
    where: { dealerId: dealer.id },
    include: { auction: { include: { _count: { select: { offers: true } } } } },
    orderBy: { sentAt: "desc" },
  });

  const activeInvitations = invitations.filter(i => i.auction.status === "ACTIVE");
  const pastInvitations = invitations.filter(i => i.auction.status !== "ACTIVE");

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-auctions-page">
      <div className="flex items-center gap-3 mb-6">
        <Gavel size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Auction Invitations</h1>
        {activeInvitations.length > 0 && (
          <Badge>{activeInvitations.length} active</Badge>
        )}
      </div>

      {activeInvitations.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Active — Submit your offer</h2>
          <div className="space-y-3">
            {activeInvitations.map(inv => (
              <Link key={inv.id} href={`/dealer/auctions/${inv.auction.id}`} data-testid={`active-auction-${inv.id}`}
                className="flex items-center justify-between bg-white border-2 border-[#0B5FD1]/20 rounded-xl p-5 hover:border-[#0B5FD1] transition-colors">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <Badge variant="green">Active</Badge>
                  </div>
                  <p className="text-sm text-slate-500">
                    {inv.auction.endsAt ? `Closes ${inv.auction.endsAt.toLocaleDateString()}` : "48-hour window"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[#0B5FD1]">Submit Offer</p>
                  <ArrowRight size={14} className="text-slate-400 ml-auto mt-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {pastInvitations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Past Auctions</h2>
          <div className="space-y-2">
            {pastInvitations.map(inv => (
              <div key={inv.id} data-testid={`past-auction-${inv.id}`}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div className="flex items-center gap-3">
                  <Badge variant={inv.auction.status === "CLOSED" ? "gray" : "secondary"}>{inv.auction.status}</Badge>
                  <span className="text-xs text-slate-400">{inv.sentAt.toLocaleDateString()}</span>
                </div>
                <Link href={`/dealer/auctions/${inv.auction.id}/insights`} className="text-xs text-[#0B5FD1] hover:underline" data-testid={`view-insights-${inv.id}`}>
                  View Insights →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {invitations.length === 0 && (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-xl" data-testid="no-auctions">
          <Clock size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No auction invitations yet</p>
          <p className="text-xs text-slate-400 mt-1">Invitations are sent based on your inventory match, tier, and capacity.</p>
        </div>
      )}
    </div>
  );
}
