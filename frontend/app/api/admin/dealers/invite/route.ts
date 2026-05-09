// POST /api/admin/dealers/invite — create HMAC-signed dealer invitation

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { sendDealerInvitationEmail } from "@/lib/services/email/resend.service";
import crypto from "crypto";
import { z } from "zod";

const schema = z.object({
  dealershipName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  personalMessage: z.string().max(500).optional(),
});

function generateInviteToken(email: string, dealershipName: string): string {
  const secret = process.env.JWT_SECRET ?? "placeholder";
  const data = `${email}:${dealershipName}:${Date.now()}`;
  return crypto.createHmac("sha256", secret).update(data).digest("hex") +
    crypto.randomBytes(8).toString("hex");
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { dealershipName, contactName, email, personalMessage } = parsed.data;
  const token = generateInviteToken(email, dealershipName);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

  const invitation = await prisma.dealerInvitation.create({
    data: {
      dealershipName,
      contactName,
      email: email.toLowerCase(),
      personalMessage: personalMessage ?? null,
      token,
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteUrl = `${appUrl}/dealer/invite/claim?token=${token}`;

  try {
    await sendDealerInvitationEmail({ to: email, contactName, dealershipName, claimUrl: inviteUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error("[dealer/invite] Email error:", err);
  }

  return NextResponse.json({
    success: true,
    data: {
      id: invitation.id,
      token,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
    },
  }, { status: 201 });
}
