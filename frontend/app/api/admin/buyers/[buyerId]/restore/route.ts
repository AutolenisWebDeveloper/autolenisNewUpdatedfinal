// POST /api/admin/buyers/[buyerId]/restore
// Restore an archived buyer profile back to active status.
// Requires admin auth + reason note. Audit logged.

import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { restoreBuyerByAdmin } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  // Tier 1 (Finding 5): enforced directly from PERMISSION_ROLES.
  // Buyer lifecycle; OPS, not a compliance freeze.
  const adminCheck = await requirePermissionStrict(request, "buyers.account_state");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await restoreBuyerByAdmin(buyerId, admin.adminId, admin.email, parsed.data.reason);
    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Restore failed", 400);
  }
}
