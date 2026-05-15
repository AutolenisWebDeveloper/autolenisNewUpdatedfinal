// POST /api/admin/buyers/[buyerId]/journey/skip
// Admin bypasses a non-critical stage. Counts as complete for journey progression.
// Only non-critical stages can be skipped (prequal, search, shortlist, financing, insurance).

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const SKIPPABLE = ["prequal", "search", "shortlist", "financing", "insurance"] as const;

const schema = z.object({
  stageId: z.string().refine(
    s => (SKIPPABLE as readonly string[]).includes(s),
    { message: `Only skippable stages: ${SKIPPABLE.join(", ")}` }
  ),
  reason: z.string().min(1, "Reason is required for a skip override"),
  note: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);
  }

  const { buyerId } = await params;
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  const { stageId, reason, note } = parsed.data;

  // AdminJourneyUnlock has only a single `note` column. Store reason there,
  // appending the optional supplementary note when provided.
  const combinedNote = note ? `${reason} — ${note}` : reason;

  await prisma.adminJourneyUnlock.upsert({
    where: { buyerId_stageId: { buyerId, stageId } },
    create: { buyerId, stageId, type: "SKIP", adminId: admin.adminId, adminEmail: admin.email, note: combinedNote },
    update: { type: "SKIP", adminId: admin.adminId, adminEmail: admin.email, note: combinedNote, createdAt: new Date() },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_JOURNEY_STAGE_SKIPPED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { stageId, note: note ?? null },
    },
  }).catch(() => {});

  return adminSuccess({ stageId, skipped: true });
}
