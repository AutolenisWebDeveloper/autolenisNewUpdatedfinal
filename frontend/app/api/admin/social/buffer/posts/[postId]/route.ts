// PATCH  /api/admin/social/buffer/posts/[postId]  — edit text and/or reschedule
// DELETE /api/admin/social/buffer/posts/[postId]  — delete the Buffer post
//
// Both operate directly on the Buffer GraphQL API and keep the local SocialPost
// row (when one is linked by platformPostId) in sync so the dashboard reflects
// the change immediately.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { editBufferPost, deleteBufferPost } from "@/lib/social/providers/buffer.provider";

export const maxDuration = 30;

interface PatchBody {
  text?: string;
  // ISO instant to reschedule to. Sending this switches the post to
  // customScheduled mode in Buffer.
  scheduledAt?: string;
  mode?: "customScheduled" | "shareNow" | "addToQueue" | "shareNext";
}

async function findLocal(platformPostId: string) {
  return prisma.socialPost
    .findFirst({ where: { platformPostId }, select: { id: true, status: true } })
    .catch(() => null);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  if (body.text === undefined && body.scheduledAt === undefined && body.mode === undefined) {
    return adminError("INVALID_INPUT", "Provide text, scheduledAt, or mode to update", 400);
  }

  let dueAtIso: string | undefined;
  if (body.scheduledAt) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) return adminError("INVALID_INPUT", "scheduledAt is not a valid date", 400);
    dueAtIso = d.toISOString();
  }

  const result = await editBufferPost({ id: postId, text: body.text, dueAtIso, mode: body.mode });
  if (!result.success) {
    const notConfigured = /not configured/i.test(result.error ?? "");
    return adminError(
      notConfigured ? "BUFFER_NOT_CONFIGURED" : "BUFFER_EDIT_FAILED",
      result.error ?? "Failed to edit Buffer post",
      notConfigured ? 409 : 502,
    );
  }

  // Keep a linked local row in sync (reschedule + caption edit are the fields a
  // local SocialPost mirrors).
  const local = await findLocal(postId);
  if (local) {
    await prisma.socialPost
      .update({
        where: { id: local.id },
        data: {
          ...(body.text !== undefined ? { caption: body.text } : {}),
          ...(dueAtIso ? { scheduledAt: new Date(dueAtIso) } : {}),
        },
      })
      .catch((err: unknown) => logger.error("[buffer:edit] local sync failed:", err));
  }

  await createAuditLog(admin, request, {
    action: "SOCIAL_BUFFER_POST_EDIT",
    entityType: "BufferPost",
    entityId: postId,
    metadata: { text: body.text !== undefined, rescheduled: Boolean(dueAtIso), mode: body.mode ?? null, localPostId: local?.id ?? null },
  });

  return adminSuccess({ id: result.id ?? postId, status: result.status ?? null, localPostId: local?.id ?? null });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const result = await deleteBufferPost(postId);
  if (!result.success) {
    const notConfigured = /not configured/i.test(result.error ?? "");
    return adminError(
      notConfigured ? "BUFFER_NOT_CONFIGURED" : "BUFFER_DELETE_FAILED",
      result.error ?? "Failed to delete Buffer post",
      notConfigured ? 409 : 502,
    );
  }

  // Reflect the deletion locally: a linked, not-yet-published post is marked
  // SKIPPED so it never re-publishes; we never hard-delete the local audit row.
  const local = await findLocal(postId);
  if (local && local.status !== "PUBLISHED") {
    await prisma.socialPost
      .update({ where: { id: local.id }, data: { status: "SKIPPED", platformPostId: null } })
      .catch((err: unknown) => logger.error("[buffer:delete] local sync failed:", err));
  }

  await createAuditLog(admin, request, {
    action: "SOCIAL_BUFFER_POST_DELETE",
    entityType: "BufferPost",
    entityId: postId,
    metadata: { localPostId: local?.id ?? null },
  });

  return adminSuccess({ id: result.id ?? postId, deleted: true, localPostId: local?.id ?? null });
}
