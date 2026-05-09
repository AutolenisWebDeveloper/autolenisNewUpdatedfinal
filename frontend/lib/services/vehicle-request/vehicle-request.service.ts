// System 4C — Vehicle Request Service (Standalone Module)
// CRITICAL: This module is completely isolated from the core deal pipeline.
// No shared lifecycle states, status models, or service logic with core deal pipeline.
// Deal creation: admin-triggered ONLY — never automatic on buyer accept.

import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";
import { VEHICLE_REQUEST_MAX_PER_HOUR } from "@/lib/constants";

// Rate limiting: max 3 submissions per hour per buyer
export async function checkRateLimit(buyerId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.vehicleRequest.count({
    where: { buyerId, createdAt: { gte: oneHourAgo } },
  });
  return recentCount < VEHICLE_REQUEST_MAX_PER_HOUR;
}

// Check single active request rule
export async function hasActiveRequest(buyerId: string): Promise<boolean> {
  const active = await prisma.vehicleRequest.findFirst({
    where: { buyerId, status: { notIn: [VehicleRequestStatus.CANCELLED, VehicleRequestStatus.CLOSED_NO_MATCH, VehicleRequestStatus.DEAL_CREATED] } },
  });
  return !!active;
}

export async function createVehicleRequest(buyerId: string, data: {
  makePreference?: string;
  modelPreference?: string;
  yearMin?: number;
  yearMax?: number;
  maxBudgetCents?: number;
  notes?: string;
}) {
  const request = await prisma.vehicleRequest.create({
    data: { buyerId, ...data, status: VehicleRequestStatus.SUBMITTED },
  });

  // Create audit trail event
  await prisma.vehicleRequestEvent.create({
    data: {
      requestId: request.id,
      eventType: "SUBMITTED",
      actorId: buyerId,
      actorRole: "BUYER",
      payload: JSON.parse(JSON.stringify(data)),
    },
  });

  // Notify buyer
  await prisma.vehicleRequestBuyerUpdate.create({
    data: {
      requestId: request.id,
      title: "Request received",
      body: "Our team has received your vehicle request and will begin researching options.",
    },
  });

  return request;
}

// Buyer-facing status labels (never internal states)
export function toBuyerLabel(status: VehicleRequestStatus): string {
  const labels: Record<VehicleRequestStatus, string> = {
    SUBMITTED: "Submitted",
    INTAKE: "Under Review",
    ACTIVE_SOURCING: "Sourcing Vehicles",
    OFFER_READY: "Offer Pending",
    OFFER_SENT: "Offer Sent",
    OFFER_ACCEPTED: "Offer Accepted",
    OFFER_DECLINED: "Offer Declined",
    DEAL_CREATED: "Deal Created",
    CLOSED_NO_MATCH: "Closed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
  };
  return labels[status] ?? status;
}
