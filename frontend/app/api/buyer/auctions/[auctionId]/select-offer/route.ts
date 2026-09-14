import { logger } from "@/lib/logger";
import { NextRequest, after } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { sendDealSelectedEmail } from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { recordMarketplaceFromAuction } from "@/lib/amips/pipelines/marketplace-intelligence.recorder";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { commitOfferSelection, OfferSelectionRaceLostError } from "@/lib/services/deal/select-offer.service";
import { recheckApproval } from "@/lib/services/prequal/approval-recheck";

interface Props { params: Promise<{ auctionId: string }> }

// POST /api/buyer/auctions/[auctionId]/select-offer — select a deal
export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: { offerId?: string; forceEarly?: boolean };
  try {
    body = (await request.json()) as { offerId?: string; forceEarly?: boolean };
  } catch {
    return errorResponse("BAD_REQUEST", "Invalid JSON body", 400);
  }
  const offerId = body?.offerId;
  if (!offerId || typeof offerId !== "string") {
    return errorResponse("VALIDATION_ERROR", "offerId is required", 400);
  }

  const auction = await prisma.auction.findFirst({ where: { id: auctionId, buyerId: buyer.id } });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  // §8.2 Phase 6 defect (4). This route rejected ONLY `CANCELLED`, so a SUBMITTED offer on a
  // `PENDING`, `EXPIRED` or `REOPENED` auction was selectable — a buyer could create a Deal on an
  // auction that had never launched, or on one whose window had lapsed without close processing
  // ever running. §9's entry is "offers ready", which is a CLOSED auction; the one sanctioned
  // exception is the explicit, audited early accept on a still-live ACTIVE auction, handled below.
  //
  // Each refusal names its own state rather than sharing one message: "this auction has expired"
  // and "this auction has not started" send a buyer to different places.
  if (auction.status === "CANCELLED") {
    return errorResponse("AUCTION_CANCELLED", "This auction has been cancelled.", 409);
  }
  if (auction.status === "PENDING") {
    return errorResponse(
      "AUCTION_NOT_STARTED",
      "This auction has not started yet — no offers can be selected until dealers have been invited.",
      409,
    );
  }
  if (auction.status === "EXPIRED") {
    return errorResponse(
      "AUCTION_EXPIRED",
      "This auction expired without closing. Operations will review it and contact you.",
      409,
    );
  }
  if (auction.status === "REOPENED") {
    return errorResponse(
      "AUCTION_REOPENED",
      "This auction has been reopened and is not ready for selection.",
      409,
    );
  }
  if (auction.status !== "CLOSED" && auction.status !== "ACTIVE") {
    // Defensive: a new AuctionStatus label must not become silently selectable. Every state is
    // named above, so reaching here means the enum grew without this gate being revisited.
    return errorResponse("AUCTION_NOT_SELECTABLE", "This auction is not ready for selection.", 409);
  }

  // F-007 — do not let a buyer silently end the 48h auction early. While the
  // auction is still live (ACTIVE + endsAt in the future) competing dealers may
  // still submit or improve offers, so accepting now cuts off the competition
  // that produces the best price. Block unless the buyer makes an explicit,
  // disclosed choice to accept early (forceEarly), which is audit-logged below.
  const acceptingEarly =
    auction.status === "ACTIVE" &&
    !!auction.endsAt &&
    auction.endsAt.getTime() > Date.now();
  if (acceptingEarly && body?.forceEarly !== true) {
    return errorResponse(
      "AUCTION_LIVE",
      "Your 48-hour auction is still live — dealers may still submit or improve their offers. " +
        "Wait for it to close, or choose to accept this offer now and end the auction early.",
      409,
    );
  }

  // Anti-double-deal guard: a buyer may select only one offer per auction. Once
  // any offer is ACCEPTED a deal already exists, so reject further selections —
  // without this, POSTing a different offerId on an already-closed auction would
  // create a SECOND competing deal (Deal.offerId is unique, so only re-selecting
  // the SAME offer was previously blocked).
  const alreadyAccepted = await prisma.offer.findFirst({
    where: { auctionId, status: "ACCEPTED" },
    select: { id: true },
  });
  if (alreadyAccepted) {
    return errorResponse("ALREADY_SELECTED", "You have already selected an offer for this auction.", 409);
  }

  const offer = await prisma.offer.findFirst({
    where: { id: offerId, auctionId, status: "SUBMITTED" },
  });
  if (!offer) return errorResponse("NOT_FOUND", "Offer not found", 404);

  // §8.2 Phase 6 defect (4): "a valid unexpired offer". `offers.expires_at` shipped in the Phase 1
  // wave and had no reader — §8a makes the expiration a REQUIRED field, and §9's failure path is
  // built on it ("Offers carry an expiration. Remind the buyer before offers expire."). Selecting
  // a lapsed offer commits a dealership to a price it withdrew.
  if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
    return errorResponse(
      "OFFER_EXPIRED",
      "This offer has expired. Choose another, or ask us to revalidate it with the dealership.",
      409,
    );
  }

  // §13-D40, ruled: over-ceiling offers are RECORDED and disqualified rather than rejected at
  // submit, so a dealer's arithmetic slip stays recoverable and visible to Operations — but §8c is
  // unambiguous that they are "never presented as qualified", and §22a's ceiling "is enforced
  // server-side at offer validation, AT SELECTION, and at contract request". Excluding a
  // disqualified offer from the ranked report without also refusing it here would leave it
  // selectable by anyone who kept the offer id.
  if (offer.isDisqualified) {
    return errorResponse(
      "OFFER_DISQUALIFIED",
      offer.disqualifiedReason
        ? `This offer cannot be selected: ${offer.disqualifiedReason}`
        : "This offer has been disqualified and cannot be selected.",
      409,
    );
  }

  // STAGE 3 — APPROVAL RECHECK AT OFFER SELECTION.
  //
  // "Approval is rechecked — not merely at the payment gate, but at OFFER
  // SELECTION and again at contract request. An approval that expires
  // mid-transaction pauses the Deal and asks the buyer to renew rather than
  // silently proceeding on a stale ceiling."
  //
  // This route had zero prequal references. A buyer whose approval expired between
  // paying the $99 and choosing an offer could accept one above a ceiling that no
  // longer applied, and the first anyone would know is at contract review — with a
  // Deal created and a dealership already committed. Refusing here costs the buyer
  // a renewal; not refusing costs a dealer a reaffirmation.
  const approval = await recheckApproval(buyer.id, "offer_selection", {
    raiseOnFailure: true,
    vehicleRequestId: auction.vehicleRequestId ?? null,
  });
  if (!approval.ok) {
    return errorResponse("APPROVAL_REQUIRED", approval.message, 409);
  }

  // Commit the selection atomically. The concurrency invariant (Phase 1 E-1) —
  // at most one accepted offer / one Deal per auction — is enforced inside
  // commitOfferSelection by locking the auction row and re-checking under the
  // lock, so two genuinely concurrent selections of different offers cannot both
  // create a Deal. The loser is rejected with the same 409 as the sequential
  // pre-check above.
  let dealId: string;
  try {
    ({ dealId } = await commitOfferSelection({ buyerId: buyer.id, auctionId, offerId: offer.id }));
    // The early-accept marker problem is now handled INSIDE the transaction: commitOfferSelection
    // stamps `postCloseProcessedAt`, so the close reconciler can no longer claim this auction and
    // tell a buyer who has just selected that their offers are ready.
  } catch (e) {
    if (e instanceof OfferSelectionRaceLostError) {
      return errorResponse("ALREADY_SELECTED", "You have already selected an offer for this auction.", 409);
    }
    throw e;
  }
  const deal = { id: dealId };

  // F-007 — audit the explicit early-accept (buyer ended the auction before its
  // endsAt). Non-blocking; the selection has already committed.
  if (acceptingEarly) {
    await prisma.auditLog.create({
      data: {
        action: "AUCTION_CLOSED",
        entityType: "auction",
        entityId: auctionId,
        reason: "Buyer accepted an offer before the 48h auction window ended (forceEarly).",
        metadata: { buyerId: buyer.id, offerId: offer.id, dealId: deal.id, earlyAccept: true },
      },
    }).catch((e) => logger.error("[select-offer] early-accept audit log failed:", e));
  }

  await prisma.notification.create({
    data: { buyerId: buyer.id, title: "Deal created!", body: "You selected your best deal. Continue to financing.", type: "DEAL_SELECTED" },
  });

  // Send deal selected email — non-blocking
  const buyerWithEmail = await prisma.buyer.findUnique({
    where: { id: buyer.id },
    include: { user: { select: { email: true } } },
  }).catch(() => null);
  try {
    if (buyerWithEmail?.user?.email) {
      await sendDealSelectedEmail(buyerWithEmail.user.email, buyerWithEmail.firstName, deal.id);
    }
  } catch (e) {
    logger.error("[select-offer] deal selected email failed:", e);
  }
  syncGhlTag(buyerWithEmail?.user?.email, "offer-selected");

  // G1 — dealer award/non-award notifications are dispatched by the internal
  // dealer-award-dispatch cron off the durable Deal marker (dealerAwardDispatchedAt
  // starts NULL on this newly-created deal). No event/emit is needed here: the deal
  // row IS the durable signal, so dispatch survives this request context ending —
  // the exact durability the retired Inngest worker provided. The cron runs the
  // planner, writes in-app Notification rows, and enqueues each email onto the
  // comms outbox (idempotent), then stamps the marker so it dispatches once.

  // CRM event spine — emit offer_selected for the buyer after the deal has
  // formed. Additive tail call: a failure never affects the selection, which
  // has already committed.
  try {
    if (buyerWithEmail) {
      const { emitDomainEvent } = await import("@/lib/events/emit");
      await emitDomainEvent("offer_selected", {
        domainEntityId: deal.id,
        contact: {
          email: buyerWithEmail.user?.email ?? null,
          phone: buyerWithEmail.phone,
          firstName: buyerWithEmail.firstName,
          lastName: buyerWithEmail.lastName,
          source: "buyer_signup",
        },
        data: {
          deal_id: deal.id,
          offer_id: offer.id,
          auction_id: auctionId,
          buyer_id: buyer.id,
        },
      });
    }
  } catch (err) {
    logger.error("[select-offer] offer_selected emit failed:", err);
  }

  // AMIPS Phase 4 — record this completed transaction into Marketplace
  // Intelligence. Non-blocking via after() so it never affects the deal flow;
  // the recorder swallows its own errors and skips untracked metros/vehicles.
  after(() => recordMarketplaceFromAuction(auctionId));

  // Social revenue-attribution closure — if this buyer arrived via a social
  // post, promote that post's attribution chain to DEAL_WON. This route has no
  // vehicleRequestId in scope, so resolve the buyer's most recent request and
  // pass its id. Non-blocking via after(); fully self-contained on failure.
  after(async () => {
    try {
      const vehicleRequest = await prisma.vehicleRequest.findFirst({
        where: { buyerId: buyer.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!vehicleRequest) return;
      const { captureDealAttribution } = await import(
        "@/lib/social/attribution.service"
      );
      await captureDealAttribution({
        dealId: deal.id,
        vehicleRequestId: vehicleRequest.id,
        depositAmountCents: DEPOSIT_AMOUNT_CENTS,
        totalRevenueCents: DEPOSIT_AMOUNT_CENTS, // $99 Auction Access Deposit
      });
    } catch (err) {
      logger.error("[select-offer] attribution failed:", err);
    }
  });

  return successResponse({ deal: { id: deal.id } });
}
