// POST /api/admin/buyers/[buyerId]/note
// Add an internal support note to a buyer's record.
// Uses AdminSupportNote table. Admin identity logged.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { SupportNoteType } from "@prisma/client";
import { addSupportNote } from "@/lib/services/admin/admin-support.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  content: z.string().min(1, "Note content is required").max(2000),
  type: z.nativeEnum(SupportNoteType).default(SupportNoteType.GENERAL),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { userId: true },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const note = await addSupportNote(admin.adminId, buyer.userId, parsed.data.content, parsed.data.type);

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_NOTE_ADDED",
      entityType: "Buyer",
      entityId: buyerId,
      metadata: { noteId: note.id, type: parsed.data.type },
    },
  });

  return adminSuccess({ note: { id: note.id, content: note.content, type: note.type, createdAt: note.createdAt.toISOString() } }, 201);
}
