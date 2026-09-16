// POST /api/admin/deals/[dealId]/pickup/regenerate-qr
// Mints a FRESH release credential for a scheduled pickup and returns its rendered QR.
//
// The URL is unchanged so the two admin screens that call it keep working, but what it does is
// not what it did. It used to write a `Math.random()` payload and its PNG onto the pickup row,
// for a pickup in ANY state — including one never scheduled, which is a code that opens a car
// with no appointment behind it. It now mints through `release-token.service`: CSPRNG, hashed at
// rest, expiry bound to the appointment, and REFUSED outside SCHEDULED / RESCHEDULED /
// CHECKED_IN.
//
// A reissue REVOKES. The previous credential stops resolving the moment this returns, so this is
// the remedy for a code that leaked or that the buyer cannot find — not a way to have two.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { reissueReleaseCode } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const pickup = await prisma.pickup.findUnique({ where: { dealId }, select: { id: true, status: true } });
  if (!pickup) return adminError("NOT_FOUND", "Pickup not found", 404);

  const reissued = await reissueReleaseCode(dealId);
  if (!reissued) {
    return adminError(
      "NOT_READY_FOR_PICKUP",
      `A release code can only be issued for a scheduled pickup. This one is ${pickup.status.replace(/_/g, " ")}.`,
      409,
    );
  }

  // The audit records THAT a credential was issued and when it dies — never the credential. The
  // raw token exists only in the response body and the image rendered from it.
  await createAuditLog(admin, request, {
    action: "PICKUP_QR_REGENERATED",
    entityType: "Deal",
    entityId: dealId,
    metadata: { pickupId: pickup.id, expiresAt: reissued.expiresAt.toISOString(), previousCodeRevoked: true },
  });

  return adminSuccess({ releaseCodeImage: reissued.image, expiresAt: reissued.expiresAt.toISOString() });
}
