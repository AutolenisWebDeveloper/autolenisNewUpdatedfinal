import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ auctionId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    include: { auction: { include: { _count: { select: { offers: true } } } } },
  });
  if (!invitation) {
    console.warn("[dealer/auctions/[auctionId]] no invitation", { auctionId, sessionDealerId: dealer.id });
    return errorResponse("NOT_FOUND", `Auction invitation not found (dealerId=${dealer.id}, auctionId=${auctionId})`, 404);
  }
  return successResponse({ auction: invitation.auction, invitation, sessionDealerId: dealer.id });
}
