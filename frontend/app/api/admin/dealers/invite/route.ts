// POST /api/admin/dealers/invite — create HMAC-signed dealer invitation

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { sendDealerInvitationEmail } from "@/lib/services/email/resend.service";
import crypto from "crypto";
import { z } from "zod";
import { issueInvitationToken } from "@/lib/services/dealer-recruitment/invitation-token.service";

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
  // Hashed at rest, 7-day TTL — same design as DealerAccountClaimToken. The raw
  // token exists only in the emailed link below and is never persisted.
  const { rawToken, tokenHash, expiresAt } = issueInvitationToken();

  const invitation = await prisma.dealerInvitation.create({
    data: {
      dealershipName,
      contactName,
      email: email.toLowerCase(),
      personalMessage: personalMessage ?? null,
      tokenHash,
      expiresAt,
      invitedBy: admin.adminId,
      status: "PENDING",
    },
  });

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
