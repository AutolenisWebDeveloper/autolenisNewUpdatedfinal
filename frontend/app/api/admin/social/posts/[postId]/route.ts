// /api/admin/social/posts/[postId]
//   GET   — single post with video + performance history.
//   PATCH — approve | reject | reschedule | update (script/caption).

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { approvePost, rejectPost } from "@/lib/social/social-post.orchestrator";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["approve", "reject", "reschedule", "update"]),
  rejectionReason: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  script: z.string().optional(),
  caption: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: {
      video: true,
      franchise: { select: { slug: true, name: true } },
      signal: true,
      performance: { orderBy: { recordedAt: "desc" }, take: 10 },
    },
  });
  if (!post) return adminError("NOT_FOUND", "Post not found", 404);
  return adminSuccess({ post });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const { action, rejectionReason, scheduledAt, script, caption } = parsed.data;

  const existing = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!existing) return adminError("NOT_FOUND", "Post not found", 404);

  let post;
  switch (action) {
    case "approve":
      post = await approvePost(postId);
      break;
    case "reject":
      post = await rejectPost(postId, rejectionReason ?? "Rejected by admin");
      break;
    case "reschedule":
      if (!scheduledAt) return adminError("VALIDATION_ERROR", "scheduledAt required", 400);
      post = await prisma.socialPost.update({ where: { id: postId }, data: { scheduledAt: new Date(scheduledAt) } });
      break;
    case "update":
      post = await prisma.socialPost.update({
        where: { id: postId },
        data: {
          ...(script !== undefined ? { script } : {}),
          ...(caption !== undefined ? { caption } : {}),
        },
      });
      break;
  }

  await createAuditLog(admin, request, {
    action: `SOCIAL_POST_${action.toUpperCase()}`,
    entityType: "SocialPost",
    entityId: postId,
    metadata: { action, platform: existing.platform },
    previousState: { status: existing.status },
    newState: { status: post?.status },
  });

  return adminSuccess({ post });
}
