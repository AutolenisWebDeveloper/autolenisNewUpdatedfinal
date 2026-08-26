import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { deriveAuctionEngagement } from "@/lib/services/auction/auction-engagement";

interface Props { params: Promise<{ auctionId: string }> }

// Feature 1 — Auction live status (poll-safe, RBAC buyer ownership)
// Never exposes offer amounts or dealer identities
export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    include: {
      _count: {
        select: {
          offers: { where: { status: "SUBMITTED" } },
          // Group 7 (7B) — surface how many dealers were invited to compete.
          invitations: true,
          outsideInvites: true,
        },
      },
    },
  });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  const now = new Date();
  const timeRemaining = auction.endsAt ? auction.endsAt.getTime() - now.getTime() : 0;
  const offerCount = auction._count.offers;
  // Total dealers invited = registered invitations + outside (unregistered) invites.
  const dealersInvited = auction._count.invitations + auction._count.outsideInvites;

  // Program 3 — TRUTHFUL engagement signal (no amounts, no dealer names). Real
  // participation is SUBMITTED offers only; the buyer is never told dealers are
  // bidding/reviewing merely because an auction record or invitation exists.
  const engagement = deriveAuctionEngagement({ status: auction.status, dealersInvited, offerCount });

  return successResponse({
    status: auction.status,
    timeRemaining: Math.max(0, timeRemaining),
    endsAt: auction.endsAt,
    offerCount, // Count only — no amounts
    dealersInvited, // Group 7 (7B) — count only, no dealer identities
    dealersBidding: engagement.dealersBidding, // real participation (== offerCount)
    engagementLevel: engagement.engagementLevel,
    socialProof: engagement.socialProof,
  });
}
