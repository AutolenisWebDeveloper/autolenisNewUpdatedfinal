// GET /api/dealer/offers/[offerId] — one of this dealership's own offers.
//
// PHASE 7 CLOSED A LIVE CEILING DISCLOSURE HERE. The handler read:
//
//     const offer = await prisma.offer.findFirst({
//       where: { id: offerId, dealerId: dealer.id },
//       include: { auction: true },
//     });
//     return successResponse({ offer });
//
// `include` with no `select` serialises the WHOLE row, and Phase 6 started writing
// `offers.disqualified_reason` — whose text is literally
//
//     "Out-the-door exceeds the buyer's approved amount of $X."
//
// (`lib/services/offer/offer.service.ts:235-242`), built from the buyer's prequalification
// `maxOtdAmountCents`. `lib/utils/buyer-budget.ts:4` states the platform's own rule in its own
// words — "never expose maxOtdAmountCents to dealers directly" — which is why every other dealer
// surface coarsens it into 5k bands through `bucketBudgetCents`. This route returned the exact
// figure to any dealership that had submitted an over-ceiling offer, on its own offer id, so the
// ownership check passed: the leak was the FIELD, not the scope. `include: { auction: true }` also
// returned `auction.buyerId`.
//
// Phase 6 built `DEALER_OFFER_SELECT` for the list route (`app/api/dealer/offers/route.ts:58`) and
// pinned it with a test; this route was missed. It now uses the same projection — one list of
// dealer-safe offer fields, in one place, so the next field added to `offers` is dealer-visible
// only if somebody adds it there on purpose.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { DEALER_OFFER_SELECT } from "@/lib/services/offer/offer.service";

interface Props { params: Promise<{ offerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { offerId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const offer = await prisma.offer.findFirst({
    where: { id: offerId, dealerId: dealer.id },
    select: DEALER_OFFER_SELECT,
  });
  if (!offer) return errorResponse("NOT_FOUND", "Offer not found", 404);

  // The auction, PROJECTED. A dealer needs the deadline and the state to know whether they may
  // still revise; `buyerId` is not part of that and never was.
  const auction = await prisma.auction.findUnique({
    where: { id: offer.auctionId },
    select: { id: true, status: true, endsAt: true, startedAt: true },
  });

  return successResponse({ offer, auction });
}
