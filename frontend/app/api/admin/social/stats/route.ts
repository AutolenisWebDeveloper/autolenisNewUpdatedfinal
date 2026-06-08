// GET /api/admin/social/stats
// Dashboard summary: post counts by status, video counts by status, aggregate
// performance, and the current top franchise / hook / platform by lead score.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

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
  });
}
