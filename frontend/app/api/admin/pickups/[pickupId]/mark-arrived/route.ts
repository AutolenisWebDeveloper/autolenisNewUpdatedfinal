// POST /api/admin/pickups/[pickupId]/mark-arrived
// Marks a buyer as checked in (arrived) for a pickup by pickup ID.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { checkInPickup } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ pickupId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { pickupId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const pickup = await prisma.pickup.findUnique({ where: { id: pickupId } });
  if (!pickup) return adminError("NOT_FOUND", "Pickup not found", 404);

  await checkInPickup(pickup.dealId);

  await createAuditLog(admin, request, {
    action: "PICKUP_CHECKED_IN",
    entityType: "Pickup",
    entityId: pickupId,
    metadata: { dealId: pickup.dealId },
  });

  return adminSuccess({ success: true });
}
