// POST /api/admin/dealers/invitations/[invId]/resend

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { sendDealerInvitationEmail } from "@/lib/services/email/resend.service";
import crypto from "crypto";

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

  const inv = await prisma.dealerInvitation.findUnique({ where: { id: invId } });
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.status === "ACCEPTED") return NextResponse.json({ error: "Already accepted" }, { status: 409 });
  if (inv.status === "CANCELLED") return NextResponse.json({ error: "Invitation was cancelled" }, { status: 409 });

  const secret = process.env.JWT_SECRET ?? "placeholder";
  const data = `${inv.email}:${inv.dealershipName}:${Date.now()}`;
  const newToken = crypto.createHmac("sha256", secret).update(data).digest("hex") +
    crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await prisma.dealerInvitation.update({
    where: { id: invId },
    data: { token: newToken, expiresAt, status: "PENDING" },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteUrl = `${appUrl}/dealer/invite/claim?token=${newToken}`;

  try {
    await sendDealerInvitationEmail({ to: inv.email, contactName: inv.contactName, dealershipName: inv.dealershipName, claimUrl: inviteUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error("[invitations/resend] Email error:", err);
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
