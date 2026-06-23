// POST /api/admin/social/posts/[postId]/publish
// Publishes a post to its social platform from the admin dashboard.
//
// Two modes (body: { direct?: boolean }, default direct = true):
//   • direct  — publishes synchronously via the publishing provider and returns
//     the live outcome (PUBLISHED + platformPostId, or FAILED + error). This is
//     the "post directly to social media" path the dashboard uses.
//   • queued  — only re-approves the post and sets its scheduled time to now so
//     the publishing-queue cron picks it up on its next run (legacy behaviour).

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { publishApprovedPost } from "@/lib/social/social-post.orchestrator";

// Publishing to a live platform can take a while (media upload + provider call).
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  // direct defaults to true: a Publish Now click should actually post.
  const body = await request.json().catch(() => ({} as { direct?: boolean }));
  const direct = body?.direct !== false;

  const existing = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!existing) return adminError("NOT_FOUND", "Post not found", 404);

  // Guard against re-publishing a post that is already in-flight or live. Without
  // this, resetting a PUBLISHING/PUBLISHED post back to APPROVED would publish it
  // a second time. Use the repost action to intentionally re-publish.
  if (existing.status === "PUBLISHING" || existing.status === "PUBLISHED") {
    return adminError(
      "INVALID_STATE",
      `Post is already ${existing.status.toLowerCase()}; use repost to publish again`,
      409,
    );
  }

  // Re-approve, clear any prior publish error, and pull the scheduled time to
  // now so the post is immediately publishable in both modes.
  const post = await prisma.socialPost.update({
    where: { id: postId },
    data: {
      scheduledAt: new Date(),
      status: "APPROVED",
      publishError: null,
      publishAttempts: 0,
    },
  });

  // ── Queued mode (legacy) — hand off to the publish-queue cron. ────────────
  if (!direct) {
    await createAuditLog(admin, request, {
      action: "SOCIAL_POST_PUBLISH_QUEUE",
      entityType: "SocialPost",
      entityId: postId,
      metadata: { platform: existing.platform, direct: false },
      previousState: { status: existing.status },
      newState: { status: post.status },
    });
    return adminSuccess({
      post,
      published: false,
      queued: true,
      status: post.status,
      message: "Post queued for immediate publishing on the next queue run",
    });
  }

  // ── Direct mode — publish synchronously to the live platform. ─────────────
  try {
    await publishApprovedPost(post);
  } catch (err) {
    logger.error(`[publish:direct] post ${postId} threw:`, err);
    // publishApprovedPost records FAILED on provider errors, but a thrown
    // exception (e.g. claim race / unexpected) won't have updated the row —
    // surface it as a failure to the caller below after re-reading state.
  }

  // Re-read the final state written by the orchestrator (PUBLISHED / SCHEDULED /
  // FAILED) so the dashboard can report the real outcome.
  const final = await prisma.socialPost.findUnique({ where: { id: postId } });
  const status = final?.status ?? "FAILED";
  const published = status === "PUBLISHED";
  const scheduled = status === "SCHEDULED";

  await createAuditLog(admin, request, {
    action: "SOCIAL_POST_PUBLISH_DIRECT",
    entityType: "SocialPost",
    entityId: postId,
    metadata: {
      platform: existing.platform,
      direct: true,
      result: status,
      platformPostId: final?.platformPostId ?? null,
    },
    previousState: { status: existing.status },
    newState: { status },
  });

  if (published || scheduled) {
    return adminSuccess({
      post: final,
      published,
      scheduled,
      status,
      platformPostId: final?.platformPostId ?? null,
      provider: final?.publishingProvider ?? null,
      message: published
        ? `Published to ${existing.platform}`
        : `Scheduled on ${existing.platform}`,
    });
  }

  // Failed — surface the provider error. The most common cause is publishing
  // being disabled / unconfigured (the no-op provider reports "publishing
  // disabled"); make that actionable for the admin.
  const publishError = final?.publishError ?? "Publishing failed";
  const disabled = /disabled/i.test(publishError);
  return adminError(
    disabled ? "PUBLISHING_DISABLED" : "PUBLISH_FAILED",
    disabled
      ? `Publishing is disabled or not configured for ${existing.platform}. ` +
          `Set ENABLE_BUFFER_PUBLISHING=true and configure a provider (Buffer / Meta / TikTok / LinkedIn) in Settings.`
      : `Failed to publish to ${existing.platform}: ${publishError}`,
    disabled ? 409 : 502,
  );
}
