// POST /api/admin/social/posts/[postId]/repost
// Creates a new post based on an existing one, with optional overrides for
// platform (cross-platform repurpose), scheduling, or content. Fresh UTM
// tracking + hashtags are generated for the new post.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { postId } = await params;

  const {
    platform,        // override platform (for cross-platform)
    scheduledAt,     // new schedule time
    hook,            // optional content override
    caption,         // optional content override
    hashtags,        // optional hashtag override
    isOptimized,     // flag: came from viral optimizer
  } = await request.json().catch(() => ({}));

  const original = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { franchise: true },
  });
  if (!original) return adminError("NOT_FOUND", "Post not found", 404);

  const targetPlatform = platform ?? original.platform;

  // Build UTM URL for the repost
  const { buildUtmUrl } = await import("@/lib/social/config");
  const trackedUrl = buildUtmUrl({
    path: original.funnelDestination ?? "/request-a-car",
    platform: targetPlatform,
    franchise: original.franchise?.slug ?? "dealer_secret_daily",
    hookType: original.hookType ?? "repost",
    contentType: `${targetPlatform}_repost`,
  });

  // Build hashtags
  const { buildViralHashtags } = await import("@/lib/social/hashtag-builder");
  const { getOrFetchTrendingData } = await import(
    "@/lib/social/trending-intelligence.engine"
  );
  const trending = await getOrFetchTrendingData().catch(() => null);
  const freshHashtags = hashtags ?? buildViralHashtags({
    platform: targetPlatform,
    franchise: original.franchise?.slug ?? "",
    make: original.make,
    metro: original.metro,
    trendingHashtags: trending?.tiktokHashtags ?? [],
  });

  const newPost = await prisma.socialPost.create({
    data: {
      platform: targetPlatform,
      franchiseId: original.franchiseId,
      contentType: original.contentType,
      hookType: original.hookType,
      hook: hook ?? original.hook,
      script: caption ?? original.script,
      caption: caption ?? original.caption,
      hashtags: freshHashtags,
      ctaText: original.ctaText,
      visualPrompt: original.visualPrompt,
      voiceoverText: original.voiceoverText,
      onScreenText: original.onScreenText,
      durationSeconds: original.durationSeconds,
      geoTarget: original.geoTarget,
      make: original.make,
      metro: original.metro,
      funnelDestination: original.funnelDestination,
      status: "APPROVED",
      automationMode: isOptimized ? "VIRAL_OPTIMIZED" : "MANUAL_REPOST",
      requiresReview: false,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      utmSource: targetPlatform,
      utmMedium: isOptimized ? "social_optimized" : "social_repost",
      utmCampaign: `${original.franchise?.slug ?? "repost"}_repost`,
      trackedUrl,
    },
  });

  // Trigger image generation for the new post (fire and forget).
  if (process.env.OPENAI_API_KEY) {
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/admin/social/generate-images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    }).catch(() => {});
  }

  return adminSuccess({
    post: newPost,
    message: `Post ${isOptimized ? "optimized and" : ""} reposted to ${targetPlatform}`,
  });
}
