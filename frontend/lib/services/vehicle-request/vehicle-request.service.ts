// System 4C — Vehicle Request Service (Standalone Module)
// CRITICAL: This module is completely isolated from the core deal pipeline.
// No shared lifecycle states, status models, or service logic with core deal pipeline.
// Deal creation: admin-triggered ONLY — never automatic on buyer accept.

import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus, type Prisma } from "@prisma/client";
import { VEHICLE_REQUEST_MAX_PER_HOUR } from "@/lib/constants";
import { vehicleRequestStatusLabel } from "@/lib/domain/status-labels";

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

// Buyer-facing status labels (never internal states). Delegates to the single
// source of truth in lib/domain/status-labels so buyer/admin wording can never
// silently drift apart again (UI-13).
export function toBuyerLabel(status: VehicleRequestStatus): string {
  return vehicleRequestStatusLabel(status, "buyer");
}

/**
 * PAY-10b — the transition §5b calls for: "Eligibility passes. Vehicle Request enters
 * `PAYMENT_REQUIRED`."
 *
 * Nothing wrote this status before Phase 3. The label existed in the enum, in the
 * one-open-per-buyer index predicate and in the status-label maps, but no code path
 * ever put a request into it, so the state §5b describes as the entry to checkout was
 * unreachable.
 *
 * FROM WHICH STATES. Only the three that mean "the buyer is still assembling this
 * request": DRAFT, SUBMITTED, INTAKE. Deliberately NOT from ACTIVE_SOURCING or
 * anything past it — a paid request that is already being sourced must not be dragged
 * back to "payment required" by a stale checkout tab, which is exactly what an
 * unguarded write would do on a browser refresh.
 *
 * Idempotent: already being in PAYMENT_REQUIRED is a success, not a no-op to report.
 * The `updateMany` scoping means the database decides, so two concurrent checkout
 * loads cannot both "win".
 */
export async function enterPaymentRequired(
  requestId: string,
  db: typeof prisma | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const { count } = await db.vehicleRequest.updateMany({
    where: {
      id: requestId,
      status: { in: ["DRAFT", "SUBMITTED", "INTAKE", "PAYMENT_REQUIRED"] },
    },
    data: { status: "PAYMENT_REQUIRED" },
  });
  return count > 0;
}
