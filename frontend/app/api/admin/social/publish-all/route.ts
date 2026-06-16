// POST /api/admin/social/publish-all
// One-click cross-platform publishing: takes a source post and publishes
// platform-optimized versions to every selected platform, with optional viral
// rewriting and a configurable scheduling strategy.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface PublishAllBody {
  sourcePostId: string;
  platforms?: string[];
  useViralOptimizer?: boolean;
  schedulingStrategy?: "immediate" | "optimal" | "staggered";
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const body: PublishAllBody = await request.json().catch(() => ({}) as PublishAllBody);
  const {
    sourcePostId,
    platforms = ["tiktok", "instagram", "facebook", "youtube", "linkedin"],
    useViralOptimizer = true,
    schedulingStrategy = "staggered",
  } = body;

  if (!sourcePostId) {
    return adminError("BAD_REQUEST", "sourcePostId is required", 400);
  }

  const source = await prisma.socialPost.findUnique({
    where: { id: sourcePostId },
    include: { franchise: true },
  });
  if (!source) return adminError("NOT_FOUND", "Post not found", 404);

  const STAGGER_DELAYS: Record<string, number> = {
    tiktok: 0,
    instagram: 2 * 60 * 60 * 1000,
    facebook: 4 * 60 * 60 * 1000,
    youtube: 8 * 60 * 60 * 1000,
    linkedin: 24 * 60 * 60 * 1000,
  };

  const PLATFORM_CAPTION_LIMITS: Record<string, number> = {
    tiktok: 150,
    instagram: 2200,
    facebook: 63206,
    youtube: 5000,
    linkedin: 3000,
  };

  const { buildViralHashtags } = await import("@/lib/social/hashtag-builder");
  const { getOrFetchTrendingData } = await import(
    "@/lib/social/trending-intelligence.engine"
  );
  const { buildUtmUrl } = await import("@/lib/social/config");

  const trending = await getOrFetchTrendingData().catch(() => null);

  // Optionally get AI-optimized versions for each platform.
  let optimizedVersions: Record<string, { hook: string; caption: string }> = {};

  if (useViralOptimizer && process.env.GROQ_API_KEY) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/social/analytics/viral-optimize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: request.headers.get("cookie") ?? "",
          },
          body: JSON.stringify({
            postId: sourcePostId,
            targetPlatforms: platforms,
          }),
        },
      );
      const data = await res.json();
      optimizedVersions = data?.data?.optimizedVersions ?? {};
    } catch {
      logger.info("[publish-all] viral optimizer unavailable, using original");
    }
  }

  const now = new Date();
  const created: { platform: string; postId: string; scheduledAt: Date }[] = [];
  const failed: { platform: string; error: string }[] = [];

  for (const platform of platforms) {
    try {
      const optimized = optimizedVersions[platform];
      const hook = optimized?.hook ?? source.hook;
      const rawCaption = optimized?.caption ?? source.caption;
      const captionLimit = PLATFORM_CAPTION_LIMITS[platform] ?? 2200;
      const caption = rawCaption.slice(0, captionLimit);

      const hashtags = buildViralHashtags({
        platform,
        franchise: source.franchise?.slug ?? "",
        make: source.make,
        metro: source.metro,
        trendingHashtags: trending?.tiktokHashtags ?? [],
      });

      const trackedUrl = buildUtmUrl({
        path: source.funnelDestination ?? "/request-a-car",
        platform,
        franchise: source.franchise?.slug ?? "dealer_secret_daily",
        hookType: source.hookType ?? "cross_platform",
        contentType: `${platform}_cross`,
      });

      // Compute schedule time.
      let scheduledAt: Date;
      if (schedulingStrategy === "immediate") {
        scheduledAt = now;
      } else if (schedulingStrategy === "staggered") {
        scheduledAt = new Date(now.getTime() + (STAGGER_DELAYS[platform] ?? 0));
      } else {
        // "optimal" — use next optimal posting window (staggered fallback).
        scheduledAt = new Date(now.getTime() + (STAGGER_DELAYS[platform] ?? 0));
      }

      const post = await prisma.socialPost.create({
        data: {
          platform,
          franchiseId: source.franchiseId,
          contentType:
            platform === "tiktok"
              ? "tiktok_video"
              : platform === "instagram"
                ? "instagram_reel"
                : platform === "youtube"
                  ? "youtube_short"
                  : `${platform}_post`,
          hookType: source.hookType,
          hook,
          script: caption,
          caption,
          hashtags,
          ctaText: source.ctaText,
          visualPrompt: source.visualPrompt,
          voiceoverText: source.voiceoverText,
          onScreenText: source.onScreenText,
          durationSeconds: source.durationSeconds,
          geoTarget: source.geoTarget,
          make: source.make,
          metro: source.metro,
          funnelDestination: source.funnelDestination,
          status: "APPROVED",
          automationMode: "CROSS_PLATFORM",
          requiresReview: false,
          scheduledAt,
          utmSource: platform,
          utmMedium: useViralOptimizer ? "social_optimized" : "social_cross",
          utmCampaign: `${source.franchise?.slug ?? "cross"}_${
            useViralOptimizer ? "optimized" : "cross"
          }`,
          trackedUrl,
        },
      });

      created.push({ platform, postId: post.id, scheduledAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ platform, error: msg });
      logger.error("[publish-all] failed for platform:", platform, msg);
    }
  }

  // Trigger image generation for all new posts.
  if (process.env.OPENAI_API_KEY && created.length > 0) {
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/admin/social/generate-images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    }).catch(() => {});
  }

  return adminSuccess({
    created,
    failed,
    total: created.length,
    schedulingStrategy,
    viralOptimized:
      useViralOptimizer && Object.keys(optimizedVersions).length > 0,
    message: `Published to ${created.length} platforms. ${failed.length} failed.`,
  });
}
