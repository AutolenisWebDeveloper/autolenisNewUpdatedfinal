// PATCH /api/admin/social/posts/[postId]/reschedule
// Updates a post's scheduled time and re-approves it so it can re-enter the
// publishing queue (e.g. recover a previously failed post).

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  let body: { scheduledAt?: string };
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const { scheduledAt } = body;
  if (!scheduledAt) return adminError("VALIDATION_ERROR", "scheduledAt required", 400);

  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return adminError("VALIDATION_ERROR", "scheduledAt is not a valid date", 400);
  }

  const existing = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!existing) return adminError("NOT_FOUND", "Post not found", 404);

  const post = await prisma.socialPost.update({
    where: { id: postId },
    data: { scheduledAt: when, status: "APPROVED" },
  });

  await createAuditLog(admin, request, {
    action: "SOCIAL_POST_RESCHEDULE",
    entityType: "SocialPost",
    entityId: postId,
    metadata: { scheduledAt: when.toISOString() },
    previousState: { status: existing.status, scheduledAt: existing.scheduledAt?.toISOString() ?? null },
    newState: { status: post.status, scheduledAt: post.scheduledAt?.toISOString() ?? null },
  });

  return adminSuccess({ post, message: "Post rescheduled" });
}
