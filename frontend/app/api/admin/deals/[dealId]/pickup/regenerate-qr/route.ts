// POST /api/admin/deals/[dealId]/pickup/regenerate-qr
// Regenerates the QR code for a scheduled pickup.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { regenerateQr } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
  if (!pickup) return adminError("NOT_FOUND", "Pickup not found", 404);

  const qrCodeImage = await regenerateQr(dealId);

  await createAuditLog(admin, request, {
    action: "PICKUP_QR_REGENERATED",
    entityType: "Deal",
    entityId: dealId,
    metadata: { pickupId: pickup.id },
  });

  return adminSuccess({ qrCodeImage });
}
