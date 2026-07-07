import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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

  const rows = [
    { label: "OTD Price", value: `$${(offer.otdPriceCents / 100).toLocaleString()}` },
    { label: "Vehicle Price", value: `$${(offer.vehiclePriceCents / 100).toLocaleString()}` },
    { label: "Tax", value: `$${(offer.taxCents / 100).toLocaleString()}` },
    { label: "Fees", value: `$${(offer.feesCents / 100).toLocaleString()}` },
    offer.includesFinancing ? { label: "APR", value: `${offer.aprRate}%` } : null,
    offer.includesFinancing ? { label: "Term", value: `${offer.termMonths} months` } : null,
    { label: "Version", value: `v${offer.version} of 2 max` },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 md:p-8" data-testid="offer-detail-page">
      <PageHeader
        title="Offer detail"
        subtitle="Your submitted out-the-door breakdown for this auction."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={offer.status === "ACCEPTED" ? "green" : offer.status === "SUBMITTED" ? "blue" : "secondary"}>
              {offer.status}
            </Badge>
            {offer.aprFlag === "SUSPICIOUS_APR" && (
              <Badge variant="destructive" className="text-xs" data-testid="suspicious-apr-flag">APR Flagged</Badge>
            )}
          </div>
        }
      />

      <div className={cn(CARD, "p-6 space-y-4 mb-6")}>
        {rows.map(item => (
          <div key={item.label} className="flex items-center justify-between text-sm">
            <span className="text-slate-500">{item.label}</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">{item.value}</span>
          </div>
        ))}
      </div>

      {canRevise && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6" data-testid="revise-offer-section">
          <p className="text-sm font-semibold text-amber-800 mb-1">Revision available</p>
          <p className="text-xs text-amber-700 mb-3">You may revise this offer once before the auction closes.</p>
          <Button size="sm" variant="secondary" href={`/dealer/auctions/${offer.auctionId}`} data-testid="revise-offer-btn">
            Revise Offer
          </Button>
        </div>
      )}

      <Link
        href="/dealer/offers"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-al-primary/40"
        data-testid="back-to-offers"
      >
        <ArrowLeft size={15} /> Back to offers
      </Link>
    </div>
  );
}
