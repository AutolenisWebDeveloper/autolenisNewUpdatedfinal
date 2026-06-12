// GET /api/admin/social/ab-tests/[groupId]
// Returns a single A/B test group with its variants and the latest performance
// snapshot per variant post.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { groupId } = await params;

  const group = await prisma.aBTestGroup.findUnique({
    where: { id: groupId },
    include: { posts: { orderBy: { variantLabel: "asc" } } },
  });
  if (!group) return adminError("NOT_FOUND", "A/B test group not found", 404);

  const postIds = group.posts.map((v) => v.postId);
  const posts =
    postIds.length > 0
      ? await prisma.socialPost.findMany({
          where: { id: { in: postIds } },
          select: {
            id: true,
            hook: true,
            caption: true,
            status: true,
            platform: true,
            scheduledAt: true,
            publishedAt: true,
          },
        })
      : [];
  const postMap = new Map(posts.map((p) => [p.id, p]));

  // Latest performance snapshot per variant post.
  const performances =
    postIds.length > 0
      ? await prisma.socialPerformance.findMany({
          where: { postId: { in: postIds } },
          orderBy: { recordedAt: "desc" },
        })
      : [];
  const perfMap = new Map<string, (typeof performances)[number]>();
  for (const perf of performances) {
    if (!perfMap.has(perf.postId)) perfMap.set(perf.postId, perf);
  }

  const variants = group.posts.map((v) => {
    const post = postMap.get(v.postId);
    const perf = perfMap.get(v.postId);
    return {
      id: v.id,
      label: v.variantLabel,
      hookType: v.hookType,
      hook: post?.hook ?? v.hook,
      caption: post?.caption ?? null,
      score: v.score,
      isWinner: v.isWinner,
      postId: v.postId,
      postStatus: post?.status ?? null,
      scheduledAt: post?.scheduledAt ?? null,
      publishedAt: post?.publishedAt ?? null,
      performance: perf
        ? {
            views: perf.views,
            likes: perf.likes,
            shares: perf.shares,
            linkClicks: perf.linkClicks,
            vehicleRequests: perf.vehicleRequests,
            recordedAt: perf.recordedAt,
          }
        : null,
    };
  });

  return adminSuccess({
    group: {
      id: group.id,
      name: group.name,
      platform: group.platform,
      franchiseSlug: group.franchiseSlug,
      status: group.status,
      winnerId: group.winnerId,
      createdAt: group.createdAt,
      completedAt: group.completedAt,
      variants,
    },
  });
}
