import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { VehicleRequestStatus } from "@prisma/client";
import { logger } from "@/lib/logger";

// POST /api/buyer/requests/[requestId]/cancel
//
// §24 — THROUGH THE ONE CANCELLATION ORCHESTRATION, as of Phase 10.
//
// ── WHAT THIS ROUTE USED TO DO, AND WHY IT WAS THE SAME DEFECT TWICE ────────
//
// It wrote `vehicleRequest.update({ status: CANCELLED })` directly. That is the identical
// shape Phase 10 removed from `admin-buyer-command-center.service.ts` — a second
// cancellation writer beside the orchestration — and it had the identical consequence: §24's
// stops did not run. A buyer cancelling at ACTIVE_SOURCING left the sourcing case OPEN, so
// `coverage-hold-reconcile` → `sweepSourcingCases` kept driving a request its owner had
// ended; any queued transactional comms for the request stayed queued; and nothing recorded
// the stage the transaction was at when it stopped.
//
// It also wrote no REASON. §24 requires one on every cancellation, and a column that is
// always null is the same as no column.
//
// ── WHAT IS DELIBERATELY NOT WIDENED ────────────────────────────────────────
//
// The orchestration's own VEHICLE_REQUEST stop will cancel any request that is not already
// CANCELLED / EXPIRED / CLOSED_NO_MATCH / DEAL_CREATED — a WIDER set than this route has ever
// accepted. The precondition below therefore stays, and stays FIRST: a buyer who may not
// cancel at their current stage is still refused with the same code and the same message.
// Delegating would otherwise hand buyers a capability this route never granted, which is a
// product decision and not a refactor.
export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const vehicleRequest = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
    select: { id: true, status: true },
  });
  if (!vehicleRequest) return errorResponse("NOT_FOUND", "Request not found", 404);

  const cancellableStatuses: VehicleRequestStatus[] = [
    VehicleRequestStatus.SUBMITTED, VehicleRequestStatus.INTAKE,
    VehicleRequestStatus.ACTIVE_SOURCING,
  ];
  if (!cancellableStatuses.includes(vehicleRequest.status)) {
    return errorResponse("CANNOT_CANCEL", "This request cannot be cancelled at its current stage", 400);
  }

  const { cancelTransaction } = await import("@/lib/services/transaction/cancellation.service");
  const outcome = await cancelTransaction({
    vehicleRequestId: requestId,
    // §24 requires a reason and this route collects none. The ACTION is the reason, stated
    // rather than defaulted to "cancelled" — an operator reading the record learns who ended
    // it and from where, which is the question they would actually ask.
    reason: "Cancelled by the buyer from their requests page.",
    actorId: buyer.id,
    actorRole: "BUYER",
  });

  // The buyer-facing audit row stays HERE. It is about this route's actor and surface, which
  // the orchestration does not know about, and `DealStatusHistory` — the row the orchestration
  // writes — does not exist for a request with no deal.
  await prisma.vehicleRequestEvent
    .create({ data: { requestId, eventType: "CANCELLED", actorId: buyer.id, actorRole: "BUYER" } })
    .catch((err) => {
      logger.error("[buyer/cancel] event row could not be written (the cancellation stands):", err);
    });

  // REPORTED, NOT ASSUMED. The orchestration declines when a concurrent writer got there
  // first, and a buyer told "cancelled" about a request that is still live would act on a
  // false state — the same reasoning the admin path records.
  return successResponse({
    cancelled: outcome.outcome === "CANCELLED",
    outcome: outcome.outcome,
    stageAtCancellation: outcome.stageAtCancellation,
  });
}
