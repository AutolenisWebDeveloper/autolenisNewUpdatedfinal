import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offers", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import OfferComparisonPanel from "@/components/buyer/OfferComparisonPanel";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ auctionId: string }> }

export default async function AuctionOffersPage({ params }: Props) {
  const { auctionId } = await params;
  const buyer = await requireBuyer();
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    include: { _count: { select: { offers: { where: { status: "SUBMITTED" } } } } },
  });
  if (!auction) notFound();
  if (auction.status !== "CLOSED") {
    return (
      <div className="p-8 text-center text-slate-500" data-testid="offers-not-ready">
        <p>Offers are available after your auction closes.</p>
      </div>
    );
  }

  const offerCount = auction._count.offers;

  return (
    <div className="p-6 md:p-8" data-testid="auction-offers-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Your {offerCount} Offer{offerCount !== 1 ? "s" : ""}</h1>
        <p className="text-sm text-slate-500 mt-1">Compare your ranked offers. Dealer identity is revealed after selection.</p>
      </div>
      <OfferComparisonPanel auctionId={auctionId} />
    </div>
  );
}
