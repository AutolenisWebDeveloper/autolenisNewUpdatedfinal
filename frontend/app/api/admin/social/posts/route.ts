// GET /api/admin/social/posts
// Lists social posts with status/platform/franchise/date filters + pagination.
// Returns posts (with video + franchise), total count, hasMore, and per-status
// stats for the current filter set.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import type { Prisma, SocialPostStatus } from "@prisma/client";

const VALID_STATUS: SocialPostStatus[] = [
  "DRAFT", "PENDING_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHING",
  "PUBLISHED", "FAILED", "SKIPPED", "REJECTED",
];

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const platform = searchParams.get("platform");
  const franchise = searchParams.get("franchise");
  const date = searchParams.get("date"); // YYYY-MM-DD
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const where: Prisma.SocialPostWhereInput = {};
  if (status && VALID_STATUS.includes(status as SocialPostStatus)) {
    where.status = status as SocialPostStatus;
  }
  if (platform) where.platform = platform;
  if (franchise) where.franchise = { slug: franchise };
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    if (!Number.isNaN(start.getTime())) where.scheduledAt = { gte: start, lte: end };
  }

  // The social tables are provisioned via a manual Supabase migration that may
  // not be applied in every environment. If the model/table is missing the
  // queries throw — return an empty result set instead of a 500 so the
  // dashboard still renders.
  try {
    const [posts, total, grouped] = await Promise.all([
      prisma.socialPost.findMany({
        where,
        include: { video: true, franchise: { select: { slug: true, name: true } } },
        orderBy: { scheduledAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.socialPost.count({ where }),
      prisma.socialPost.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const stats = grouped.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = g._count._all;
      return acc;
    }, {});

    return adminSuccess({
      posts,
      total,
      hasMore: page * limit < total,
      page,
      stats,
    });
  } catch (err) {
    logger.error("[admin/social] posts query failed:", err);
    return adminSuccess({ posts: [], total: 0, hasMore: false, page, stats: {} });
  }
}
