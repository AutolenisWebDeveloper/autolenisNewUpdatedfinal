import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ auctionId: string }> }

// Feature 1 — Auction live status (poll-safe, RBAC buyer ownership)
// Never exposes offer amounts or dealer identities
export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    include: { _count: { select: { offers: { where: { status: "SUBMITTED" } } } } },
  });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  const now = new Date();
  const timeRemaining = auction.endsAt ? auction.endsAt.getTime() - now.getTime() : 0;
  const offerCount = auction._count.offers;

  // Anonymous engagement signal (no amounts, no dealer names)
  const engagementLevel = offerCount >= 5 ? "Very High" : offerCount >= 3 ? "High" : offerCount >= 1 ? "Active" : "Building";
  const aboveAverage = offerCount >= 3; // Platform baseline

  return successResponse({
    status: auction.status,
    timeRemaining: Math.max(0, timeRemaining),
    endsAt: auction.endsAt,
    offerCount, // Count only — no amounts
    engagementLevel,
    socialProof: aboveAverage ? "Your auction is performing above average" : "Dealers are reviewing your request",
  });
}
