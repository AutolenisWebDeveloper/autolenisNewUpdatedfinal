import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ auctionId: string }> }

// F22 — GET /api/dealer/auctions/[auctionId]/insights
// Only returns data to LOSING dealers — winners get 403
// All data anonymized — no competitor amounts, no competitor identity
export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    include: { auction: true },
  });
  if (!invitation) return errorResponse("NOT_FOUND", "Auction not found", 404);
  if (invitation.auction.status !== "CLOSED") return errorResponse("AUCTION_NOT_CLOSED", "Insights available after auction closes", 400);

  // Check if dealer won — winners excluded from loss insights
  const won = await prisma.offer.findFirst({ where: { auctionId, dealerId: dealer.id, status: "ACCEPTED" } });
  if (won) return errorResponse("FORBIDDEN", "Insights are for losing dealers only", 403);

  // Dealer's submitted offer
  const myOffer = await prisma.offer.findFirst({ where: { auctionId, dealerId: dealer.id, status: "SUBMITTED" } });

  // Anonymized segment data
  const allOffers = await prisma.offer.findMany({
    where: { auctionId, status: "SUBMITTED" },
    select: { otdPriceCents: true, feesCents: true },
  });

  // Anonymization guard: with too few offers the "median" is a specific
  // competitor's exact price (at n=2 the median is the other losing dealer's
  // OTD). Only surface a median once the sample is large enough that it cannot
  // be attributed to any single competitor.
  const MIN_MEDIAN_SAMPLE = 4;
  const medianOtd = allOffers.length >= MIN_MEDIAN_SAMPLE
    ? allOffers.map(o => o.otdPriceCents).sort((a, b) => a - b)[Math.floor(allOffers.length / 2)]
    : null;

  const myRank = myOffer
    ? allOffers.filter(o => o.otdPriceCents < myOffer.otdPriceCents).length + 1
    : null;

  return successResponse({
    offerCount: allOffers.length,
    myRank, myOffer: myOffer ? { otdPriceCents: myOffer.otdPriceCents, feesCents: myOffer.feesCents } : null,
    segmentMedianCents: medianOtd,
    // No competitor amounts, no competitor identity — anonymized medians only,
    // and only when the sample is large enough to stay anonymous.
  });
}
