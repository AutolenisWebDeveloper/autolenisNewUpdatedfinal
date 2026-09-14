// GET /api/buyer/auctions/[auctionId]/best-price — the Best Price Report.
//
// §8c parity row C9: "the buyer report is the ENGINE OUTPUT; no UI/route math."
//
// WHAT THIS ROUTE USED TO DO, and why every line of it was a defect:
//
//   • A SECOND RANKING IMPLEMENTATION. It re-sorted the offers itself, picked Best Cash from its
//     own sort and Best Overall from the engine, so the two could disagree about the same auction.
//   • A FABRICATED APR. `DEFAULT_APR_RATE = 7` was applied to offers that carry no financing, so
//     the Best Monthly card could be won by a cash offer on a payment no dealership ever quoted.
//   • TIES BROKEN "BY CARD ORDER" (`:134-141`). §8c requires equal results to be presented as
//     equal; this handed #1 to whichever card happened to be built first.
//   • A CLIENT-CONTROLLED, UNVALIDATED TERM. `parseInt(searchParams.get("months") ?? "60")` fed
//     `?months=abc` into the engine as `NaN` and `?months=0` into a monthly-payment formula that
//     divides by the term. §8.2 defect 9: server-only parameters.
//
// It now asks the service for the report and shapes it for the cards. The only arithmetic left is
// the OTD breakdown (a copy of three stored columns) and the response time (a subtraction of two
// stored timestamps) — neither is a ranking decision.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { getBestPriceReport, selectTopOffers, type RankedOffer } from "@/lib/services/offer/best-price.service";

interface Props { params: Promise<{ auctionId: string }> }

/**
 * §8a caps a financing term at 6–96 months, and `reviseOffer`/`submitOffer` validate the same
 * range. The report has to refuse anything else rather than clamp it silently: a buyer who asked
 * for 120 months and was shown 96 would be reading a payment they did not request.
 *
 * NO FIRST-PARTY CALLER SENDS THIS ANY MORE, and the parameter stays anyway. The buyer's Best
 * Price Report used to carry a comparison-term control; the owner deleted it on 2026-09-14
 * because a payment computed at a term no dealership quoted is a number nobody offered (§12 —
 * AutoLenis does not underwrite). `months` never changed a byte of this response even then: every
 * monthly figure is computed from the DEALERSHIP's own `term_months`, and `termMonths` reaches
 * only `persistLog`, which the buyer path does not pass.
 *
 * Kept because this is a public, authenticated input that anyone can still send by hand, and a
 * server-side guard on a reachable input outlives the client that used to populate it. Deleting it
 * would also delete the regression tests that pin the NaN / divide-by-zero defect this validation
 * was written for — losing the guard and the proof of the guard in one edit.
 */
const MIN_TERM_MONTHS = 6;
const MAX_TERM_MONTHS = 96;
const DEFAULT_TERM_MONTHS = 60;

