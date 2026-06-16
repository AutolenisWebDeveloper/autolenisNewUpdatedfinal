// GET /api/admin/social/leads
// Social-lead queue for the admin Social Engine "Leads" tab: a paginated,
// filterable list of SocialLead rows plus summary stats (this week / today /
// top platform / conversion rate, and breakdowns by platform + landing page).

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const platform = searchParams.get("platform") || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50") || 50));

  // The social tables are provisioned via a manual Supabase migration that may
  // not be applied in every environment. If the table is missing the queries
  // throw — return an empty, zeroed-out payload instead of a 500 so the
  // dashboard still renders.
  const empty = {
    leads: [],
    total: 0,
    stats: {
      thisWeek: 0,
      today: 0,
      topPlatform: "—",
      conversionRate: 0,
      byPlatform: [] as { platform: string; count: number }[],
      byLandingPage: [] as { page: string; count: number }[],
    },
  };

  try {
    const where: Prisma.SocialLeadWhereInput = {};
    if (status) where.status = status;
    if (platform) where.platform = platform;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      leads,
      total,
      thisWeek,
      today,
      totalAll,
      convertedAll,
      platformGroups,
      landingPageGroups,
    ] = await Promise.all([
      prisma.socialLead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.socialLead.count({ where }),
      prisma.socialLead.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.socialLead.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.socialLead.count(),
      prisma.socialLead.count({ where: { convertedAt: { not: null } } }),
      prisma.socialLead.groupBy({
        by: ["platform"],
        where: { createdAt: { gte: weekAgo } },
        _count: { _all: true },
        orderBy: { _count: { platform: "desc" } },
      }),
      prisma.socialLead.groupBy({
        by: ["landingPage"],
        _count: { _all: true },
        orderBy: { _count: { landingPage: "desc" } },
        take: 10,
      }),
    ]);

    const byPlatform = platformGroups.map((g) => ({
      platform: g.platform ?? "unknown",
      count: g._count._all,
    }));
    const byLandingPage = landingPageGroups.map((g) => ({
      page: g.landingPage ?? "—",
      count: g._count._all,
    }));

    return adminSuccess({
      leads,
      total,
      stats: {
        thisWeek,
        today,
        topPlatform: byPlatform[0]?.platform ?? "—",
        conversionRate:
          totalAll > 0 ? Math.round((convertedAll / totalAll) * 1000) / 10 : 0,
        byPlatform,
        byLandingPage,
      },
    });
  } catch (err) {
    logger.error("[admin/social] leads query failed:", err);
    return adminSuccess(empty);
  }
}
