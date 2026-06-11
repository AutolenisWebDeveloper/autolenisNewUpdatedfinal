// POST /api/admin/social/analytics/sync
// Pulls analytics from the publishing provider (Buffer) for all PUBLISHED posts
// with a platformPostId in the last 30 days, records a SocialPerformance
// snapshot, and recalculates the post lead score.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { platform } = await request.json().catch(() => ({}));

  const where: Prisma.SocialPostWhereInput = {
    status: "PUBLISHED",
    platformPostId: { not: null },
    publishedAt: {
      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  };
  if (platform) where.platform = platform;

  const posts = await prisma.socialPost.findMany({
    where,
    include: { franchise: true },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });

  if (posts.length === 0) {
    return adminSuccess({
      synced: 0,
      message: "No published posts found to sync",
    });
  }

  const { getPublishingProvider } = await import(
    "@/lib/social/providers/publishing.factory"
  );

  let synced = 0;
  let failed = 0;
  const results: {
    postId: string;
    platform: string;
    metrics: Record<string, number>;
  }[] = [];

  for (const post of posts) {
    if (!post.platformPostId) continue;
    try {
      const provider = getPublishingProvider(post.platform);
      const analytics = await provider.getAnalytics(post.platformPostId);

      // leadScore formula: clicks×1 + shares×2 + impressions×0.01
      const leadScore =
        (analytics.clicks ?? 0) * 1 +
        (analytics.shares ?? 0) * 2 +
        (analytics.impressions ?? 0) * 0.01;

      await prisma.socialPerformance.create({
        data: {
          postId: post.id,
          impressions: analytics.impressions ?? 0,
          reach: analytics.reach ?? 0,
          views: analytics.views ?? analytics.impressions ?? 0,
          likes: analytics.likes ?? 0,
          comments: analytics.comments ?? 0,
          shares: analytics.shares ?? 0,
          linkClicks: analytics.clicks ?? 0,
          leadScore: Math.round(leadScore),
        },
      });

      await prisma.socialPost.update({
        where: { id: post.id },
        data: { leadScore: Math.round(leadScore) },
      });

      results.push({
        postId: post.id,
        platform: post.platform,
        metrics: {
          impressions: analytics.impressions ?? 0,
          reach: analytics.reach ?? 0,
          likes: analytics.likes ?? 0,
          comments: analytics.comments ?? 0,
          shares: analytics.shares ?? 0,
          clicks: analytics.clicks ?? 0,
        },
      });
      synced++;
    } catch (err) {
      console.error("[analytics-sync] failed:", post.id, err);
      failed++;
    }
  }

  return adminSuccess({
    synced,
    failed,
    total: posts.length,
    results: results.slice(0, 20),
    message: `Synced ${synced} posts. ${failed} failed.`,
  });
}
