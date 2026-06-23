// POST /api/admin/social/buffer/posts/[postId]/duplicate
// Duplicates a Buffer post (same channel, same text + media) as a new queued or
// scheduled post. Body: { scheduledAt?: string } — omit to add to the queue.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { duplicateBufferPost } from "@/lib/social/providers/buffer.provider";

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const body = (await request.json().catch(() => ({}))) as { scheduledAt?: string };
  let dueAtIso: string | undefined;
  if (body.scheduledAt) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) return adminError("INVALID_INPUT", "scheduledAt is not a valid date", 400);
    dueAtIso = d.toISOString();
  }

  const result = await duplicateBufferPost(postId, { dueAtIso });
  if (!result.success) {
    const notConfigured = /not configured/i.test(result.error ?? "");
    return adminError(
      notConfigured ? "BUFFER_NOT_CONFIGURED" : "BUFFER_DUPLICATE_FAILED",
      result.error ?? "Failed to duplicate Buffer post",
      notConfigured ? 409 : 502,
    );
  }

  await createAuditLog(admin, request, {
    action: "SOCIAL_BUFFER_POST_DUPLICATE",
    entityType: "BufferPost",
    entityId: postId,
    metadata: { newPostId: result.id ?? null, scheduled: Boolean(dueAtIso) },
  });

  return adminSuccess({ id: result.id ?? null, status: result.status ?? null, duplicatedFrom: postId });
}
