import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";

interface Props { params: Promise<{ queueType: string; itemId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { queueType, itemId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { reason, escalateTo } = await request.json() as { reason: string; escalateTo?: string };
  const { prisma } = await import("@/lib/prisma");
  await prisma.adminAuditLog.create({ data: { adminId: admin.adminId, adminEmail: admin.email, action: "STATUS_CHANGE", entityType: queueType, entityId: itemId, reason, metadata: { escalateTo, escalated: true } } }).catch(() => {});
  return adminSuccess({ escalated: true, itemId });
}
