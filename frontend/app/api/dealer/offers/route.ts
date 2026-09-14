import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { submitOffer, DEALER_OFFER_SELECT, OfferRefusedError } from "@/lib/services/offer/offer.service";
import { z } from "zod";
import { feeItemsSchema } from "@/lib/services/offer/junk-fee-items";
import { sendDealerOfferSubmittedEmail } from "@/lib/services/email/resend.service";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";

const schema = z.object({
  auctionId: z.string(), otdPriceCents: z.number().int().min(100),
  vehiclePriceCents: z.number().int().min(100), taxCents: z.number().int().min(0),
  feesCents: z.number().int().min(0), includesFinancing: z.boolean().optional(),
  aprRate: z.number().optional(), termMonths: z.number().int().optional(),
  // One schema for all three accepted shapes — see lib/services/offer/junk-fee-items.ts.
  junkFeeItems: feeItemsSchema.optional(),

  // ── §8c CANDIDATE BINDING — WITHOUT THIS FIELD THE DEALER PATH IS DEAD ────────────────────
  //
  // `submitOffer` refuses an offer that names no candidate whenever the auction HAS candidates
  // ("This auction has specific vehicles — your offer must name the one it answers"), which is
  // every sourced auction. This schema stripped the field, so the service threw on every such
  // submission and a dealer could not bid at all. Found by review; the binding requirement landed
  // one commit before this field did.
  //
  // Optional, because a CUSTOM REQUEST has no candidates and §8c binds those offers to the
  // criteria set instead (parity row C3b). The service decides which case applies; the schema
  // only has to stop discarding the answer.
  auctionVehicleId: z.string().optional(),

  // A2b — the vehicle snapshot. Every field optional and prefilled from the bound candidate's
  // listing by the service; a dealership states one only where it differs from what AutoLenis
  // already holds (a different trim, an odometer the feed has not caught up with, their own stock
  // number). Accepting them is what makes "what the submitter states always wins" reachable from
  // the dealer form rather than from staff intake alone.
  vin: z.string().optional(),
  stockNumber: z.string().optional(),
  vehicleYear: z.number().int().optional(),
  vehicleMake: z.string().optional(),
  vehicleModel: z.string().optional(),
  vehicleTrim: z.string().optional(),
  odometer: z.number().int().min(0).optional(),
  vehicleCondition: z.string().optional(),
  exteriorColor: z.string().optional(),
  interiorColor: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const { prisma } = await import("@/lib/prisma");

  // Auction offers (System A).
  //
  // PROJECTED, NEVER `include`d — §29 P3. See `DEALER_OFFER_SELECT` for what this phase started
  // writing onto these rows (ranking positions and a disqualification reason carrying the buyer's
  // approved ceiling) and why an unprojected read now leaks it.
  const offers = await prisma.offer.findMany({
    where:   { dealerId: dealer.id },
    select:  DEALER_OFFER_SELECT,
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

    // Re-read through the dealer projection rather than returning the service's row. `submitOffer`
    // returns every column — including the ranking fields and the §13-D40 disqualification reason
    // that carries the buyer's approved ceiling. One projection, used by every dealer-facing
    // reader, is what stops the three routes drifting apart (§29 P3).
    const offerForDealer = await prisma.offer.findUnique({
      where: { id: offer.id },
      select: DEALER_OFFER_SELECT,
    });
    return successResponse({ offer: offerForDealer }, 201);
  } catch (err) {
    // A REFUSAL THE SERVICE MARKED AS DEALER-READABLE is passed through verbatim; anything else is
    // an internal failure and stays generic. The four-substring map this replaces matched none of
    // the refusals this phase added — candidate binding, the §8b caps, the OTD breakdown — so a
    // dealer whose offer was refused for any of them was told only "please try again", with
    // nothing to act on. See `OfferRefusedError`.
    const safeMsg = err instanceof OfferRefusedError
      ? err.message
      : "Failed to submit offer. Please try again.";
    if (!(err instanceof OfferRefusedError)) {
      logger.error("[dealer/offers] submission failed:", err);
    }
    return errorResponse("OFFER_ERROR", safeMsg, 400);
  }
}
