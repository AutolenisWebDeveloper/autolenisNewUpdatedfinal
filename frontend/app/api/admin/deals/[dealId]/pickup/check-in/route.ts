// POST /api/admin/deals/[dealId]/pickup/check-in
// Marks a pickup as CHECKED_IN (buyer has arrived).
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { checkInPickup } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
  if (!pickup) return adminError("NOT_FOUND", "Pickup not found", 404);
  if (pickup.status !== "SCHEDULED") return adminError("CONFLICT", "Pickup must be in SCHEDULED status to check in", 409);

  await checkInPickup(dealId);

  await createAuditLog(admin, request, {
    action: "PICKUP_CHECKED_IN",
    entityType: "Deal",
    entityId: dealId,
    metadata: { pickupId: pickup.id },
  });

  return adminSuccess({ success: true });
}
