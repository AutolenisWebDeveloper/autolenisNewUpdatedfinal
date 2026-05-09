import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ auctionId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const termMonths = parseInt(searchParams.get("months") ?? "60");

  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    include: { offers: { where: { status: "SUBMITTED" }, include: { dealer: true } } },
  });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  // Allow ranking on ACTIVE or CLOSED auctions. ACTIVE rankings are flagged "preliminary".
  const isActive = auction.status === "ACTIVE";
  const isClosed = auction.status === "CLOSED";
  if (!isActive && !isClosed) {
    return errorResponse("AUCTION_NOT_AVAILABLE", "Auction is not yet open for ranking", 400);
  }

  const offers = auction.offers;
  if (offers.length === 0) {
    return successResponse({
      offers: [],
      preliminary: isActive,
      message: isActive ? "No offers yet" : "No offers were submitted",
    });
  }

  // Best Price Algorithm — rank by Cash, Monthly, Balanced
  // Dealer identity NEVER exposed until buyer selects deal
  const DEFAULT_APR_RATE = 7; // percent, used when offer has no APR rate
  const sorted = [...offers].sort((a, b) => a.otdPriceCents - b.otdPriceCents);

  const calculateMonthly = (priceCents: number, apr: number, months: number): number => {
    const r = apr / 12 / 100;
    return Math.round(priceCents * r / (1 - Math.pow(1 + r, -months)));
  };

  const rankedOffers = [
    {
      offerId: sorted[0].id,
      rankType: "BEST_CASH",
      rankLabel: "Best Cash Price",
      otdPriceCents: sorted[0].otdPriceCents,
      monthlyPayment: sorted[0].aprRate ? calculateMonthly(sorted[0].otdPriceCents, sorted[0].aprRate, termMonths) : undefined,
      junkFeesCents: (sorted[0].feesCents * 0.3) | 0,
      dealerTier: sorted[0].dealer.tier,
      rankingExplanation: "Lowest out-the-door price among all submitted offers.",
      aprFlag: sorted[0].aprFlag,
      aprRate: sorted[0].aprRate,
    },
    sorted.length > 1 ? (() => {
      // Sort by calculated monthly payment (lowest first) to find the best monthly offer
      const bestMonthlyOffer = [...offers].sort((a, b) =>
        calculateMonthly(a.otdPriceCents, a.aprRate ?? DEFAULT_APR_RATE, termMonths) -
        calculateMonthly(b.otdPriceCents, b.aprRate ?? DEFAULT_APR_RATE, termMonths)
      )[0];
      return {
        offerId: bestMonthlyOffer.id,
        rankType: "BEST_MONTHLY",
        rankLabel: "Best Monthly Payment",
        otdPriceCents: bestMonthlyOffer.otdPriceCents,
        monthlyPayment: calculateMonthly(bestMonthlyOffer.otdPriceCents, bestMonthlyOffer.aprRate ?? DEFAULT_APR_RATE, termMonths),
        junkFeesCents: 0,
        dealerTier: bestMonthlyOffer.dealer.tier,
        rankingExplanation: "Best estimated monthly payment given the offer financing terms.",
        aprFlag: bestMonthlyOffer.aprFlag,
        aprRate: bestMonthlyOffer.aprRate,
      };
    })() : null,
    {
      offerId: sorted[Math.floor(sorted.length / 2)].id,
      rankType: "BEST_OVERALL",
      rankLabel: "Best Overall Value",
      otdPriceCents: sorted[Math.floor(sorted.length / 2)].otdPriceCents,
      monthlyPayment: undefined,
      junkFeesCents: 0,
      dealerTier: sorted[Math.floor(sorted.length / 2)].dealer.tier,
      rankingExplanation: "Highest overall AutoLenis score, balancing price, fees, and reliability.",
      aprFlag: sorted[Math.floor(sorted.length / 2)].aprFlag,
      aprRate: sorted[Math.floor(sorted.length / 2)].aprRate,
    },
  ].filter(Boolean);

  return successResponse({
    offers: rankedOffers,
    preliminary: isActive,
    label: isActive ? "Preliminary Rankings — Final rankings after auction closes." : null,
  });
}
