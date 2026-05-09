// GET  /api/admin/deals/[dealId]/notes — returns all notes ordered by createdAt desc
// POST /api/admin/deals/[dealId]/notes — adds a new note
// Body: { content: string (min 10 chars) }
// Creates DealNote with dealId, adminId, adminEmail from session, content
// Writes AuditLog: DEAL_NOTE_ADDED
// Note content IS the reason — no separate reason field required

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ dealId: string }> }

const postSchema = z.object({
  content: z.string().min(10, "Note must be at least 10 characters"),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  const notes = await prisma.dealNote.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
  });

  return adminSuccess({ notes });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { content } = parsed.data;

  const note = await prisma.dealNote.create({
    data: {
      dealId,
      adminId: admin.adminId,
      adminEmail: admin.email,
      content,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEAL_NOTE_ADDED",
      entityType: "Deal",
      entityId: dealId,
      reason: content,
      metadata: { noteId: note.id },
    },
  });

  return adminSuccess({ note }, 201);
}
