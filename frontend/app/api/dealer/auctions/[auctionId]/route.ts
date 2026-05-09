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
  if (!invitation) return errorResponse("NOT_FOUND", "Auction invitation not found", 404);
  return successResponse({ auction: invitation.auction, invitation });
}
