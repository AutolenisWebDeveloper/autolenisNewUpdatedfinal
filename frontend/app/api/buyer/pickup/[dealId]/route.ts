import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { scheduleVehiclePickup, reschedulePickup } from "@/lib/services/pickup/scheduling.service";
import { checkPickupTime } from "@/lib/services/pickup/availability.service";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";

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
    include: { eSignEnvelope: true, offer: { select: { dealerId: true } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  if (deal.eSignEnvelope?.status !== "COMPLETED") {
    return errorResponse(
      "PREREQUISITE_NOT_MET",
      "Pickup can only be scheduled after all documents have been signed.",
      400
    );
  }

  // Only a signed (or already-scheduled, i.e. re-scheduling) deal may book a
  // pickup — never a completed, cancelled, or refunded one.
  if (deal.status !== "SIGNED" && deal.status !== "PICKUP_SCHEDULED") {
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

  // Buyer self-scheduling is bounded by the dealer's availability window. This is
  // the server-authoritative gate; the UI shows the same limits (single seam) but
  // the check here is what actually rejects an out-of-window slot.
  const scheduledAt = new Date(parsed.data.scheduledAt);
  const within = await checkPickupTime(deal.offer?.dealerId ?? null, scheduledAt);
  if (!within.ok) {
    return errorResponse("VALIDATION_ERROR", within.reason, 400);
  }

  const pickup = await scheduleVehiclePickup(dealId, scheduledAt, parsed.data.location);

  // Automated scheduling: the buyer's own slot selection drives the deal forward
  // through the guarded (non-forced) seam — no admin action required. Only a deal
  // still in SIGNED transitions; a re-schedule of an already-scheduled deal skips
  // the (now illegal) transition. advanceDealStatus records DealStatusHistory and
  // fires the caller-aware buyer comms for PICKUP_SCHEDULED.
  if (deal.status === "SIGNED") {
    await advanceDealStatus(dealId, "PICKUP_SCHEDULED", {
      actorId: buyer.id,
      actorRole: "BUYER",
      reason: "Buyer self-scheduled vehicle pickup",
    });
  }

  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type: "PICKUP_SCHEDULED",
      title: "Pickup scheduled",
      body: `Your vehicle pickup is confirmed for ${scheduledAt.toLocaleDateString()}.`,
      actionUrl: "/buyer/pickup",
    },
  }).catch((err: unknown) => { logger.error("[PickupSchedule] Failed to create notification:", err); });

  return successResponse({ pickup });
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
