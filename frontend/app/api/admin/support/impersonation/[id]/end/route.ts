import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { endImpersonation } from "@/lib/services/admin/admin-support.service";

interface Props { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { id: impersonationId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (admin.role !== "SUPER_ADMIN" && admin.role !== "SUPPORT_ADMIN") {
    return adminError("FORBIDDEN", "Insufficient permissions", 403);
  }
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
