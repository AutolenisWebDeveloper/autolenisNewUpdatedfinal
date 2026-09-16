// POST /api/admin/pickups/[pickupId]/regenerate-qr
// The pickups-list twin of the deal-scoped route — same service, same refusal, same revocation.
// See app/api/admin/deals/[dealId]/pickup/regenerate-qr/route.ts for what changed and why.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { reissueReleaseCode } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ pickupId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { pickupId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const pickup = await prisma.pickup.findUnique({ where: { id: pickupId }, select: { dealId: true, status: true } });
  if (!pickup) return adminError("NOT_FOUND", "Pickup not found", 404);

  const reissued = await reissueReleaseCode(pickup.dealId);
  if (!reissued) {
    return adminError(
      "NOT_READY_FOR_PICKUP",
      `A release code can only be issued for a scheduled pickup. This one is ${pickup.status.replace(/_/g, " ")}.`,
      409,
    );
  }

  await createAuditLog(admin, request, {
    action: "PICKUP_QR_REGENERATED",
    entityType: "Pickup",
    entityId: pickupId,
    metadata: { dealId: pickup.dealId, expiresAt: reissued.expiresAt.toISOString(), previousCodeRevoked: true },
  });

  return adminSuccess({ releaseCodeImage: reissued.image, expiresAt: reissued.expiresAt.toISOString() });
}
