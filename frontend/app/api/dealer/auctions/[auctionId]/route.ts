import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { bucketBudgetCents } from "@/lib/utils/buyer-budget";

interface Props { params: Promise<{ auctionId: string }> }

// GET /api/dealer/auctions/[auctionId]
//
// Anonymization contract:
//   - dealer CAN see: vehicle specs, anonymized buyer budget range,
//     deadline, offer count, their own submitted offer (read-only)
//   - dealer CANNOT see: buyer name/contact, exact buyer budget,
//     other dealers' offers, internal foreign keys
export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // 1) Gate: dealer must be invited to this auction.
  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    select: {
      id: true,
      sentAt: true,
      viewedAt: true,
      respondedAt: true,
    },
  });
  if (!invitation) {
    return errorResponse("NOT_FOUND", "Auction invitation not found", 404);
  }

  // 2) Auction shell + vehicle specs + offer count (no buyer relation).
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
      _count: { select: { offers: true } },
    },
  });
  if (!auction) {
    return errorResponse("NOT_FOUND", "Auction not found", 404);
  }

  // 3) Coarsen buyer's approved OTD budget into a range. Never return the
  //    exact maxOtdAmountCents to a dealer.
  const prequal = await prisma.preQualification.findUnique({
    where: { buyerId: auction.buyerId },
    select: { maxOtdAmountCents: true },
  });
  const budgetRange = prequal?.maxOtdAmountCents
    ? bucketBudgetCents(prequal.maxOtdAmountCents)
    : null;

  // 4) Dealer's own latest offer (read-only after submission). Other dealers'
  //    offers are NEVER returned — the query is filtered by dealerId.
  const myOffer = await prisma.offer.findFirst({
    where: { auctionId, dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      otdPriceCents: true,
      vehiclePriceCents: true,
      taxCents: true,
      feesCents: true,
      junkFeeItems: true,
      includesFinancing: true,
      aprRate: true,
      termMonths: true,
      version: true,
      submittedAt: true,
      createdAt: true,
    },
  });

  // 5) Mark invitation as viewed (first-view tracking) — best-effort.
  if (!invitation.viewedAt) {
    await prisma.auctionInvitation
      .update({ where: { id: invitation.id }, data: { viewedAt: new Date() } })
      .catch(() => {});
  }

  // 6) Strip buyerId so the dealer never sees internal foreign keys that
  //    could be correlated with other endpoints.
  const { buyerId: _buyerId, _count, ...auctionPublic } = auction;
  void _buyerId;

  return successResponse({
    auction: { ...auctionPublic, offerCount: _count.offers },
    invitation,
    budgetRange,
    myOffer,
    // Server clock pinned in the response so client countdowns are driven
    // by server time, not the dealer's possibly-skewed local clock.
    serverNow: new Date().toISOString(),
  });
}
