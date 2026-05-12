import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { submitOffer } from "@/lib/services/offer/offer.service";
import { sendDealerOfferSubmittedEmail } from "@/lib/services/email/resend.service";
import { z } from "zod";

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
  const offers = await prisma.offer.findMany({ where: { dealerId: dealer.id }, include: { auction: true }, orderBy: { createdAt: "desc" } });
  return successResponse({ offers });
}

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);

  try {
    const offer = await submitOffer({ ...parsed.data, dealerId: dealer.id });

    if (dealer.user?.email) {
      const submittedAt = (offer as { submittedAt?: Date | null }).submittedAt ?? new Date();
      const offerId = (offer as { id: string }).id;
      const revisionWindowExpiry = new Date(Date.now() + 30 * 60 * 1000).toLocaleString("en-US");
      await sendDealerOfferSubmittedEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        vehicleRef: `Auction ${parsed.data.auctionId.slice(0, 8)}`,
        otdPriceCents: parsed.data.otdPriceCents,
        submittedAt: submittedAt instanceof Date ? submittedAt.toLocaleString("en-US") : String(submittedAt),
        revisionWindowExpiry,
        offerId,
      }).catch((err) => console.error("[dealer/offers] submitted email failed:", err));
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
