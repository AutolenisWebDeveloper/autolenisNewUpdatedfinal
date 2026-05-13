import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const ALL_STAGE_IDS = [
  "account", "onboarding", "prequal", "search", "shortlist", "deposit",
  "auction", "select-deal", "financing", "fee", "insurance", "contract", "sign", "pickup",
];

const schema = z.object({
  stageIds:  z.array(z.string()).min(1).optional(),
  unlockAll: z.boolean().optional(),
  note:      z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { buyerId } = await params;
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const { note, unlockAll } = parsed.data;
  const stageIds = unlockAll ? ALL_STAGE_IDS : (parsed.data.stageIds ?? []);
  if (stageIds.length === 0) {
    return adminError("VALIDATION_ERROR", "Provide stageIds or set unlockAll: true", 400);
  }

  await prisma.$transaction(
    stageIds.map(stageId =>
      prisma.adminJourneyUnlock.upsert({
        where: { buyerId_stageId: { buyerId, stageId } },
        create: { buyerId, stageId, adminId: admin.adminId, adminEmail: admin.email, note: note ?? null },
        update: { adminId: admin.adminId, adminEmail: admin.email, note: note ?? null, createdAt: new Date() },
      })
    )
  );

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: unlockAll ? "BUYER_JOURNEY_UNLOCK_ALL" : "BUYER_JOURNEY_UNLOCK_STAGES",
      entityType: "Buyer",
      entityId: buyerId,
      reason: note ?? null,
      metadata: { stageIds, unlockAll: !!unlockAll },
    },
  }).catch(() => {});

  return adminSuccess({ unlockedCount: stageIds.length, stageIds });
}
