// POST /api/admin/buyers/[buyerId]/suspend
// Suspends a buyer account — sets isSuspended=true, records reason and timestamp
// Also updates Supabase user_metadata.isSuspended so proxy.ts can gate /buyer/* routes
// Writes AuditLog: BUYER_SUSPENDED with previousState and newState
// Requires reason (min 10 chars)

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
    console.error("[buyer/suspend] Supabase metadata update failed:", err);
  }

  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: { isSuspended: true, suspendedAt: now, suspendedReason: reason },
    select: { id: true, isSuspended: true, suspendedAt: true },
  });

  // Revoke all active Supabase sessions for this buyer immediately
  try {
    await supabase.auth.admin.signOut(buyer.user.supabaseId, "global");
  } catch (err) {
    console.error("[buyer/suspend] Supabase signOut failed:", err);
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
