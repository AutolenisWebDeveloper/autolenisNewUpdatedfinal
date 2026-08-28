import { requirePermission } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
import { adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { startImpersonation } from "@/lib/services/admin/admin-support.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ targetUserId: z.string(), reason: z.string().min(10) });

export async function POST(request: NextRequest) {
  const admin = await requirePermission(request, "support.impersonate");
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  // Ruled policies 1 and 4 (see lib/auth/permissions.ts): SUPPORT_ADMIN holds
  // "no impersonation grant", and impersonation is "one narrow role only".
  // PERMISSION_ROLES["support.impersonate"] encodes that as SUPER-only; this
  // inline check is what actually enforces while requirePermission() is in
  // shadow mode, so it must match. lib/auth/__tests__/admin-ui-roles.test.ts
  // pins route, mirror and policy together — they diverged once and
  // SUPPORT_ADMIN silently held a grant the owner had withheld.
  if (admin.role !== "SUPER_ADMIN") return adminError("FORBIDDEN", "SUPER_ADMIN required", 403);
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
