import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";
import { sendDealSelectedEmail } from "@/lib/services/email/resend.service";
import { convertConciergeOfferToDeal } from "@/lib/services/offer/concierge-offer.service";

interface Props { params: Promise<{ requestId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Support both formData (existing form) and JSON (client fetch)
  const contentType = request.headers.get("content-type") ?? "";
  let response: string;
  let offerId: string;

  if (contentType.includes("application/json")) {
    const body = await request.json() as { response: string; offerId: string };
    response = body.response;
    offerId  = body.offerId;
  } else {
    const fd = await request.formData();
    response = fd.get("response") as string;
    offerId  = fd.get("offerId") as string;
  }

  if (!["ACCEPT", "DECLINE"].includes(response)) {
    return errorResponse("VALIDATION_ERROR", "Response must be ACCEPT or DECLINE", 400);
  }

  const vehicleRequest = await prisma.vehicleRequest.findFirst({
    where:   { id: requestId, buyerId: buyer.id },
    include: { offers: { where: { id: offerId, status: "SENT" } } },
  });
  if (!vehicleRequest || vehicleRequest.offers.length === 0) {
    return errorResponse("NOT_FOUND", "Request or offer not found", 404);
  }

  const acceptedOffer = vehicleRequest.offers[0]!;
  const newRequestStatus = response === "ACCEPT"
    ? VehicleRequestStatus.OFFER_ACCEPTED
    : VehicleRequestStatus.OFFER_DECLINED;

  // Core transaction: mark offer + request status
  await prisma.$transaction([
    prisma.vehicleRequest.update({
      where: { id: requestId },
      data:  { status: newRequestStatus },
    }),
    prisma.vehicleRequestOffer.update({
      where: { id: offerId },
      data:  {
        status:      response === "ACCEPT" ? "ACCEPTED" : "DECLINED",
        respondedAt: new Date(),
      },
    }),
    prisma.vehicleRequestEvent.create({
      data: {
        requestId,
        eventType: `OFFER_${response}ED`,
        actorId:   buyer.id,
        actorRole: "BUYER",
        payload:   { offerId, response },
      },
    }),
  ]);

  // DECLINE: return immediately
  if (response === "DECLINE") {
    return successResponse({
      status:   newRequestStatus,
      message:  "Offer declined. You may continue browsing or request another vehicle.",
      redirect: null,
    });
  }

  // ACCEPT: converge onto the ONE canonical spine (Deal.offerId) via the
  // concierge adapter — a deposit-optional Auction + a canonical Offer. This
  // replaces the legacy Deal.vehicleRequestOfferId write path (Batch 4). Idempotent
  // by sourceRef, so a double-submit returns the same Deal.
  let deal: { id: string };
  try {
    const conv = await convertConciergeOfferToDeal({
      buyerId: buyer.id,
      sourceRef: `vehicle_request_offer:${offerId}`,
      vehicleRequestId: requestId,
      dealerId: null, // System C carries no dealer identity → outside placeholder
      otdPriceCents: acceptedOffer.priceCents,
      vehicleSummary: acceptedOffer.vehicleInfo ? JSON.stringify(acceptedOffer.vehicleInfo) : null,
    });
    deal = { id: conv.dealId };
  } catch (err) {
    logger.error("[offer/respond] concierge conversion failed:", err);
    // Degrade gracefully and truthfully: buyer still sees OFFER_ACCEPTED.
    return successResponse({
      status:  newRequestStatus,
      message: "Offer accepted. Our team will finalize your deal shortly.",
      redirect: null,
    });
  }

  // A canonical Deal now exists → reflect it on the request lifecycle.
  await prisma.vehicleRequest
    .update({ where: { id: requestId }, data: { status: VehicleRequestStatus.DEAL_CREATED } })
    .catch(() => {});

  // In-app notification with actionUrl
  await prisma.notification.create({
    data: {
      buyerId:   buyer.id,
      type:      "DEAL_STAGE_CHANGED",
      channel:   "IN_APP",
      title:     "Your deal is ready",
      body:      "You accepted an offer. Continue to financing to move your deal forward.",
      actionUrl: "/buyer/deal",
    },
  }).catch(() => {});

  // Deal selected email — non-blocking
  const buyerWithEmail = await prisma.buyer.findUnique({
    where:   { id: buyer.id },
    include: { user: { select: { email: true } } },
  }).catch(() => null);

  if (buyerWithEmail?.user?.email) {
    sendDealSelectedEmail(
      buyerWithEmail.user.email,
      buyerWithEmail.firstName,
      deal.id
    ).catch(err =>
      logger.error("[offer/respond] deal selected email failed:", err)
    );
  }

  // Audit log
  await prisma.adminAuditLog.create({
    data: {
      adminId:    "SYSTEM",
      adminEmail: "system@autolenis.com",
      action:     "DEAL_CREATED_FROM_VEHICLE_REQUEST_OFFER",
      entityType: "Deal",
      entityId:   deal.id,
      reason:     "Buyer accepted VehicleRequest offer — deal auto-created",
      metadata: {
        vehicleRequestId:      requestId,
        vehicleRequestOfferId: offerId,
        dealId:                deal.id,
        buyerId:               buyer.id,
        priceCents:            acceptedOffer.priceCents,
      },
    },
  }).catch(() => {});

  return successResponse({
    status:   newRequestStatus,
    message:  "Your deal is ready. Continue with financing.",
    redirect: "/buyer/deal",
    dealId:   deal.id,
  });
}
