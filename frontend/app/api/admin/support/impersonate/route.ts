import { requirePermissionStrict } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
import { adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { startImpersonation } from "@/lib/services/admin/admin-support.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ targetUserId: z.string(), reason: z.string().min(10) });

export async function POST(request: NextRequest) {
  // OWNER RULING (policy 4): impersonation is the highest-trust admin action —
  // full buyer PII and financials, acting AS the buyer — so it takes the
  // NARROWEST role. This previously admitted SUPPORT_ADMIN as well, which
  // contradicted PERMISSION_ROLES["support.impersonate"] = SUPER_ADMIN; shadow
  // mode meant the route's wider list won and support could impersonate. The
  // role now comes from the matrix alone, so the two cannot disagree again.
  const adminCheck = await requirePermissionStrict(request, "support.impersonate");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const session = await startImpersonation(admin.adminId, parsed.data.targetUserId, parsed.data.reason);

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "USER_IMPERSONATION_STARTED",
      entityType: "User",
      entityId: parsed.data.targetUserId,
      reason: parsed.data.reason,
      ipAddress: getClientIp(request),
      metadata: { impersonationSessionId: session.id },
    },
  });

  return adminSuccess({ session }, 201);
}