export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const rawMonths = searchParams.get("months");
  let termMonths = DEFAULT_TERM_MONTHS;
  if (rawMonths !== null) {
    const parsed = Number(rawMonths);
    if (!Number.isInteger(parsed) || parsed < MIN_TERM_MONTHS || parsed > MAX_TERM_MONTHS) {
      return errorResponse(
        "VALIDATION_ERROR",
        `months must be a whole number between ${MIN_TERM_MONTHS} and ${MAX_TERM_MONTHS}`,
        400,
      );
    }
    termMonths = parsed;
  }

  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    select: { id: true, status: true, startedAt: true, createdAt: true },
  });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  // Ranking is offered on ACTIVE (preliminary) and CLOSED auctions only. Everything else has
  // nothing to rank — and §9's entry is a CLOSED auction.
  const isActive = auction.status === "ACTIVE";
  const isClosed = auction.status === "CLOSED";
  if (!isActive && !isClosed) {
    return errorResponse("AUCTION_NOT_AVAILABLE", "Auction is not yet open for ranking", 400);
  }

  const { ranked } = await getBestPriceReport(auctionId, termMonths);
  if (ranked.length === 0) {
    return successResponse({
      offers: [],
      preliminary: isActive,
      message: isActive ? "No offers yet" : "No offers were submitted",
    });
  }

  // Response time is a property of the offer, not of the ranking, so it is computed here from two
  // stored timestamps rather than persisted.
  const auctionStart = auction.startedAt ?? auction.createdAt;
  const responseTimeHours = (submittedAt: Date | null): number | null => {
    if (!submittedAt || !auctionStart) return null;
    const ms = submittedAt.getTime() - auctionStart.getTime();
    return ms >= 0 ? Math.max(1, Math.round(ms / 3_600_000)) : null;
  };

  const otdRows = await prisma.offer.findMany({
    where: { id: { in: ranked.map((r) => r.offerId) } },
    select: { id: true, vehiclePriceCents: true, taxCents: true, feesCents: true },
  });
  const otdById = new Map(otdRows.map((o) => [o.id, o]));

  const { bestCash, bestMonthly, bestOverall } = selectTopOffers(ranked);

  type CardType = "BEST_CASH" | "BEST_MONTHLY" | "BEST_OVERALL";
  const card = (o: RankedOffer, rankType: CardType, rankLabel: string, explanation: string) => {
    const otd = otdById.get(o.offerId);
    return {
      offerId: o.offerId,
      rankType,
      rankLabel,
      otdPriceCents: o.otdPriceCents,
      // NAMED FOR ITS UNIT. The engine computes from `otdPriceCents` and returns minor units, and
      // the field used to be called `monthlyPayment` — which the panel then printed raw as dollars,
      // rendering a $30,000 offer at 6.9%/72mo as "~$50990/mo". The name now carries the unit, so
      // the next reader cannot make the same mistake.
      monthlyPaymentCents: o.monthlyPayment,
      // The term the DEALERSHIP quoted. The card states this rather than the requested comparison
      // term, because the payment was computed from it — see the panel.
      monthlyTermMonths: o.monthlyTermMonths ?? null,
      junkFeesCents: o.junkFeesCents,
      dealerTier: o.dealerTier,
      rankingExplanation: explanation,
      aprFlag: o.aprFlag,
      aprRate: o.aprRate,
      otdBreakdown: otd
        ? { vehiclePriceCents: otd.vehiclePriceCents, taxCents: otd.taxCents, feesCents: otd.feesCents }
        : undefined,
      responseTimeHours: responseTimeHours(o.submittedAt),
    };
  };

  const cards = [
    bestCash ? card(bestCash, "BEST_CASH", "Best Cash Price", "Lowest out-the-door price among all qualified offers.") : null,
    // Only when a DIFFERENT offer wins on monthly — a single card claiming two titles told the
    // buyer there were two options when there was one.
    bestMonthly && bestMonthly.offerId !== bestCash?.offerId
      ? card(bestMonthly, "BEST_MONTHLY", "Best Monthly Payment", "Lowest estimated monthly payment on the financing the dealership actually offered.")
      : null,
    bestOverall && bestOverall.offerId !== bestCash?.offerId && bestOverall.offerId !== bestMonthly?.offerId
      ? card(bestOverall, "BEST_OVERALL", "Best Overall Value", "Best balance of out-the-door price, monthly payment, fees and junk fees under the current Best Price weights.")
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  // §8c: "equal-value results are presented honestly as equal". The badge is the engine's own
  // out-the-door rank restricted to the cards on screen, so two cards at the same price both read
  // #1 — rather than the old "ties break by card order", which invented a winner.
  const distinctPrices = [...new Set(cards.map((c) => c.otdPriceCents))].sort((a, b) => a - b);
  const badged = cards.map((c) => ({ ...c, rank: distinctPrices.indexOf(c.otdPriceCents) + 1 }));

  return successResponse({
    offers: badged,
    preliminary: isActive,
    label: isActive ? "Preliminary Rankings — Final rankings after auction closes." : null,
  });
}
