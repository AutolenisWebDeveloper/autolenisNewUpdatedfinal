// POST /api/buyer/auctions/[auctionId]/decline
// Buyer declines all offers and requests deposit refund.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { refundDeposit } from "@/lib/services/deposit/deposit.service";

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

  // Initiate deposit refund if applicable
  let refundInitiated = false;
  if (auction.deposit?.id && auction.deposit.status === "PAID") {
    try {
      await refundDeposit(auction.deposit.id, reason ?? "Buyer declined all offers");
      refundInitiated = true;
    } catch (err) {
      logger.error("[decline-auction] refund failed:", err);
      // Non-fatal — admin can process manually
    }
  }

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type:    "DEAL_STAGE_CHANGED",
      title:   "Auction closed",
      body:    refundInitiated
        ? "You passed on this auction. Your $99 deposit refund has been initiated and will appear within 3–5 business days."
        : "You passed on this auction. Our team will process your refund within 1 business day.",
    },
  }).catch((err: unknown) => logger.error("[decline-auction] notification failed:", err));

  return successResponse({ auctionClosed: true, refundInitiated });
}
