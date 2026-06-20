// AutoLenis Social Engine — Content Recycling Engine (Session C, Gap 9).
//
// Re-publishes top-performing evergreen posts from 90-180 days ago with fresh,
// currently-trending hashtags. Proven content keeps working long after its first
// run; recycling the highest lead-score posts squeezes more reach out of the
// catalog without spending another Groq generation.

import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildViralHashtags } from "@/lib/social/hashtag-builder";
import { AUTO_PUBLISH_FRANCHISES } from "@/lib/social/config";
import { getOrFetchTrendingData } from "@/lib/social/trending-intelligence.engine";

// A published post with its franchise relation — the shape both functions share.
type RecyclablePost = Prisma.SocialPostGetPayload<{
  include: { franchise: true };
}>;

export async function findRecyclablePosts(): Promise<RecyclablePost[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  // Get all posts in the recycling window.
  const posts = await prisma.socialPost.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: {
        gte: oneEightyDaysAgo,
        lte: ninetyDaysAgo,
      },
    },
    include: { franchise: true },
    orderBy: { leadScore: "desc" },
    take: 50,
  });

  // Return top 10% by lead score.
  const threshold =
    posts.length > 0
      ? posts[Math.floor(posts.length * 0.1)]?.leadScore ?? 0
      : 0;

  return posts.filter((p) => p.leadScore >= threshold).slice(0, 10);
}

export async function recyclePost(
  post: RecyclablePost,
): Promise<{ id: string } | null> {
  try {
    const trending = await getOrFetchTrendingData().catch(() => null);
    const freshHashtags = buildViralHashtags({
      platform: post.platform,
      franchise: post.franchise?.slug ?? "",
      make: post.make,
      metro: post.metro,
      trendingHashtags: trending?.tiktokHashtags ?? [],
    });

    // Get the best posting slot.
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days out

    // Determine status based on franchise review requirement. Use the single
    // canonical allowlist from config — a divergent local copy here previously
    // let two extra franchises (dealer_growth, market_stats_dealer) auto-publish
    // recycled content without review, a compliance gap.
    const franchise = post.franchise?.slug ?? "";
    const isAutoPublish = AUTO_PUBLISH_FRANCHISES.includes(franchise);
    const status = isAutoPublish ? "APPROVED" : "PENDING_REVIEW";

    const recycled = await prisma.socialPost.create({
      data: {
        platform: post.platform,
        contentType: post.contentType,
        hookType: post.hookType,
        hook: post.hook,
        script: post.script,
        caption: post.caption,
        hashtags: freshHashtags,
        ctaText: post.ctaText,
        ctaPlacement: post.ctaPlacement,
        visualPrompt: post.visualPrompt,
        visualStyle: post.visualStyle,
        voiceoverText: post.voiceoverText,
        onScreenText: post.onScreenText,
        durationSeconds: post.durationSeconds,
        geoTarget: post.geoTarget,
        make: post.make,
        metro: post.metro,
        funnelDestination: post.funnelDestination,
        complianceNotes: post.complianceNotes,
        requiresReview: !isAutoPublish,
        automationMode: "HYBRID_AUTO",
        status,
        scheduledAt,
        // Preserve the franchise linkage from the source post so recycled posts
        // remain indexable by franchise (previously orphaned with null).
        franchiseId: post.franchiseId,
        utmSource: post.platform,
        utmMedium: "social_recycled",
        utmCampaign: `${franchise}_recycled`,
        utmContent: franchise,
        utmHook: post.hookType ?? "recycled",
        utmPlatform: post.platform,
      },
    });

    logger.info(
      `[recycle] recycled post ${post.id} → new post ${recycled.id}`,
      `(leadScore: ${post.leadScore}, fresh hashtags: ${freshHashtags.length})`,
    );

    return { id: recycled.id };
  } catch (err) {
    logger.error("[recycle] failed for post:", post.id, err);
    return null;
  }
}
