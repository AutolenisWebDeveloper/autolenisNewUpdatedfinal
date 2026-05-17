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
    // Diagnostics so dealers can self-diagnose mis-routed invitations (e.g.,
    // session resolves to a different dealerId than the one that was invited).
    const auctionExists = await prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true, status: true, _count: { select: { invitations: true } } },
    });
    return errorResponse(
      "NOT_FOUND",
      auctionExists
        ? `You are not invited to this auction. (Auction has ${auctionExists._count.invitations} invitation${auctionExists._count.invitations === 1 ? "" : "s"}.)`
        : "Auction not found.",
      404,
      { dealerId: dealer.id, auctionId, auctionExists: !!auctionExists },
    );
  }
  return successResponse({ auction: invitation.auction, invitation, dealerId: dealer.id });
}
