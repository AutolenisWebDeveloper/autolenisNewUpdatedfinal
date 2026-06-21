import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { rankOffers, selectTopOffers } from "@/lib/services/offer/best-price.service";

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

  // "Best Overall Value" must come from the weighted Best Price engine
  // (price + monthly + fees + junk-fees), NOT a positional median. Fall back to
  // the cheapest offer if the engine is unavailable so the card is never worse
  // than Best Cash.
  const ranked = await rankOffers(auctionId, termMonths).catch(() => []);
  const bestOverallId = selectTopOffers(ranked).bestOverall?.offerId;
  const overallOffer = (bestOverallId && offers.find(o => o.id === bestOverallId)) || sorted[0];

  const calculateMonthly = (priceCents: number, apr: number, months: number): number => {
    const r = apr / 12 / 100;
    return Math.round(priceCents * r / (1 - Math.pow(1 + r, -months)));
  };

  // Group 7 (7C) — per-offer transparency for the comparison UX:
  //   - OTD breakdown (vehicle + tax + fees) so the buyer sees what makes up the price
  //   - response time (how fast the dealer responded after the auction started)
  type OfferRow = (typeof offers)[number];
  const auctionStart = auction.startedAt ?? auction.createdAt;
  const offerExtras = (o: OfferRow) => {
    let responseTimeHours: number | null = null;
    if (o.submittedAt && auctionStart) {
      const ms = o.submittedAt.getTime() - auctionStart.getTime();
      if (ms >= 0) responseTimeHours = Math.max(1, Math.round(ms / 3_600_000));
    }
    return {
      otdBreakdown: {
        vehiclePriceCents: o.vehiclePriceCents,
        taxCents: o.taxCents,
        feesCents: o.feesCents,
      },
      responseTimeHours,
    };
  };

  const rankedRaw = [
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
      ...offerExtras(sorted[0]),
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
        ...offerExtras(bestMonthlyOffer),
      };
    })() : null,
    {
      offerId: overallOffer.id,
      rankType: "BEST_OVERALL",
      rankLabel: "Best Overall Value",
      otdPriceCents: overallOffer.otdPriceCents,
      monthlyPayment: undefined,
      junkFeesCents: 0,
      dealerTier: overallOffer.dealer.tier,
      rankingExplanation: "Highest overall AutoLenis score, balancing price, fees, and reliability.",
      aprFlag: overallOffer.aprFlag,
      aprRate: overallOffer.aprRate,
      ...offerExtras(overallOffer),
    },
  ];
  const rankedOffers = rankedRaw.filter(
    (o): o is NonNullable<typeof o> => o !== null,
  );

  // Group 7 (7C) — assign a unique numeric rank (#1, #2, #3) across the displayed
  // cards, ordered by out-the-door price (lowest = #1). Ties break by card order so
  // every card gets a distinct rank. Drives the rank badge in the UI.
  const rankByIndex = new Map<number, number>();
  rankedOffers
    .map((o, i) => ({ i, otd: o.otdPriceCents }))
    .sort((a, b) => a.otd - b.otd || a.i - b.i)
    .forEach((entry, pos) => rankByIndex.set(entry.i, pos + 1));
  const rankedWithNumbers = rankedOffers.map((o, i) => ({
    ...o,
    rank: rankByIndex.get(i) ?? i + 1,
  }));

  return successResponse({
    offers: rankedWithNumbers,
    preliminary: isActive,
    label: isActive ? "Preliminary Rankings — Final rankings after auction closes." : null,
  });
}
