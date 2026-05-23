import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface Props { params: Promise<{ offerId: string }> }

export default async function DealerOfferDetailPage({ params }: Props) {
  const { offerId } = await params;
  const dealer = await requireDealer();
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, dealerId: dealer.id },
    include: { auction: true },
  });
  if (!offer) notFound();

  // Mirrors reviseOffer() server-side guard: status SUBMITTED, version below
  // cap, auction ACTIVE, and deadline not yet passed.
  const deadlinePassed = offer.auction.endsAt
    ? offer.auction.endsAt.getTime() <= Date.now()
    : false;
  const canRevise =
    offer.status === "SUBMITTED" &&
    offer.version < 2 &&
    offer.auction.status === "ACTIVE" &&
    !deadlinePassed;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="offer-detail-page">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-bold text-slate-900">Offer Detail</h1>
        <Badge variant={offer.status === "ACCEPTED" ? "green" : offer.status === "SUBMITTED" ? "blue" : "secondary"}>
          {offer.status}
        </Badge>
        {offer.aprFlag === "SUSPICIOUS_APR" && (
          <Badge variant="destructive" className="text-xs" data-testid="suspicious-apr-flag">APR Flagged</Badge>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 mb-6">
        {[
          { label: "OTD Price", value: `$${(offer.otdPriceCents / 100).toLocaleString()}` },
          { label: "Vehicle Price", value: `$${(offer.vehiclePriceCents / 100).toLocaleString()}` },
          { label: "Tax", value: `$${(offer.taxCents / 100).toLocaleString()}` },
          { label: "Fees", value: `$${(offer.feesCents / 100).toLocaleString()}` },
          offer.includesFinancing ? { label: "APR", value: `${offer.aprRate}%` } : null,
          offer.includesFinancing ? { label: "Term", value: `${offer.termMonths} months` } : null,
          { label: "Version", value: `v${offer.version} of 2 max` },
        ].filter(Boolean).map(item => (
          <div key={item!.label} className="flex items-center justify-between text-sm">
            <span className="text-slate-500">{item!.label}</span>
            <span className="font-semibold text-slate-900">{item!.value}</span>
          </div>
        ))}
      </div>

      {canRevise && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4" data-testid="revise-offer-section">
          <p className="text-sm font-semibold text-amber-800 mb-2">Revision available</p>
          <p className="text-xs text-amber-600 mb-3">You may revise this offer once before the auction closes.</p>
          <Button size="sm" variant="secondary" href={`/dealer/auctions/${offer.auctionId}`} data-testid="revise-offer-btn">
            Revise Offer
          </Button>
        </div>
      )}

      <Link href="/dealer/offers" className="text-sm text-slate-400 hover:underline" data-testid="back-to-offers">← Back to offers</Link>
    </div>
  );
}
