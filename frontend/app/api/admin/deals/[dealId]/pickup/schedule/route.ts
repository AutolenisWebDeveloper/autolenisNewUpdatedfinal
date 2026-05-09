// POST /api/admin/deals/[dealId]/pickup/schedule
// Schedules (or reschedules) a pickup for a deal.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { schedulePickup } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  scheduledAt: z.string().refine(v => !isNaN(Date.parse(v)), "Invalid date"),
  location: z.string().min(5, "Location must be at least 5 characters"),
});

const MIN_SCHEDULE_BUFFER_MS = 60_000; // 1 minute

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { scheduledAt, location } = parsed.data;
  const scheduledDate = new Date(scheduledAt);
  // Require at least 1 minute in the future to avoid race conditions
  if (scheduledDate.getTime() < Date.now() + MIN_SCHEDULE_BUFFER_MS) {
    return adminError("VALIDATION_ERROR", "Scheduled date must be at least 1 minute in the future", 400);
  }

  await schedulePickup(dealId, scheduledDate, location);

  await createAuditLog(admin, request, {
    action: "PICKUP_SCHEDULED",
    entityType: "Deal",
    entityId: dealId,
    metadata: { scheduledAt, location },
  });

  return adminSuccess({ success: true });
}
