// POST /api/admin/auctions/[auctionId]/best-price/run
// Admin manually triggers the Best Price Engine for an auction.
// Returns 3 ranked outputs: bestCash, bestMonthly, bestOverall.
// Results are persisted to the Offer records (rankCash, rankMonthly, rankOverall, bestPriceScore).

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { rankOffers, selectTopOffers } from "@/lib/services/offer/best-price.service";

interface Props { params: Promise<{ auctionId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction) return adminError("NOT_FOUND", "Auction not found", 404);

  const ranked = await rankOffers(auctionId, 60, { persistLog: true });
  if (!ranked.length) return adminError("NO_OFFERS", "No submitted offers found for this auction", 400);

  // Persist ranks back to offer records
  await Promise.all(
    ranked.map(r =>
      prisma.offer.update({
        where: { id: r.offerId },
        data: {
          rankCash: r.rankCash,
          rankMonthly: r.rankMonthly,
          rankBalanced: r.rankOverall,
          bestPriceScore: r.overallScore,
        },
      }),
    ),
  );

  const { bestCash, bestMonthly, bestOverall } = selectTopOffers(ranked);

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BEST_PRICE_ENGINE_RUN",
      entityType: "Auction",
      entityId: auctionId,
      reason: "Admin manually triggered Best Price Engine",
      metadata: {
        offerCount: ranked.length,
        bestCashOfferId: bestCash?.offerId ?? null,
        bestMonthlyOfferId: bestMonthly?.offerId ?? null,
        bestOverallOfferId: bestOverall?.offerId ?? null,
      },
    },
  });

  return adminSuccess({
    auctionId,
    offerCount: ranked.length,
    bestCash,
    bestMonthly,
    bestOverall,
    allRanked: ranked,
  });
}
