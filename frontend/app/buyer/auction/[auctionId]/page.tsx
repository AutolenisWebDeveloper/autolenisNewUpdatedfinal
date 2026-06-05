import type { Metadata } from "next";

export const metadata: Metadata = { title: "Auction Details" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import LiveAuctionView from "@/components/buyer/LiveAuctionView";
import DeclineAuctionButton from "@/components/buyer/DeclineAuctionButton";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ auctionId: string }> }

export default async function AuctionDetailPage({ params }: Props) {
  const { auctionId } = await params;
  const buyer = await requireBuyer();
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    include: {
      _count: {
        select: {
          offers: { where: { status: "SUBMITTED" } },
          invitations: true,
          outsideInvites: true,
        },
      },
    },
  });
  if (!auction) notFound();

  const isClosed = auction.status === "CLOSED";
  const offerCount = auction._count.offers;
  // Group 7 (7B) — dealers invited = registered + outside invites.
  const dealersInvited = auction._count.invitations + auction._count.outsideInvites;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="auction-detail-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Your Auction</h1>
        <p className="text-sm text-slate-500">{auction.status}</p>
      </div>

      {auction.status === "ACTIVE" && auction.endsAt && (
        <LiveAuctionView
          auctionId={auction.id}
          endsAt={auction.endsAt.toISOString()}
          initialOfferCount={offerCount}
          initialDealersInvited={dealersInvited}
        />
      )}

      {auction.status === "ACTIVE" && (
        <div className="mt-6">
          <DeclineAuctionButton auctionId={auction.id} />
        </div>
      )}

      {isClosed && offerCount > 0 && (
        <div className="bg-white border-2 border-[#0B5FD1] rounded-2xl p-8 text-center" data-testid="auction-closed-offers-ready">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Your offers are ready</h2>
          <p className="text-slate-500 text-sm mb-6">{offerCount} dealer{offerCount !== 1 ? "s" : ""} submitted an offer. Review and select your best deal.</p>
          <Button href={`/buyer/auction/${auctionId}/offers`} data-testid="review-offers-btn">
            Review Offers <ArrowRight size={15} />
          </Button>
        </div>
      )}

      {isClosed && offerCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center" data-testid="auction-no-offers">
          <h2 className="text-xl font-bold text-slate-900 mb-2">No offers received</h2>
          <p className="text-slate-500 text-sm mb-4">Your $99 Auction Access Fee will be refunded within 3 business days. You may re-run your auction or request a specific vehicle.</p>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" href="/buyer/requests/new" data-testid="request-car-btn">Request a Car</Button>
          </div>
        </div>
      )}

      {auction.status === "PENDING" && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-8 text-center" data-testid="auction-pending">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Auction launching…</h2>
          <p className="text-slate-500 text-sm">
            {dealersInvited > 0
              ? `${dealersInvited} dealer${dealersInvited !== 1 ? "s" : ""} are being invited to compete. Your auction will go live shortly.`
              : "Dealers are being selected and invited. Your auction will go live shortly."}
          </p>
        </div>
      )}
    </div>
  );
}
