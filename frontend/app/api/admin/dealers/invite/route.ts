// POST /api/admin/dealers/invite — create HMAC-signed dealer invitation

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { sendDealerInvitationEmail } from "@/lib/services/email/resend.service";
import { z } from "zod";
import { createInvitation } from "@/lib/services/dealer-recruitment/invitation-token.service";

const schema = z.object({
  dealershipName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  personalMessage: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { dealershipName, contactName, email, personalMessage } = parsed.data;
  // 7-day TTL, hashed at rest wherever the database can hold a hash. The service
  // owns the token columns so this route never has to know which physical schema
  // it is running against — see invitation-schema-compat.ts.
  let invitation: { id: string; rawToken: string; expiresAt: Date };
  try {
    invitation = await createInvitation({
      dealershipName,
      contactName,
      email,
      personalMessage,
      invitedBy: admin.adminId,
    });
  } catch (err) {
    // No invitation was persisted, so there is nothing to email and no success
    // to report. Never return 201 for a write that did not happen.
    logger.error("[dealer/invite] Failed to create invitation:", err);
    return NextResponse.json(
      { error: { code: "INVITATION_CREATE_FAILED", message: "Could not create the invitation" } },
      { status: 500 },
    );
  }
  const { rawToken, expiresAt } = invitation;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "STATUS_CHANGE",
      entityType: "DealerInvitation",
      entityId: invitation.id,
      reason: `Invited ${dealershipName}`,
    },
  }).catch(() => {});

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const inviteUrl = `${appUrl}/dealer/invite/claim?token=${rawToken}`;

  try {
    await sendDealerInvitationEmail({ to: email, contactName, dealershipName, claimUrl: inviteUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    logger.error("[dealer/invite] Email error:", err);
  }

  // Emit the dealer_invited domain event → Make.com orchestration (+ legacy
  // in-app engine behind the cutover flag). Best-effort; never blocks the invite.
  try {
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent("dealer_invited", {
      domainEntityId: invitation.id,
      contact: {
        email: email.toLowerCase(),
        firstName: contactName,
        source: "dealer_signup",
      },
      data: {
        invitation_id: invitation.id,
        dealership_name: dealershipName,
        invite_url: inviteUrl,
        expires_at: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    logger.error("[dealer/invite] emit failed:", err);
  }

  return NextResponse.json({
    success: true,
    data: {
      id: invitation.id,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
    },
  }, { status: 201 });
}
