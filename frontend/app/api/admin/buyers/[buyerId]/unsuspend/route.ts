// POST /api/admin/buyers/[buyerId]/unsuspend
// Unsuspends a buyer account — clears isSuspended, suspendedAt, suspendedReason
// Also clears Supabase user_metadata.isSuspended so proxy.ts resumes allowing /buyer/* routes
// Writes AuditLog: BUYER_UNSUSPENDED
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
  if (!buyer.isSuspended) return adminError("NOT_SUSPENDED", "Buyer is not suspended", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;

  const previousState = {
    isSuspended: true,
    suspendedAt: buyer.suspendedAt?.toISOString() ?? null,
    suspendedReason: buyer.suspendedReason ?? null,
  };

  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: { isSuspended: false, suspendedAt: null, suspendedReason: null },
    select: { id: true, isSuspended: true },
  });

  // Clear Supabase user metadata so proxy.ts resumes allowing /buyer/* routes
  try {
    const supabase = createServiceSupabaseClient();
    await supabase.auth.admin.updateUserById(buyer.user.supabaseId, {
      user_metadata: { isSuspended: false },
    });
  } catch (err) {
    console.error("[buyer/unsuspend] Supabase metadata update failed:", err);
  }

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_UNSUSPENDED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      previousState,
      newState: { isSuspended: false, suspendedAt: null, suspendedReason: null },
      ipAddress: ipAddress ?? null,
      metadata: { buyerEmail: buyer.user.email },
    },
  });

  return adminSuccess({ buyer: { id: updated.id, isSuspended: updated.isSuspended } });
}
