// POST /api/admin/buyers/[buyerId]/invite
// Send (or resend) account activation invite to a buyer.
// Logs to AdminAuditLog. Requires reason.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendAdminCreatedBuyerEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Reason is required"),
  temporaryPassword: z.string().min(8).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason, temporaryPassword } = parsed.data;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();

  // Send invite email — uses idempotency so this is safe to call multiple times
  if (temporaryPassword) {
    await sendAdminCreatedBuyerEmail(
      buyer.user.email,
      buyer.firstName,
      temporaryPassword,
      `${appUrl}/auth/signin`
    );
  } else {
    // Send a generic reminder to sign in
    const { Resend } = await import("resend");
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && !apiKey.includes("placeholder")) {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: `${process.env.FROM_NAME ?? "AutoLenis"} <noreply@autolenis.com>`,
        to: buyer.user.email,
        subject: "Your AutoLenis account is ready",
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
          <h1 style="color:#111827">Welcome to AutoLenis, ${buyer.firstName}!</h1>
          <p>Your account has been set up and is ready for you to access.</p>
          <a href="${appUrl}/auth/signin" style="background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px">Sign In →</a>
        </div>`,
      }).catch((err: unknown) => {
        logger.error("[admin/buyer/invite] Email send failed:", err);
      });
    }
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_INVITE_SENT",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { email: buyer.user.email },
    },
  });

  return adminSuccess({ invited: true, email: buyer.user.email });
}
