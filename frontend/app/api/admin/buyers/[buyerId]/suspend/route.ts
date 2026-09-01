// POST /api/admin/buyers/[buyerId]/suspend
// Suspends a buyer account — sets isSuspended=true, records reason and timestamp
// Also updates Supabase user_metadata.isSuspended so proxy.ts can gate /buyer/* routes
// Writes AuditLog: BUYER_SUSPENDED with previousState and newState
// Requires reason (min 10 chars)

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  // Tier 1 (Finding 5): enforced directly from PERMISSION_ROLES.
  // Placing a hold on a buyer — a policy-3 compliance power.
  const adminCheck = await requirePermissionStrict(request, "buyers.freeze");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);
  if (buyer.isSuspended) return adminError("ALREADY_SUSPENDED", "Buyer is already suspended", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;
  const now = new Date();

  const previousState = { isSuspended: false, suspendedAt: null, suspendedReason: null };

  const supabase = createServiceSupabaseClient();

  // Update Supabase user metadata FIRST so the proxy edge check works immediately
  try {
    await supabase.auth.admin.updateUserById(buyer.user.supabaseId, {
      user_metadata: { isSuspended: true },
    });
  } catch (err) {
    logger.error("[buyer/suspend] Supabase metadata update failed:", err);
  }

  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: { isSuspended: true, suspendedAt: now, suspendedReason: reason },
    select: { id: true, isSuspended: true, suspendedAt: true },
  });

  // Notify the buyer of the suspension. Recorded before session revocation so
  // it persists in the buyer's notification history. Best-effort — never blocks.
  await prisma.notification.create({
    data: {
      buyerId,
      type: "ADMIN_MESSAGE",
      channel: "IN_APP",
      title: "Your account has been suspended",
      body: `Your AutoLenis account has been suspended. Reason: ${reason}. Contact support@autolenis.com if you believe this is in error.`,
    },
  }).catch((err) => logger.error("[buyer/suspend] notification failed:", err));

  // Revoke all active Supabase sessions for this buyer immediately
  try {
    await supabase.auth.admin.signOut(buyer.user.supabaseId, "global");
  } catch (err) {
    logger.error("[buyer/suspend] Supabase signOut failed:", err);
  }

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_SUSPENDED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      previousState,
      newState: { isSuspended: true, suspendedAt: now.toISOString(), suspendedReason: reason },
      ipAddress: ipAddress ?? null,
      metadata: { buyerEmail: buyer.user.email },
    },
  });

  return adminSuccess({ buyer: { id: updated.id, isSuspended: updated.isSuspended, suspendedAt: updated.suspendedAt } });
}
