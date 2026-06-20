// /api/admin/social/creators
// GET  — list all CreatorNetwork records with computed stats from
//        CreatorAttribution, plus network-level summary stats.
// POST — create a new CreatorNetwork record (name + platform required).

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  // The social tables are provisioned via a manual Supabase migration that may
  // not be applied in every environment. Fail safe to an empty payload so the
  // dashboard still renders instead of 500-ing.
  const empty = {
    creators: [] as unknown[],
    stats: { total: 0, active: 0, totalClicks: 0, revenueAttributedCents: 0 },
  };

  // Bound the list so it never becomes an unbounded full-table scan as the
  // network grows. Network-level stats below are computed from aggregates so
  // they stay accurate regardless of the page returned.
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 200);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  try {
    const [creators, attributionGroups, total, active] = await Promise.all([
      prisma.creatorNetwork.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.creatorAttribution.groupBy({
        by: ["creatorId"],
        _sum: { clicks: true, vehicleRequests: true, revenueGenerated: true },
      }),
      prisma.creatorNetwork.count(),
      prisma.creatorNetwork.count({ where: { status: "ACTIVE" } }),
    ]);

    const byCreator = new Map(
      attributionGroups.map((g) => [
        g.creatorId,
        {
          clicks: g._sum.clicks ?? 0,
          requests: g._sum.vehicleRequests ?? 0,
          revenueCents: g._sum.revenueGenerated ?? 0,
        },
      ]),
    );

    const rows = creators.map((c) => {
      const computed = byCreator.get(c.id);
      // Prefer live CreatorAttribution aggregates; fall back to the
      // denormalized counters on the creator row.
      const clicks = computed?.clicks ?? c.totalClicks;
      const leads = computed?.requests ?? c.totalRequests;
      const revenueCents = computed?.revenueCents ?? c.totalRevenue;
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        platform: c.platform,
        handle: c.handle,
        status: c.status,
        followerCount: c.followerCount,
        commissionRate: c.commissionRate,
        affiliateId: c.affiliateId,
        // No dedicated "packages sent" column exists on the model — totalPosts
        // is the closest proxy for content distributed to/by this creator.
        packagesSent: c.totalPosts,
        clicks,
        leads,
        revenueCents,
        createdAt: c.createdAt.toISOString(),
      };
    });

    // Network-level totals are derived from global aggregates (not just the
    // current page) so they remain correct under pagination.
    const stats = {
      total,
      active,
      totalClicks: attributionGroups.reduce((sum, g) => sum + (g._sum.clicks ?? 0), 0),
      revenueAttributedCents: attributionGroups.reduce(
        (sum, g) => sum + (g._sum.revenueGenerated ?? 0),
        0,
      ),
    };

    return adminSuccess({
      creators: rows,
      stats,
      pagination: { limit, offset, total, hasMore: offset + creators.length < total },
    });
  } catch (err) {
    logger.error("[admin/social] creators query failed:", err);
    return adminSuccess(empty);
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: {
    name?: string;
    email?: string;
    platform?: string;
    handle?: string;
    followerCount?: number | string;
    commissionRate?: number | string;
    affiliateId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const name = body.name?.trim();
  const platform = body.platform?.trim().toLowerCase();
  if (!name || !platform) {
    return adminError("BAD_REQUEST", "name and platform are required", 400);
  }

  const followerCount =
    body.followerCount != null && body.followerCount !== ""
      ? Math.max(0, Math.round(Number(body.followerCount)))
      : null;
  const commissionRate =
    body.commissionRate != null && body.commissionRate !== ""
      ? Number(body.commissionRate)
      : null;

  try {
    const creator = await prisma.creatorNetwork.create({
      data: {
        name,
        platform,
        platforms: [platform],
        email: body.email?.trim() || null,
        handle: body.handle?.trim() || null,
        followerCount: Number.isFinite(followerCount as number) ? followerCount : null,
        commissionRate: Number.isFinite(commissionRate as number) ? commissionRate : null,
        affiliateId: body.affiliateId?.trim() || null,
        status: "PENDING",
      },
    });
    return adminSuccess({ creator });
  } catch (err) {
    logger.error("[admin/social] creator create failed:", err);
    return adminError("SERVER_ERROR", "Failed to create creator", 500);
  }
}

// PATCH — update an existing creator's commission rate and/or status.
export async function PATCH(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: { id?: string; commissionRate?: number | string; status?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const id = body.id?.trim();
  if (!id) return adminError("BAD_REQUEST", "id is required", 400);

  const data: { commissionRate?: number | null; status?: string } = {};
  if (body.commissionRate != null && body.commissionRate !== "") {
    const rate = Number(body.commissionRate);
    if (Number.isFinite(rate)) data.commissionRate = rate;
  }
  if (body.status) data.status = body.status.trim().toUpperCase();

  if (Object.keys(data).length === 0) {
    return adminError("BAD_REQUEST", "Nothing to update", 400);
  }

  try {
    const creator = await prisma.creatorNetwork.update({ where: { id }, data });
    return adminSuccess({ creator });
  } catch (err) {
    logger.error("[admin/social] creator update failed:", err);
    return adminError("SERVER_ERROR", "Failed to update creator", 500);
  }
}
