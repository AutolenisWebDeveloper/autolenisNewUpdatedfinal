import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";

interface Props { params: Promise<{ requestId: string }> }

// POST /api/buyer/requests/[requestId]/offer/respond — accept or decline offer
// CRITICAL: Accepting does NOT automatically create a deal
// Deal creation is admin-triggered ONLY from /admin/requests/[requestId]/create-deal
export async function POST(request: NextRequest, { params }: Props) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const formData = await request.formData();
  const response = formData.get("response") as string;
  const offerId = formData.get("offerId") as string;

  if (!["ACCEPT", "DECLINE"].includes(response)) {
    return errorResponse("VALIDATION_ERROR", "Response must be ACCEPT or DECLINE", 400);
  }

  const vehicleRequest = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
    include: { offers: { where: { id: offerId, status: "SENT" } } },
  });
  if (!vehicleRequest || vehicleRequest.offers.length === 0) {
    return errorResponse("NOT_FOUND", "Request or offer not found", 404);
  }

  const newStatus = response === "ACCEPT" ? VehicleRequestStatus.OFFER_ACCEPTED : VehicleRequestStatus.OFFER_DECLINED;
  const offerStatus = response === "ACCEPT" ? "ACCEPTED" : "DECLINED";

  await prisma.$transaction([
    prisma.vehicleRequest.update({ where: { id: requestId }, data: { status: newStatus } }),
    prisma.vehicleRequestOffer.update({ where: { id: offerId }, data: { status: offerStatus, respondedAt: new Date() } }),
    prisma.vehicleRequestEvent.create({
      data: {
        requestId,
        eventType: `OFFER_${response}ED`,
        actorId: buyer.id,
        actorRole: "BUYER",
        payload: { offerId, response },
      },
    }),
  ]);

  // Note: Deal creation requires explicit admin action after OFFER_ACCEPTED
  // This route never creates a deal automatically

  return successResponse({ status: newStatus, message: response === "ACCEPT" ? "Offer accepted. Our team will be in touch to finalize your deal." : "Offer declined. You may continue browsing or request another vehicle." });
}
