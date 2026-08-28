// POST /api/admin/dealers/invitations/[invId]/resend

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { sendDealerInvitationEmail } from "@/lib/services/email/resend.service";
import { refreshInvitationToken } from "@/lib/services/dealer-recruitment/invitation-token.service";

interface RouteContext { params: Promise<{ invId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { invId } = await params;

  // Columns are named explicitly: an unqualified select would ask for token_hash
  // / consumed_at, which do not exist until migration 20260828000000 is applied.
  const inv = await prisma.dealerInvitation.findUnique({
    where: { id: invId },
    select: { id: true, email: true, contactName: true, dealershipName: true, status: true },
  });
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.status === "ACCEPTED") return NextResponse.json({ error: "Already accepted" }, { status: 409 });
  if (inv.status === "CANCELLED") return NextResponse.json({ error: "Invitation was cancelled" }, { status: 409 });

  // One token scheme for invitations, owned by the service: 7-day TTL, hashed at
  // rest where the schema allows, and guarded on status so this cannot resurrect
  // an invitation accepted or cancelled since the read above.
  const rotated = await refreshInvitationToken(invId);
  if (!rotated) {
    return NextResponse.json({ error: "Invitation is no longer resendable" }, { status: 409 });
  }
  const { rawToken, expiresAt } = rotated;

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const inviteUrl = `${appUrl}/dealer/invite/claim?token=${rawToken}`;

  try {
    await sendDealerInvitationEmail({ to: inv.email, contactName: inv.contactName, dealershipName: inv.dealershipName, claimUrl: inviteUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    logger.error("[invitations/resend] Email error:", err);
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "STATUS_CHANGE",
      entityType: "DealerInvitation",
      entityId: invId,
      reason: "Invitation resent",
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, inviteUrl });
}
