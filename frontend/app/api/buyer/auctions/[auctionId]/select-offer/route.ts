import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { sendDealSelectedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ auctionId: string }> }

// POST /api/buyer/auctions/[auctionId]/select-offer — select a deal
export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { offerId } = await request.json() as { offerId: string };

  const auction = await prisma.auction.findFirst({ where: { id: auctionId, buyerId: buyer.id } });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  const offer = await prisma.offer.findFirst({
    where: { id: offerId, auctionId, status: "SUBMITTED" },
  });
  if (!offer) return errorResponse("NOT_FOUND", "Offer not found", 404);

  const deal = await prisma.deal.create({
    data: {
      buyerId: buyer.id,
      offerId: offer.id,
      status: "FINANCING_PENDING",
    },
  });

  await prisma.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
  await prisma.auction.update({ where: { id: auctionId }, data: { status: "CLOSED", closedAt: new Date() } });

  await prisma.notification.create({
    data: { buyerId: buyer.id, title: "Deal created!", body: "You selected your best deal. Continue to financing.", type: "DEAL_SELECTED" },
  });

  // Send deal selected email — non-blocking
  try {
    const buyerWithEmail = await prisma.buyer.findUnique({
      where: { id: buyer.id },
      include: { user: { select: { email: true } } },
    });
    if (buyerWithEmail?.user?.email) {
      await sendDealSelectedEmail(buyerWithEmail.user.email, buyerWithEmail.firstName, deal.id);
    }
  } catch (e) {
    console.error("[select-offer] deal selected email failed:", e);
  }

  return successResponse({ deal: { id: deal.id } });
}
