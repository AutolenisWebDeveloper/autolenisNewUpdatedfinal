// POST /api/admin/social/posts/[postId]/publish
// Queues a post for immediate publishing by setting its scheduled time to now,
// re-approving it, and clearing any prior publish error / attempt count so the
// publishing-queue cron picks it up on its next run.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const existing = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!existing) return adminError("NOT_FOUND", "Post not found", 404);

  const post = await prisma.socialPost.update({
    where: { id: postId },
    data: {
      scheduledAt: new Date(),
      status: "APPROVED",
      publishError: null,
      publishAttempts: 0,
    },
  });

  await createAuditLog(admin, request, {
    action: "SOCIAL_POST_PUBLISH_NOW",
    entityType: "SocialPost",
    entityId: postId,
    metadata: { platform: existing.platform },
    previousState: { status: existing.status },
    newState: { status: post.status },
  });

  return adminSuccess({ post, message: "Post queued for immediate publishing" });
}
