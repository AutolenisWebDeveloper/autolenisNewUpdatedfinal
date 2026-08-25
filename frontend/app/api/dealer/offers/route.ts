import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { submitOffer } from "@/lib/services/offer/offer.service";
import { z } from "zod";
import { sendDealerOfferSubmittedEmail } from "@/lib/services/email/resend.service";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";

const schema = z.object({
  auctionId: z.string(), otdPriceCents: z.number().int().min(100),
  vehiclePriceCents: z.number().int().min(100), taxCents: z.number().int().min(0),
  feesCents: z.number().int().min(0), includesFinancing: z.boolean().optional(),
  aprRate: z.number().optional(), termMonths: z.number().int().optional(),
  junkFeeItems: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
});

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const { prisma } = await import("@/lib/prisma");

  // Auction offers (System A)
  const offers = await prisma.offer.findMany({
    where:   { dealerId: dealer.id },
    include: { auction: true },
    orderBy: { createdAt: "desc" },
  });

  // Concierge submissions (System B) — linked by dealerId
  const conciergeSubmissions = await prisma.dealerOfferSubmission.findMany({
    where:   { dealerId: dealer.id },
    include: { vehicleOffer: true },
    orderBy: { submittedAt: "desc" },
  });

  return successResponse({ offers, conciergeSubmissions });
}

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);

  try {
    const offer = await submitOffer({ ...parsed.data, dealerId: dealer.id });

    // Confirm submission to the dealer — non-blocking.
    const { prisma } = await import("@/lib/prisma");
    const dealerWithEmail = await prisma.dealer.findUnique({
      where: { id: dealer.id },
      include: { user: { select: { email: true } } },
    });
    const dealerEmail = dealerWithEmail?.user?.email;
    if (dealerEmail) {
      const submittedAt = new Date();
      const revisionWindowExpiry = new Date(submittedAt.getTime() + 30 * 60_000);
      await sendDealerOfferSubmittedEmail({
        to: dealerEmail,
        contactName: dealerWithEmail.dealershipName,
        vehicleRef: `Auction ${parsed.data.auctionId.slice(0, 8)}`,
        otdPriceCents: parsed.data.otdPriceCents,
        submittedAt: submittedAt.toISOString(),
        revisionWindowExpiry: revisionWindowExpiry.toISOString(),
        offerId: offer.id,
      }).catch(err => logger.error("[dealer/offers] submission email failed:", err));
    }

    // QStash — notify the buyer that a dealer offer arrived (+ follow-up).
    const auctionBuyer = await prisma.auction.findUnique({
      where: { id: parsed.data.auctionId },
      select: {
        buyerId: true,
        buyer: { select: { firstName: true, user: { select: { email: true } } } },
      },
    });
    const buyerOfferEmail = auctionBuyer?.buyer?.user?.email;
    if (auctionBuyer?.buyerId && buyerOfferEmail) {
      scheduleLifecycleWorkload({
        workload: "offer_received",
        buyerId: auctionBuyer.buyerId,
        auctionId: parsed.data.auctionId,
        offerId: offer.id,
        firstName: auctionBuyer.buyer?.firstName ?? "there",
        email: buyerOfferEmail,
      }).catch(() => {});
    }

    return successResponse({ offer }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to submit offer.";
    const safeMsg = msg.includes("not invited") ? "You are not invited to this auction."
      : msg.includes("already submitted") ? "You have already submitted an offer for this auction."
      : msg.includes("not active") ? "This auction is no longer active."
      : msg.includes("expired") ? "This auction has expired."
      : "Failed to submit offer. Please try again.";
    return errorResponse("OFFER_ERROR", safeMsg, 400);
  }
}
