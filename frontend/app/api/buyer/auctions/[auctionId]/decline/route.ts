// POST /api/buyer/auctions/[auctionId]/decline
// Buyer declines all offers. NO refund is initiated here: the $99 deposit is
// never refunded automatically. A refund must be (1) manually requested by the
// buyer and (2) manually processed by an admin. This endpoint records the
// buyer's refund request and raises an admin alert; it never moves money.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ auctionId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { reason } = await request.json() as { reason?: string };

  const auction = await prisma.auction.findFirst({
    where:   { id: auctionId, buyerId: buyer.id },
    include: { deposit: true },
  });

  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);
  if (auction.status === "CLOSED" || auction.status === "CANCELLED") {
    return errorResponse("ALREADY_CLOSED", "Auction is already closed", 409);
  }

  // Close auction
  await prisma.auction.update({
    where: { id: auctionId },
    data:  { status: "CLOSED", closedAt: new Date() },
  });

  // Decline all pending offers
  await prisma.offer.updateMany({
    where: { auctionId, status: "SUBMITTED" },
    data:  { status: "DECLINED" },
  });

  // NO automatic refund. Record the buyer's refund request and raise an admin
  // alert so it can be reviewed and processed manually. The deposit stays
  // charged (PAID) until an admin deliberately issues a refund.
  const refundRequested = auction.deposit?.id != null && auction.deposit.status === "PAID";
  if (refundRequested) {
    await prisma.notification.create({
      data: {
        type:  "SYSTEM_ALERT",
        title: `Refund requested — Auction ${auctionId.slice(0, 8)}`,
        body:
          `Buyer ${buyer.id} declined all offers and requested a deposit refund. ` +
          `Reason: ${reason ?? "Buyer declined all offers"}. ` +
          `Review and process manually via Admin → Payments if approved.`,
      },
    }).catch((err: unknown) => logger.error("[decline-auction] admin alert failed:", err));
  }

  // Notify buyer — make clear the refund is a manual, reviewed request, not
  // an automatic payout.
  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type:    "DEAL_STAGE_CHANGED",
      title:   "Auction closed",
      body:    refundRequested
        ? "You passed on this auction. Your refund request has been submitted and will be reviewed by our team."
        : "You passed on this auction.",
    },
  }).catch((err: unknown) => logger.error("[decline-auction] notification failed:", err));

  return successResponse({ auctionClosed: true, refundRequested });
}
