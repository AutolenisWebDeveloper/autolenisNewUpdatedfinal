// GET /api/admin/social/trending
// Returns the cached daily trending intelligence (TikTok hashtags, Reddit
// topics, Google Trends) from SocialIntelligenceCache. Refreshed by the daily
// trending cron at 5AM UTC; returns { stale: true } until the first run lands.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const cached = await prisma.socialIntelligenceCache
      .findUnique({ where: { cacheKey: "trending_data" } })
      .catch(() => null);

    if (!cached || cached.expiresAt < new Date()) {
      return adminSuccess({
        trending: null,
        stale: true,
        message: "No trending data yet — runs daily at 5AM UTC",
      });
    }

    return adminSuccess({
      trending: cached.data,
      stale: false,
      lastUpdated: cached.updatedAt,
    });
  } catch (err) {
    logger.error("[admin/social] trending GET failed:", err);
    return adminSuccess({ trending: null, stale: true });
  }
}
