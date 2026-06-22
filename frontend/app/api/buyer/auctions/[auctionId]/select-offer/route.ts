import { logger } from "@/lib/logger";
import { NextRequest, after } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import {
  sendDealSelectedEmail,
  sendDealerOfferWonEmail,
  sendDealerOfferLostEmail,
} from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { recordMarketplaceFromAuction } from "@/lib/amips/pipelines/marketplace-intelligence.recorder";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

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
  if (auction.status === "CANCELLED") {
    return errorResponse("AUCTION_CANCELLED", "This auction has been cancelled.", 409);
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

  // Commit the selection atomically: a deal can never exist without the chosen
  // offer being ACCEPTED and the auction CLOSED.
  const deal = await prisma.$transaction(async (tx) => {
    const created = await tx.deal.create({
      data: { buyerId: buyer.id, offerId: offer.id, status: "FINANCING_PENDING" },
    });
    await tx.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
    await tx.auction.update({ where: { id: auctionId }, data: { status: "CLOSED", closedAt: new Date() } });
    return created;
  });

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

  // Notify every dealer that submitted an offer — winner vs lost — non-blocking.
  const allOffers = await prisma.offer.findMany({
    where: { auctionId },
    include: { dealer: { include: { user: { select: { email: true } } } } },
  }).catch(() => []);
  const vehicleRef = `Auction ${auctionId.slice(0, 8)}`;
  const buyerFirstName = buyerWithEmail?.firstName ?? "Buyer";
  const buyerLastInitial = (buyerWithEmail?.lastName ?? "").charAt(0) || "";
  const totalOffers = allOffers.length;
  // Position assigned by rank in submitted offers (1 = lowest OTD).
  const sortedByOtd = [...allOffers].sort((a, b) => a.otdPriceCents - b.otdPriceCents);
  for (let i = 0; i < sortedByOtd.length; i++) {
    const offerRow = sortedByOtd[i];
    // Outside / unregistered dealer offers share the system placeholder Dealer,
    // so prefer the real external contact captured on the offer itself.
    const dealerEmail = offerRow.externalDealerEmail ?? offerRow.dealer?.user?.email;
    if (!dealerEmail) continue;
    const dealershipName = offerRow.externalDealerName ?? offerRow.dealer?.dealershipName ?? "Dealer";
    if (offerRow.id === offer.id) {
      await sendDealerOfferWonEmail({
        to: dealerEmail,
        contactName: dealershipName,
        vehicleRef,
        buyerFirstName,
        buyerLastInitial,
        dealUrl: `${APP_URL}/dealer/deals/${deal.id}`,
        dealId: deal.id,
      }).catch(err => logger.error("[select-offer] dealer won email failed:", err));
      syncGhlTag(dealerEmail, "dealer-won");
    } else {
      await sendDealerOfferLostEmail({
        to: dealerEmail,
        contactName: dealershipName,
        vehicleRef,
        yourPosition: i + 1,
        totalOffers,
        insightsUrl: `${APP_URL}/dealer/opportunities`,
        auctionId,
      }).catch(err => logger.error("[select-offer] dealer lost email failed:", err));
    }
  }

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
