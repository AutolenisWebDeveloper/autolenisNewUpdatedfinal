import { requirePermissionStrict } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { endImpersonation } from "@/lib/services/admin/admin-support.service";

interface Props { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { id: impersonationId } = await params;
  // OWNER RULING (policy 4): impersonation is the highest-trust admin action —
  // full buyer PII and financials, acting AS the buyer — so it takes the
  // NARROWEST role. This previously admitted SUPPORT_ADMIN as well, which
  // contradicted PERMISSION_ROLES["support.impersonate"] = SUPER_ADMIN; shadow
  // mode meant the route's wider list won and support could impersonate. The
  // role now comes from the matrix alone, so the two cannot disagree again.
  const adminCheck = await requirePermissionStrict(request, "support.impersonate");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;
  try {
    await endImpersonation(impersonationId);
    await createAuditLog(admin, request, {
      action: "USER_IMPERSONATION_ENDED",
      entityType: "AdminImpersonation",
      entityId: impersonationId,
      reason: "Admin ended impersonation session",
    }).catch(err => logger.error("[impersonation/end] audit log failed:", err));
    return adminSuccess({ ended: true, impersonationId });
  } catch (err) {
    return adminError("END_FAILED", err instanceof Error ? err.message : "Failed to end impersonation", 400);
  }
}
