import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { bucketBudgetCents } from "@/lib/utils/buyer-budget";
import AuctionDeadlineCountdown from "@/components/dealer/AuctionDeadlineCountdown";
import { CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

interface Props { params: Promise<{ auctionId: string }> }

export const dynamic = "force-dynamic";

function vehicleLabel(v: { year: number | null; make: string | null; model: string | null; trim: string | null } | undefined): string {
  if (!v) return "Vehicle details pending";
  const parts = [v.year, v.make, v.model, v.trim].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Vehicle details pending";
}

export default async function DealerAuctionDetailPage({ params }: Props) {
  const { auctionId } = await params;
  const dealer = await requireDealer();

  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    select: { id: true, sentAt: true, viewedAt: true, respondedAt: true },
  });
  if (!invitation) notFound();

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endsAt: true,
      closedAt: true,
      buyerId: true,
      vehicles: {
        select: {
          id: true,
          year: true,
          make: true,
          model: true,
          trim: true,
          mileage: true,
          notes: true,
          inventoryItem: {
            select: {
              vin: true,
              exteriorColor: true,
              interiorColor: true,
              bodyType: true,
              transmission: true,
              fuelType: true,
            },
          },
        },
      },
    },
  });
  if (!auction) notFound();

  const prequal = await prisma.preQualification.findUnique({
    where: { buyerId: auction.buyerId },
    select: { maxOtdAmountCents: true },
  });
  const budget = prequal?.maxOtdAmountCents ? bucketBudgetCents(prequal.maxOtdAmountCents) : null;

  const myOffer = await prisma.offer.findFirst({
    where: { auctionId, dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
  });

  const isActive = auction.status === "ACTIVE";
  const isExpired = auction.endsAt ? auction.endsAt.getTime() <= Date.now() : false;
  const canBid = isActive && !isExpired;
  const primaryVehicle = auction.vehicles[0];

  // Mark first-view (best-effort) so admin reporting reflects engagement.
  if (!invitation.viewedAt) {
    await prisma.auctionInvitation
      .update({ where: { id: invitation.id }, data: { viewedAt: new Date() } })
      .catch(() => {});
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 md:p-8" data-testid="dealer-auction-detail-page">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight">Auction Invitation</h1>
        <Badge variant={isActive ? "green" : "gray"}>{auction.status}</Badge>
      </div>

      {canBid && auction.endsAt && (
        <AuctionDeadlineCountdown
          endsAtIso={auction.endsAt.toISOString()}
          serverNowIso={new Date().toISOString()}
        />
      )}

      {/* Vehicle specifications */}
      <div className={cn(CARD, "p-5 mb-6 mt-6")} data-testid="auction-vehicle">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-3">Vehicle</p>
        <p className="text-lg font-semibold text-slate-900 mb-2">{vehicleLabel(primaryVehicle)}</p>
        {primaryVehicle && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
            {primaryVehicle.mileage != null && (
              <>
                <dt className="text-slate-500">Mileage</dt>
                <dd className="tabular-nums">{primaryVehicle.mileage.toLocaleString()} mi</dd>
              </>
            )}
            {primaryVehicle.inventoryItem?.vin && (
              <>
                <dt className="text-slate-500">VIN</dt>
                <dd className="font-mono text-xs">{primaryVehicle.inventoryItem.vin}</dd>
              </>
            )}
            {primaryVehicle.inventoryItem?.exteriorColor && (
              <>
                <dt className="text-slate-500">Exterior</dt>
                <dd>{primaryVehicle.inventoryItem.exteriorColor}</dd>
              </>
            )}
            {primaryVehicle.inventoryItem?.interiorColor && (
              <>
                <dt className="text-slate-500">Interior</dt>
                <dd>{primaryVehicle.inventoryItem.interiorColor}</dd>
              </>
            )}
            {primaryVehicle.inventoryItem?.transmission && (
              <>
                <dt className="text-slate-500">Transmission</dt>
                <dd>{primaryVehicle.inventoryItem.transmission}</dd>
              </>
            )}
            {primaryVehicle.inventoryItem?.fuelType && (
              <>
                <dt className="text-slate-500">Fuel</dt>
                <dd>{primaryVehicle.inventoryItem.fuelType}</dd>
              </>
            )}
            {primaryVehicle.inventoryItem?.bodyType && (
              <>
                <dt className="text-slate-500">Body</dt>
                <dd>{primaryVehicle.inventoryItem.bodyType}</dd>
              </>
            )}
          </dl>
        )}
        {primaryVehicle?.notes && (
          <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">{primaryVehicle.notes}</p>
        )}
      </div>

      {/* Anonymous buyer context — budget range only, no identity */}
      <div className={cn(CARD, "p-5 mb-6")} data-testid="auction-context">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-3">Buyer</p>
        <div className="space-y-1 text-sm text-slate-700">
          <p>
            <span className="text-slate-500">Approved budget:</span>{" "}
            <span className="font-semibold tabular-nums" data-testid="buyer-budget-range">
              {budget?.label ?? "Not specified"}
            </span>
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Pre-qualified buyer. Identity is revealed to you only if your offer is selected.
          </p>
        </div>
      </div>

      {/* My offer status — read-only after submission */}
      {myOffer ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6" data-testid="my-offer-submitted">
          <div className="flex flex-wrap items-baseline gap-2 mb-2">
            <p className="font-semibold text-emerald-800">Your offer (read-only)</p>
            <Badge variant={myOffer.status === "ACCEPTED" ? "green" : "secondary"}>{myOffer.status}</Badge>
            {myOffer.version > 1 && <span className="text-xs text-emerald-700 tabular-nums">v{myOffer.version}</span>}
          </div>
          <p className="text-2xl font-mono tabular-nums font-bold text-emerald-900 mb-3">
            ${(myOffer.otdPriceCents / 100).toLocaleString()} <span className="text-base text-emerald-700">OTD</span>
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-emerald-900">
            <dt className="text-emerald-700">Vehicle</dt>
            <dd className="font-mono tabular-nums">${(myOffer.vehiclePriceCents / 100).toLocaleString()}</dd>
            <dt className="text-emerald-700">Tax</dt>
            <dd className="font-mono tabular-nums">${(myOffer.taxCents / 100).toLocaleString()}</dd>
            <dt className="text-emerald-700">Fees</dt>
            <dd className="font-mono tabular-nums">${(myOffer.feesCents / 100).toLocaleString()}</dd>
            {myOffer.includesFinancing && myOffer.aprRate != null && myOffer.termMonths != null && (
              <>
                <dt className="text-emerald-700">Financing</dt>
                <dd className="font-mono tabular-nums">{myOffer.aprRate.toFixed(2)}% / {myOffer.termMonths} mo</dd>
              </>
            )}
          </dl>
          {canBid && myOffer.version < 2 && myOffer.status === "SUBMITTED" && (
            <Link
              href={`/dealer/offers/${myOffer.id}`}
              className="block mt-4 text-xs font-semibold text-emerald-800 hover:underline"
              data-testid="revise-offer-link"
            >
              Revise offer (1 revision allowed) →
            </Link>
          )}
          {!canBid && (
            <p className="text-xs text-emerald-700 mt-4">
              Auction closed — revisions are no longer accepted.
            </p>
          )}
        </div>
      ) : canBid ? (
        <div className="text-center py-8" data-testid="no-offer-yet">
          <p className="text-slate-500 text-sm mb-4">You haven&apos;t submitted an offer yet.</p>
          <Button href={`/dealer/quick-offer/${auctionId}`} data-testid="submit-offer-from-detail-btn">
            Submit Offer <ArrowRight size={14} />
          </Button>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5" data-testid="auction-closed-no-offer">
          <p className="font-semibold text-slate-700 mb-1">Auction closed without your offer</p>
          <p className="text-xs text-slate-500">
            This invitation is now in your archive. You can review market insights below to inform future bids.
          </p>
        </div>
      )}

      {!canBid && (
        <div className="mt-4">
          <Link
            href={`/dealer/auctions/${auctionId}/insights`}
            className="text-sm text-al-primary font-semibold hover:underline"
            data-testid="view-insights-link"
          >
            View post-auction insights →
          </Link>
        </div>
      )}
    </div>
  );
}
