// POST /api/admin/social/generate-video-single
// Kicks off image-to-video generation for one specific post that already has a
// generated still image (thumbnailUrl). Uses the configured video provider
// (Higgsfield) which transitions the SocialVideo to VIDEO_GENERATING; the
// social-video-queue cron then polls it to completion.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { getVideoProvider } from "@/lib/social/providers/video-generation.factory";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: { postId?: string };
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const { postId } = body;
  if (!postId) return adminError("VALIDATION_ERROR", "postId required", 400);

  const socialVideo = await prisma.socialVideo.findFirst({
    where: { postId, thumbnailUrl: { not: null } },
    include: { post: { include: { franchise: true } } },
  });

  if (!socialVideo?.thumbnailUrl) {
    return adminError("VALIDATION_ERROR", "No image found for this post — generate image first", 400);
  }

  const provider = getVideoProvider();
  const result = await provider.submitJob({
    postId: socialVideo.postId,
    visualPrompt: socialVideo.visualPrompt ?? socialVideo.post.hook,
    durationSeconds: socialVideo.durationSeconds ?? socialVideo.post.durationSeconds ?? 15,
    style: socialVideo.style ?? undefined,
  });

  if (!result.success) {
    return adminError("GENERATION_FAILED", result.error ?? "Video generation failed", 502);
  }

  return adminSuccess({
    providerJobId: result.providerJobId ?? null,
    message: "Video generation started",
  });
}
