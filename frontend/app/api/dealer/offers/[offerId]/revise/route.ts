import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { reviseOffer, DEALER_OFFER_SELECT, OfferRefusedError } from "@/lib/services/offer/offer.service";
import { sendDealerOfferSubmittedEmail } from "@/lib/services/email/resend.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { feeItemsSchema } from "@/lib/services/offer/junk-fee-items";

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
  // One schema for all three accepted shapes — see lib/services/offer/junk-fee-items.ts.
  junkFeeItems: feeItemsSchema.optional(),
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
    // Same rule as the submit route: the service marks what a dealership may read. The
    // `msg.includes("budget")` arm this replaces was already unreachable — §13-D40 made the budget
    // verdict a RECORD rather than a throw — and `includes("expired")` also matched
    // "Offer was modified concurrently"'s neighbours by accident.
    const safeMsg = err instanceof OfferRefusedError
      ? err.message
      : "Failed to revise offer. Please try again.";
    if (!(err instanceof OfferRefusedError)) {
      logger.error("[dealer/offers/revise] revision failed:", err);
    }
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
    }).catch((err) => logger.error("[dealer/offers/revise] email failed:", err));
  }

  // Projected, for the reason `DEALER_OFFER_SELECT` records: `reviseOffer` returns the whole row,
  // and this phase started writing ranking positions and a §13-D40 disqualification reason onto it
  // — the latter carrying the buyer's approved ceiling as a dollar figure (§29 P3).
  const offerForDealer = await prisma.offer.findUnique({
    where: { id: revised.id },
    select: DEALER_OFFER_SELECT,
  });
  return successResponse({ offer: offerForDealer });
}
