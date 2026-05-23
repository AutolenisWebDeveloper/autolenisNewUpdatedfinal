// POST /api/admin/buyers/[buyerId]/journey/note
// Adds an internal admin note to a specific journey stage.
// Notes are visible to admins only — never shown to the buyer.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  stageId: z.string().min(1),
  content: z.string().min(1).max(2000),
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
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  const note = await prisma.adminJourneyNote.create({
    data: {
      buyerId,
      stageId: parsed.data.stageId,
      content: parsed.data.content,
      adminId: admin.adminId,
      adminEmail: admin.email,
    },
  });

  await createAuditLog(admin, request, {
    action: "BUYER_JOURNEY_NOTE_ADDED",
    entityType: "Buyer",
    entityId: buyerId,
    metadata: { stageId: parsed.data.stageId, noteId: note.id, contentLength: parsed.data.content.length },
  });

  return adminSuccess({ noteId: note.id, stageId: parsed.data.stageId }, 201);
}
