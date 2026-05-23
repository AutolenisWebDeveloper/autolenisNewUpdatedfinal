import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { reviseOffer } from "@/lib/services/offer/offer.service";
import { sendDealerOfferSubmittedEmail } from "@/lib/services/email/resend.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ offerId: string }> }

// Accept the same shape the bid form posts so a revision can update any
// component of the OTD breakdown. Server-side validators in reviseOffer
// re-verify arithmetic, budget, and financing consistency.
const schema = z.object({
  otdPriceCents: z.number().int().min(100).optional(),
  vehiclePriceCents: z.number().int().min(100).optional(),
  taxCents: z.number().int().min(0).optional(),
  feesCents: z.number().int().min(0).optional(),
  includesFinancing: z.boolean().optional(),
  aprRate: z.number().optional(),
  termMonths: z.number().int().optional(),
  junkFeeItems: z
    .array(z.object({ name: z.string(), amount: z.number() }))
    .optional(),
});

export async function PATCH(request: NextRequest, { params }: Props) {
  const { offerId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  let revised;
  try {
    revised = await reviseOffer(offerId, dealer.id, parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to revise offer.";
    const safeMsg =
      msg.includes("Max revisions") ? "You've reached the maximum number of revisions for this offer."
      : msg.includes("expired") ? "Auction has expired — revisions are no longer accepted."
      : msg.includes("closed") ? "This auction is no longer active."
      : msg.includes("budget") ? msg
      : msg.includes("breakdown") ? msg
      : "Failed to revise offer. Please try again.";
    return errorResponse("REVISION_ERROR", safeMsg, 400);
  }

  // Bid-revised confirmation email (non-blocking). Reuses the
  // "offer submitted" template which is keyed by offerId so the new
  // revision's id makes this send unique and idempotent.
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
      vehicleRef: `Auction ${revised.auctionId.slice(0, 8)} (revised)`,
      otdPriceCents: revised.otdPriceCents,
      submittedAt: submittedAt.toISOString(),
      revisionWindowExpiry: revisionWindowExpiry.toISOString(),
      offerId: revised.id,
    }).catch((err) => console.error("[dealer/offers/revise] email failed:", err));
  }

  return successResponse({ offer: revised });
}
