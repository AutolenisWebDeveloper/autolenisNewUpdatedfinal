// POST /api/admin/affiliates/[affiliateId]/note
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { SupportNoteType } from "@prisma/client";
import { addAffiliateAdminNote } from "@/lib/services/admin/admin-affiliate-command-center.service";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  content: z.string().min(1, "Note content is required").max(2000),
  type: z.nativeEnum(SupportNoteType).default(SupportNoteType.GENERAL),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { affiliateId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const note = await addAffiliateAdminNote(
      affiliateId,
      admin.adminId,
      admin.email,
      parsed.data.content,
      parsed.data.type
    );
    return adminSuccess(
      { note: { id: note.id, content: note.content, type: note.type, createdAt: note.createdAt.toISOString() } },
      201
    );
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Note creation failed", 400);
  }
}
