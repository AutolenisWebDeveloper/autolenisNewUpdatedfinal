import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { scheduleVehiclePickup, reschedulePickup } from "@/lib/services/pickup/scheduling.service";

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
    include: { eSignEnvelope: true },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  if (deal.eSignEnvelope?.status !== "COMPLETED") {
    return errorResponse(
      "PREREQUISITE_NOT_MET",
      "Pickup can only be scheduled after all documents have been signed.",
      400
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const pickup = await scheduleVehiclePickup(
    dealId,
    new Date(parsed.data.scheduledAt),
    parsed.data.location,
  );

  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type: "DEAL_STAGE_CHANGED",
      title: "Pickup scheduled",
      body: `Your vehicle pickup is confirmed for ${new Date(parsed.data.scheduledAt).toLocaleDateString()}.`,
    },
  }).catch((err: unknown) => { console.error("[PickupSchedule] Failed to create notification:", err); });

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

  const pickup = await prisma.pickup.update({
    where: { id: deal.pickup.id },
    data:  {
      scheduledAt: newScheduledAt,
      location:    parsed.data.location,
    },
  });

  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type:    "PICKUP_SCHEDULED",
      title:   "Pickup rescheduled",
      body:    `Your pickup has been rescheduled to ${newScheduledAt.toLocaleDateString()}.`,
    },
  }).catch((err: unknown) => console.error("[pickup-reschedule] notification failed:", err));

  return successResponse({ pickup });
}
