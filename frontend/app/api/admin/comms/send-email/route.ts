// POST /api/admin/comms/send-email
// Sends a custom email to a buyer, dealer, or affiliate.
// Body: { recipientType: "BUYER"|"DEALER"|"AFFILIATE"; recipientId: string; subject: string; body: string }
// Validates admin session, fetches recipient email, sends via Resend.
// Writes AuditLog: ADMIN_EMAIL_SENT
// Requires reason field with minimum 10 chars.

import { NextRequest } from "next/server";
import { getAdminWithRole, OPERATIONAL_ROLES, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendCustomAdminEmail } from "@/lib/services/email/resend.service";

const schema = z.object({
  recipientType: z.enum(["BUYER", "DEALER", "AFFILIATE"]),
  recipientId: z.string().min(1, "Recipient ID is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(20, "Body must be at least 20 characters"),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

async function getRecipientEmail(recipientType: string, recipientId: string): Promise<{ email: string; name: string } | null> {
  if (recipientType === "BUYER") {
    const buyer = await prisma.buyer.findUnique({
      where: { id: recipientId },
      include: { user: { select: { email: true } } },
    });
    if (!buyer) return null;
    return { email: buyer.user.email, name: `${buyer.firstName} ${buyer.lastName}` };
  }
  if (recipientType === "DEALER") {
    const dealer = await prisma.dealer.findUnique({
      where: { id: recipientId },
      include: { user: { select: { email: true } } },
    });
    if (!dealer) return null;
    return { email: dealer.user.email, name: dealer.dealershipName };
  }
  if (recipientType === "AFFILIATE") {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: recipientId },
      include: { user: { select: { email: true } } },
    });
    if (!affiliate) return null;
    return { email: affiliate.user.email, name: affiliate.user.email };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions. OPERATIONS_ADMIN or higher required.", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { recipientType, recipientId, subject, body: emailBody, reason } = parsed.data;

  const recipient = await getRecipientEmail(recipientType, recipientId);
  if (!recipient) return adminError("NOT_FOUND", `${recipientType} not found`, 404);

  const idempotencyKey = `admin-comms-${admin.adminId}-${recipientId}-${Date.now()}`;
  const result = await sendCustomAdminEmail({
    to: recipient.email,
    subject,
    body: emailBody,
    idempotencyKey,
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "ADMIN_EMAIL_SENT",
      entityType: recipientType,
      entityId: recipientId,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: {
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        subject,
        deliveryStatus: result.sent ? "SENT" : "SKIPPED",
      },
    },
  });

  return adminSuccess({ sent: result.sent, recipientEmail: recipient.email, recipientName: recipient.name });
}
