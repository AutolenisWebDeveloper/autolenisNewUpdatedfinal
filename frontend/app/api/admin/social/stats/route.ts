// GET /api/admin/social/stats
// Dashboard summary: post counts by status, video counts by status, aggregate
// performance, and the current top franchise / hook / platform by lead score.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  // The social tables are provisioned via a manual Supabase migration that may
  // not be applied in every environment. If any model/table is missing the
  // queries throw — return zeroed-out stats instead of a 500 so the dashboard
  // still renders.
  const empty = {
    posts: { draft: 0, pending: 0, approved: 0, scheduled: 0, published: 0, failed: 0 },
    videos: { queued: 0, generating: 0, ready: 0, failed: 0 },
    performance: { totalReach: 0, totalClicks: 0, totalRequests: 0, totalLeadScore: 0 },
    topFranchise: "—",
    topHook: "—",
    topPlatform: "—",
    revenue: {
      totalCents: 0,
      dealsWon: 0,
      byFranchise: [] as { franchise: string; revenueCents: number }[],
      byPlatform: [] as { platform: string; revenueCents: number }[],
      topPost: null as { hook: string; revenueCents: number } | null,
    },
  };

  try {
    const [postGroups, videoGroups, perfAgg, topFranchise, topHook, platformGroups] = await Promise.all([
      prisma.socialPost.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.socialVideo.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.socialPerformance.aggregate({
        _sum: { reach: true, linkClicks: true, vehicleRequests: true, leadScore: true },
      }),
      prisma.contentFranchise.findFirst({ where: { avgLeadScore: { not: null } }, orderBy: { avgLeadScore: "desc" }, select: { name: true } }),
      prisma.hookPerformance.findFirst({ orderBy: { avgLeadScore: "desc" }, select: { hookType: true } }),
      prisma.socialPost.groupBy({ by: ["platform"], _sum: { leadScore: true }, orderBy: { _sum: { leadScore: "desc" } }, take: 1 }),
    ]);

    const postCount = (s: string) => postGroups.find((g) => g.status === s)?._count._all ?? 0;
    const videoCount = (s: string) => videoGroups.find((g) => g.status === s)?._count._all ?? 0;

    // Revenue attribution stats (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const revenueStats = await prisma.revenueAttribution
      .findMany({
        where: {
          attributionStatus: "DEAL_WON",
          dealWonAt: { gte: sevenDaysAgo },
        },
        include: {
          post: {
            select: {
              hook: true,
              platform: true,
              franchise: { select: { slug: true } },
              metro: true,
            },
          },
        },
      })
      .catch(() => []);

    const totalRevenueCents = revenueStats.reduce(
      (sum, r) => sum + (r.totalRevenueCents ?? 0),
      0,
    );

    // Group by franchise
    const byFranchise = revenueStats.reduce<Record<string, number>>((acc, r) => {
      const slug = r.post?.franchise?.slug ?? "unknown";
      acc[slug] = (acc[slug] ?? 0) + (r.totalRevenueCents ?? 0);
      return acc;
    }, {});

    // Group by platform
    const byPlatform = revenueStats.reduce<Record<string, number>>((acc, r) => {
      const platform = r.post?.platform ?? "unknown";
      acc[platform] = (acc[platform] ?? 0) + (r.totalRevenueCents ?? 0);
      return acc;
    }, {});

    // Find top post
    const topPostData = revenueStats.reduce<{ hook: string; cents: number } | null>(
      (top, r) => {
        if ((r.totalRevenueCents ?? 0) > (top?.cents ?? 0)) {
          return {
            hook: r.post?.hook?.slice(0, 60) ?? "",
            cents: r.totalRevenueCents ?? 0,
          };
        }
        return top;
      },
      null,
    );

    const revenue = {
      totalCents: totalRevenueCents,
      dealsWon: revenueStats.length,
      byFranchise: Object.entries(byFranchise)
        .map(([franchise, cents]) => ({ franchise, revenueCents: cents }))
        .sort((a, b) => b.revenueCents - a.revenueCents),
      byPlatform: Object.entries(byPlatform)
        .map(([platform, cents]) => ({ platform, revenueCents: cents }))
        .sort((a, b) => b.revenueCents - a.revenueCents),
      topPost: topPostData
        ? { hook: topPostData.hook, revenueCents: topPostData.cents }
        : null,
    };

    return adminSuccess({
      posts: {
        draft: postCount("DRAFT"),
        pending: postCount("PENDING_REVIEW"),
        approved: postCount("APPROVED"),
        scheduled: postCount("SCHEDULED"),
        published: postCount("PUBLISHED"),
        failed: postCount("FAILED"),
      },
      videos: {
        queued: videoCount("VIDEO_QUEUED"),
        generating: videoCount("VIDEO_GENERATING"),
        ready: videoCount("VIDEO_READY"),
        failed: videoCount("VIDEO_FAILED"),
      },
      performance: {
        totalReach: perfAgg._sum.reach ?? 0,
        totalClicks: perfAgg._sum.linkClicks ?? 0,
        totalRequests: perfAgg._sum.vehicleRequests ?? 0,
        totalLeadScore: perfAgg._sum.leadScore ?? 0,
      },
      topFranchise: topFranchise?.name ?? "—",
      topHook: topHook?.hookType ?? "—",
      topPlatform: platformGroups[0]?.platform ?? "—",
      revenue,
    });
  } catch (err) {
    console.error("[admin/social] stats query failed:", err);
    return adminSuccess(empty);
  }
}
