import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";

interface Props { params: Promise<{ auctionId: string }> }

export default async function DealerAuctionDetailPage({ params }: Props) {
  const { auctionId } = await params;
  const dealer = await requireDealer();

  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    include: { auction: true },
  });
  if (!invitation) notFound();

  const myOffer = await prisma.offer.findFirst({
    where: { auctionId, dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
  });

  const isActive = invitation.auction.status === "ACTIVE";
  const now = new Date();
  const timeLeft = invitation.auction.endsAt ? invitation.auction.endsAt.getTime() - now.getTime() : 0;
  const hoursLeft = Math.max(0, Math.floor(timeLeft / 3600000));

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="dealer-auction-detail-page">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-bold text-slate-900">Auction Invitation</h1>
        <Badge variant={isActive ? "green" : "gray"}>{invitation.auction.status}</Badge>
      </div>

      {isActive && timeLeft > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3" data-testid="auction-deadline-alert">
          <Clock size={18} className="text-amber-500" />
          <div>
            <p className="font-semibold text-amber-800 text-sm">{hoursLeft} hours remaining</p>
            <p className="text-xs text-amber-600">Submit your offer before the auction closes</p>
          </div>
        </div>
      )}

      {/* Anonymous buyer context — no buyer identity revealed */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="auction-context">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Auction Context</p>
        <div className="space-y-2 text-sm text-slate-600">
          <p>• Pre-qualified buyer with confirmed budget</p>
          <p>• Private 48-hour auction</p>
          <p>• Buyer identity revealed only after deal selection</p>
        </div>
      </div>

      {/* My offer status */}
      {myOffer ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6" data-testid="my-offer-submitted">
          <p className="font-semibold text-green-800 mb-1">Offer submitted</p>
          <p className="text-2xl font-bold text-green-900 mb-1">${(myOffer.otdPriceCents / 100).toLocaleString()}</p>
          <Badge variant={myOffer.status === "ACCEPTED" ? "green" : "secondary"}>{myOffer.status}</Badge>
          {myOffer.status === "SUBMITTED" && myOffer.version < 2 && isActive && (
            <Link href={`/dealer/offers/${myOffer.id}`} className="block mt-3 text-xs text-green-700 hover:underline" data-testid="revise-offer-link">
              Revise offer (1 revision allowed) →
            </Link>
          )}
        </div>
      ) : isActive ? (
        <div className="text-center py-8" data-testid="no-offer-yet">
          <p className="text-slate-500 text-sm mb-4">You haven&apos;t submitted an offer yet.</p>
          <Button href={`/dealer/quick-offer/${auctionId}`} data-testid="submit-offer-from-detail-btn">
            Submit Offer <ArrowRight size={14} />
          </Button>
        </div>
      ) : (
        <p className="text-slate-400 text-sm" data-testid="auction-closed-no-offer">This auction closed without your offer.</p>
      )}

      {!isActive && (
        <div className="mt-4">
          <Link href={`/dealer/auctions/${auctionId}/insights`} className="text-sm text-[#0B5FD1] font-semibold hover:underline" data-testid="view-insights-link">
            View post-auction insights →
          </Link>
        </div>
      )}
    </div>
  );
}
