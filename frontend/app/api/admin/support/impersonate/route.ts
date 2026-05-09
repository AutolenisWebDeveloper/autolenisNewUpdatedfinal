import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { startImpersonation } from "@/lib/services/admin/admin-support.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ targetUserId: z.string(), reason: z.string().min(10) });

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (admin.role !== "SUPER_ADMIN" && admin.role !== "SUPPORT_ADMIN") return adminError("FORBIDDEN", "Insufficient permissions", 403);
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
