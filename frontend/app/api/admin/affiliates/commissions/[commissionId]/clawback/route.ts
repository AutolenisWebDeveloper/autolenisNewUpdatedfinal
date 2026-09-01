// POST /api/admin/affiliates/commissions/[commissionId]/clawback
// Claws back a commission by creating an OFFSETTING (negative) Commission
// record. The original record is never modified. Affiliate is notified.
// Requires reason (min 10 chars). FINANCE_ADMIN or SUPER_ADMIN only.

import { requirePermissionStrict } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { clawbackCommission } from "@/lib/services/admin/admin-affiliate-command-center.service";

interface Props { params: Promise<{ commissionId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});


export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const adminCheck = await requirePermissionStrict(request, "finance.commissions.reverse");
  // Enforced directly (not via the shadow flag): this route had no role
  // check at all, so every authenticated admin could reach it.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;
  // Role check lives in the gate above, derived from PERMISSION_ROLES
  // ("finance.commissions.*" = SUPER_ADMIN, FINANCE_ADMIN). A second hardcoded
  // set here would be a copy that can silently drift from the matrix — which is
  // exactly how the impersonation routes came to disagree with it.

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await clawbackCommission(commissionId, admin.adminId, admin.email, parsed.data.reason);
    return adminSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clawback failed";
    const status = message.includes("not found") ? 404 : 400;
    return adminError("ACTION_FAILED", message, status);
  }
}
