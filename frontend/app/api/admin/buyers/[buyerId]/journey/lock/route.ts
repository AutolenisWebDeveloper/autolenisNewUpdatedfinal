import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }
const schema = z.object({ stageIds: z.array(z.string()).min(1) });

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);
  }

  const { buyerId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", "Invalid input", 400);

  await prisma.adminJourneyUnlock.deleteMany({
    where: { buyerId, stageId: { in: parsed.data.stageIds } },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_JOURNEY_RELOCK_STAGES",
      entityType: "Buyer",
      entityId: buyerId,
      metadata: { stageIds: parsed.data.stageIds },
    },
  }).catch(() => {});

  return adminSuccess({ lockedCount: parsed.data.stageIds.length });
}
