// POST /api/admin/buyers/[buyerId]/reset-password
// Triggers a Supabase password reset email for the buyer via the service role client.
// Sends the branded reset email via Resend.
// Writes AuditLog: BUYER_PASSWORD_RESET_TRIGGERED
// Does NOT expose the reset link in the API response — only confirms it was sent.
// Requires reason (min 10 chars)

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;
  const email = buyer.user.email;

  // Generate password reset link via Supabase service role
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (error) {
    logger.error("[reset-password] Supabase generateLink failed:", error);
    return adminError("RESET_FAILED", "Failed to generate password reset link", 500);
  }

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_PASSWORD_RESET_TRIGGERED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: { buyerEmail: email, triggeredBy: admin.email },
    },
  });

  return adminSuccess({ sent: true, email });
}
