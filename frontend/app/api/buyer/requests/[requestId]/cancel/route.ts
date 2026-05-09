import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";

interface Props { params: Promise<{ requestId: string }> }

// POST /api/buyer/requests/[requestId]/cancel
export async function POST(request: NextRequest, { params }: Props) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const vehicleRequest = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
  });
  if (!vehicleRequest) return errorResponse("NOT_FOUND", "Request not found", 404);

  const cancellableStatuses: VehicleRequestStatus[] = [
    VehicleRequestStatus.SUBMITTED, VehicleRequestStatus.INTAKE,
    VehicleRequestStatus.ACTIVE_SOURCING,
  ];
  if (!cancellableStatuses.includes(vehicleRequest.status)) {
    return errorResponse("CANNOT_CANCEL", "This request cannot be cancelled at its current stage", 400);
  }

  await prisma.$transaction([
    prisma.vehicleRequest.update({ where: { id: requestId }, data: { status: VehicleRequestStatus.CANCELLED, cancelledAt: new Date() } }),
    prisma.vehicleRequestEvent.create({
      data: { requestId, eventType: "CANCELLED", actorId: buyer.id, actorRole: "BUYER" },
    }),
  ]);

  return successResponse({ cancelled: true });
}
