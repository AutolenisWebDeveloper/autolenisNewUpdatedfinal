import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DealStatus, VehicleRequestStatus } from "@prisma/client";
import { recheckApproval } from "@/lib/services/prequal/approval-recheck";
import { writeDealCreationRecord } from "@/lib/services/deal/deal-creation";
import { sendDealSelectedEmail } from "@/lib/services/email/resend.service";

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

  // ── PHASE 6 (§10.7 row L4a): this path minted a Deal "without lock/prequal/dealer" ─────────
  //
  // §8.2 Phase 6 defect (3) says "selection exists only on the buyer route", which reads as if
  // there were one. There are TWO, and this is the second: a buyer accepting a staff-entered
  // `VehicleRequestOffer` created a Deal at FINANCING_PENDING with no approval recheck, no
  // serialization, and no lineage beyond the offer id. §8b's "approval is rechecked ... on
  // selection" does not distinguish between the two ways a buyer can select.
  //
  // The ceiling check comes FIRST, before anything is written: an approval that lapsed between
  // the offer being sent and the buyer accepting it is exactly the case §26's "approval expires
  // mid-transaction" row exists for, and discovering it after the acceptance has committed costs
  // a reversal instead of a renewal.
  if (response === "ACCEPT") {
    const approval = await recheckApproval(buyer.id, "offer_selection", {
      raiseOnFailure: true,
      vehicleRequestId: requestId,
    });
    if (!approval.ok) {
      return errorResponse("APPROVAL_REQUIRED", approval.message, 409);
    }

    // The serialization this path never had. There is no auction row to lock, so the guard is the
    // invariant itself: one Deal per Vehicle Request. `vehicleRequestOfferId` is @unique, which
    // already blocked re-accepting the SAME offer — it did nothing about accepting a DIFFERENT
    // offer on the same request, which is the case that produced two competing Deals.
    const existingDeal = await prisma.deal.findFirst({
      where: {
        OR: [
          { vehicleRequestId: requestId },
          { vehicleRequestOffer: { requestId } },
        ],
      },
      select: { id: true },
    });
    if (existingDeal) {
      return errorResponse(
        "ALREADY_SELECTED",
        "You have already accepted an offer for this request.",
        409,
      );
    }
  }

  const newRequestStatus = response === "ACCEPT"
    ? VehicleRequestStatus.OFFER_ACCEPTED
    : VehicleRequestStatus.OFFER_DECLINED;

  // Core transaction: mark offer + request status, and — on ACCEPT — create the
  // Deal in the SAME transaction.
  //
  // The Deal used to be created after this transaction committed, with only a
  // catch() that logged and returned a friendly message. So a failure there left
  // the request OFFER_ACCEPTED and the offer ACCEPTED with no Deal and no
  // compensating rollback: the buyer had accepted an offer that existed nowhere in
  // the deal spine, nothing downstream could pick it up, and the only admin
  // affordance for that state does not actually create a Deal. Accepting an offer
  // and creating its Deal are one atomic fact — either both happen or neither does.
  const createdDeal = await prisma.$transaction(async (tx) => {
    await tx.vehicleRequest.update({
      where: { id: requestId },
      data:  { status: newRequestStatus },
    });
    await tx.vehicleRequestOffer.update({
      where: { id: offerId },
      data:  {
        status:      response === "ACCEPT" ? "ACCEPTED" : "DECLINED",
        respondedAt: new Date(),
      },
    });
    await tx.vehicleRequestEvent.create({
      data: {
        requestId,
        eventType: `OFFER_${response}ED`,
        actorId:   buyer.id,
        actorRole: "BUYER",
        payload:   { offerId, response },
      },
    });
    if (response !== "ACCEPT") return null;
    // offerId is nullable on Deal; concierge deals carry vehicleRequestOfferId.
    // Same entry status as the auction path (select-offer.service) — §13-D41 moved BOTH to
    // DEALER_CONFIRMATION, because a Deal created straight into financing asserts a dealership
    // confirmation that has not happened on either path.
    //
    // The lineage this path can carry is thinner than the auction path's and is stated rather than
    // faked: `VehicleRequestOffer` has no dealer, rooftop, VIN or auction — it is a staff-entered
    // price with a `vehicleInfo` blob (`prisma/schema.prisma`, model VehicleRequestOffer). What it
    // DOES have is the request, the out-the-door amount and the buyer, so those are written and the
    // rest stay null rather than being invented. Row L4b retires this model into the canonical
    // spine at Phase 10, which is where the missing lineage arrives.
    const buyerRow = await tx.buyer.findUnique({
      where: { id: buyer.id },
      select: { plan: true },
    });
    const coBuyer = await tx.coBuyer.findFirst({
      where: { vehicleRequestId: requestId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const created = await tx.deal.create({
      data: {
        buyerId:               buyer.id,
        vehicleRequestOfferId: offerId,
        status:                DealStatus.DEALER_CONFIRMATION,
        vehicleRequestId:      requestId,
        otdCentsConfirmed:     acceptedOffer.priceCents,
        coBuyerId:             coBuyer?.id ?? null,
      },
      select: { id: true },
    });
    await writeDealCreationRecord(tx, {
      dealId: created.id,
      buyerId: buyer.id,
      plan: buyerRow?.plan ?? "STANDARD",
      vehicleRequestId: requestId,
      reason: "Buyer accepted a Vehicle Request offer (§9).",
    });
    return created;
  });

  // DECLINE: return immediately
  if (response === "DECLINE") {
    return successResponse({
      status:   newRequestStatus,
      message:  "Offer declined. You may continue browsing or request another vehicle.",
      redirect: null,
    });
  }

  // ACCEPT: the Deal was created atomically with the acceptance above.
  //
  // Idempotency: a replayed accept finds the existing deal rather than creating a
  // second one (vehicleRequestOfferId is @unique, so a duplicate would throw).
  const deal =
    createdDeal ??
    (await prisma.deal.findUnique({
      where: { vehicleRequestOfferId: offerId },
      select: { id: true },
    }));

  if (!deal) {
    // Unreachable in practice: the transaction either created the deal or rolled
    // the acceptance back. Fail loudly rather than reporting a success the deal
    // spine cannot honour.
    logger.error(`[offer/respond] accepted offer ${offerId} has no deal after commit`);
    return errorResponse("DEAL_CREATE_FAILED", "We couldn't finalize your deal. Please contact support.", 500);
  }

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
