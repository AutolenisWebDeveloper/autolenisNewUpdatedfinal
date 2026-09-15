import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { reschedulePickup } from "@/lib/services/pickup/scheduling.service";
import { proposePickup, coordHttp } from "@/lib/services/pickup/pickup-coordination.service";
import { allSignedFrom, requiredKindsFrom } from "@/lib/services/esign/required-signers";
import { LEGACY_ENVELOPE_SELECT } from "@/lib/services/esign/esign-schema-gate";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id }, include: { pickup: true } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  return successResponse({ pickup: deal.pickup, dealStatus: deal.status });
}

const scheduleSchema = z.object({
  scheduledAt: z.string().refine(s => !isNaN(Date.parse(s)), "Invalid date"),
  location: z.string().min(5, "Location must be at least 5 characters"),
  notes: z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: {
      eSignEnvelopes: { select: LEGACY_ENVELOPE_SELECT },
      coBuyer: { select: { isRequiredSigner: true } },
      offer: { select: { dealerId: true } },
    },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // A concierge (vehicle-request) deal has no Offer, and VehicleRequestOffer carries
  // no dealer identity — so no dealership exists to confirm a proposed time. Letting
  // the proposal through would park the pickup in PROPOSED permanently: only
  // confirmPickup/counterAsDealer can move it, and both require a dealerId that is
  // null here. Concierge handovers are coordinated by AutoLenis staff instead.
  if (!deal.offer?.dealerId) {
    return errorResponse(
      "NO_DEALER_ON_DEAL",
      "This is a concierge-coordinated pickup. Our team arranges the handover with you directly — no scheduling needed here.",
      409,
    );
  }

  // §13-D30 RE-DERIVED. This read was `deal.eSignEnvelope?.status !== "COMPLETED"` — correct
  // by construction while a deal could hold only one envelope, and silently wrong the moment
  // the co-buyer gained one of their own: it would have read "SOME signer finished" and let a
  // buyer schedule pickup on a contract their required co-buyer had never signed.
  const requiredKinds = requiredKindsFrom(deal.coBuyer);
  if (!allSignedFrom(deal.eSignEnvelopes, requiredKinds)) {
    const outstanding = requiredKinds.filter(
      (kind) => !deal.eSignEnvelopes.some((e) => e.signerKind === kind && e.status === "COMPLETED"),
    );
    return errorResponse(
      "PREREQUISITE_NOT_MET",
      outstanding.includes("CO_BUYER") && !outstanding.includes("BUYER")
        ? "Pickup can only be scheduled once your co-buyer has signed as well."
        : "Pickup can only be scheduled after you've signed your contract.",
      400
    );
  }

  // The buyer PROPOSES a pickup time (D2). The deal does NOT advance here — it
  // reaches PICKUP_SCHEDULED only when the dealer confirms (or the buyer accepts
  // a dealer counter). Initial proposal is only valid from a deal whose funding has
  // CLEARED and that has no pending pickup; the accept/counter round-trip has its own routes.
  // FUNDING_PENDING, not SIGNED — see pickup-coordination.service.ts. Proposing a time on a
  // deal whose funding has not cleared invites the buyer to plan around a date the vehicle
  // cannot legally be released on.
  if (deal.status !== "FUNDING_PENDING") {
    return errorResponse(
      "INVALID_STATE",
      "This deal isn't ready for pickup scheduling.",
      409
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  // proposePickup gates availability, sets PROPOSED, and notifies the dealer via
  // the Inngest rail. No deal advance, no QR yet — those happen on confirm.
  const result = await proposePickup(dealId, buyer.id, new Date(parsed.data.scheduledAt), parsed.data.location);
  if (!result.ok) {
    const { errorCode, status } = coordHttp(result.code);
    return errorResponse(errorCode, result.reason, status);
  }

  return successResponse({ pickup: result.pickup });
}

const rescheduleSchema = z.object({
  scheduledAt: z.string().refine(s => !isNaN(Date.parse(s)), "Invalid date"),
  location:    z.string().min(5, "Location must be at least 5 characters"),
  // reason is accepted for client UX but not stored — Pickup model has no reason field
  reason:      z.string().max(200).optional(),
});

export async function PATCH(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where:   { id: dealId, buyerId: buyer.id },
    include: { pickup: true },
  });
  if (!deal)        return errorResponse("NOT_FOUND", "Deal not found", 404);
  if (!deal.pickup) return errorResponse("NOT_FOUND", "No pickup scheduled", 404);
  if (deal.pickup.status === "COMPLETED") {
    return errorResponse("ALREADY_COMPLETED", "Cannot reschedule a completed pickup", 400);
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = rescheduleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const newScheduledAt = new Date(parsed.data.scheduledAt);

  // Route through the single gated seam — the buyer path enforces the dealer's
  // real availability (no override). This closes the prior reschedule bypass
  // where the slot was written unconditionally.
  const result = await reschedulePickup(dealId, newScheduledAt, {
    reason: parsed.data.reason,
    location: parsed.data.location,
  });
  if (!result.ok) {
    return errorResponse("VALIDATION_ERROR", result.reason, 400);
  }

  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type:    "PICKUP_SCHEDULED",
      title:   "Pickup rescheduled",
      body:    `Your pickup has been rescheduled to ${newScheduledAt.toLocaleDateString()}.`,
    },
  }).catch((err: unknown) => logger.error("[pickup-reschedule] notification failed:", err));

  return successResponse({ pickup: result.pickup });
}
