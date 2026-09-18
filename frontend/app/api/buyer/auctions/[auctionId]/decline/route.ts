// POST /api/buyer/auctions/[auctionId]/decline
// Buyer declines all offers. NO refund is initiated here: the $99 deposit is
// never refunded automatically. A refund must be (1) manually requested by the
// buyer and (2) manually processed by an admin. This endpoint records the
// buyer's refund request and raises an admin alert; it never moves money.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { closeAuction } from "@/lib/services/auction/auction.service";

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
  // EXPIRED IS NAMED SEPARATELY, and the reason is a consequence of the guard below.
  //
  // Before that guard this route force-closed an EXPIRED auction: the check above does not
  // mention EXPIRED, and the write named only the id. `closeAuction` refuses it — EXPIRED is in
  // `TERMINAL_AUCTION_STATUSES`, and overwriting it with CLOSED would erase the fact that the
  // window lapsed without close processing ever running, which is Operations' signal and not an
  // ordinary end-of-auction. Refusing is right.
  //
  // What would be wrong is refusing with "already closed". The sibling route states the
  // convention in its own words — *"Each refusal names its own state rather than sharing one
  // message: 'this auction has expired' and 'this auction has not started' send a buyer to
  // different places"* (`select-offer/route.ts:40-42`) — and uses this exact copy for this exact
  // state. A buyer told an expired auction is "already closed" goes looking for offers that were
  // never processed.
  if (auction.status === "EXPIRED") {
    return errorResponse(
      "AUCTION_EXPIRED",
      "This auction expired without closing. Operations will review it and contact you.",
      409,
    );
  }

  // ── §28.3 #3 — THE FOURTH INSTANCE OF THE UNCONDITIONAL-WRITE DEFECT ──────────
  //
  // This was `prisma.auction.update({ where: { id } })`: a CHECK-THEN-ACT. The read
  // above rejects a CLOSED or CANCELLED auction with 409, and then the write names
  // only the id — so a status that changed in between is silently overwritten by a
  // decision taken against a status nobody observed.
  //
  // WHAT THAT COSTS, concretely. §24's cancellation orchestration writes
  // `status: "CANCELLED"` (`cancellation.service.ts`, the AUCTION stop). A buyer
  // declining while an administrator cancels the transaction — an ordinary
  // collision, not a contrived one — rewrites that deliberate cancellation as an
  // ordinary end-of-auction. The dealership's history then says the auction ran its
  // course; nothing says AutoLenis withdrew it. That is the exact vocabulary
  // collapse the CANCELLED label added by this phase's first migration exists to
  // prevent, undone by a write one file away from the orchestration that records it.
  //
  // `closeAuction` is that conditional write, and it had NO CALLERS — reported at
  // STOP 2 and ruled here. Routing through it rather than copying its predicate is
  // the point: §29's exactly-once close is a property of there being ONE
  // implementation, and a fourth open-coded close is how that erodes. It guards on
  // `status IN (PENDING, ACTIVE)` and returns whether THIS call closed it, so a
  // caller cannot report a close a concurrent writer performed.
  //
  // A lost race is the SAME 409 the read-side check returns, deliberately: from the
  // buyer's side "someone else ended this auction first" is one outcome, and the two
  // paths differ only in when it was detected.
  const closed = await closeAuction(auctionId);
  if (!closed) {
    return errorResponse("ALREADY_CLOSED", "Auction is already closed", 409);
  }

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
