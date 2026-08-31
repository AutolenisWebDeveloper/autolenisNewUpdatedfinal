// Bulk Article Management — list endpoint.
//
// GET /api/admin/content/articles — filterable, sortable, paginated list of
// ContentArticle rows for the bulk management dashboard. Also returns global
// status totals (for the stat strip) and, when ?breakdown=1, a cluster/metro
// group summary used by the bulk-action confirmation modal.

import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
} from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  buildContentArticleWhere,
  filterFromSearchParams,
} from "@/lib/content/article-filter";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type SortKey =
  | "newest"
  | "oldest"
  | "quality_desc"
  | "quality_asc"
  | "word_count_desc"
  | "title_asc";

function buildOrderBy(sort: string | null): Prisma.ContentArticleOrderByWithRelationInput[] {
  switch (sort as SortKey) {
    case "oldest":
      return [{ createdAt: "asc" }];
    case "quality_desc":
      return [{ qualityScore: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "quality_asc":
      return [{ qualityScore: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case "word_count_desc":
      return [{ wordCount: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "title_asc":
      return [{ title: "asc" }];
    case "newest":
    default:
      return [{ createdAt: "desc" }];
  }
}

// The WHERE clause comes from lib/content/article-filter, which the bulk
// mutation endpoint also uses. Two builders agreed only by convention, and the
// convention had already slipped; one builder cannot disagree with itself.
export function buildArticleWhere(params: URLSearchParams): Prisma.ContentArticleWhereInput {
  return buildContentArticleWhere(filterFromSearchParams(params));
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const params = request.nextUrl.searchParams;
  const where = buildArticleWhere(params);

  const page = Math.max(1, Number(params.get("page")) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT));
  const wantsBreakdown = params.get("breakdown") === "1";

  const [items, total, statusCounts, scheduledCount, failedCount] = await Promise.all([
    prisma.contentArticle.findMany({
      where,
      orderBy: buildOrderBy(params.get("sort")),
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        cluster: true,
        metro: true,
        make: true,
        model: true,
        status: true,
        wordCount: true,
        qualityScore: true,
        qualityFlags: true,
        publishedAt: true,
        createdAt: true,
        searchGrounded: true,
      },
    }),
    prisma.contentArticle.count({ where }),
    // Global status totals for the triage strip — intentionally unfiltered, so
    // the chips always show the whole pipeline rather than the current view.
    prisma.contentArticle.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.contentArticle.count({
      where: { scheduledAt: { not: null }, status: { in: ["DRAFT", "REVIEW_NEEDED"] } },
    }),
    prisma.contentArticle.count({ where: { publishFailureReason: { not: null } } }),
  ]);

  const stats = {
    total: 0,
    published: 0,
    review_needed: 0,
    draft: 0,
    retired: 0,
    scheduled: scheduledCount,
    failed: failedCount,
  };
  for (const row of statusCounts) {
    const count = row._count._all;
    stats.total += count;
    if (row.status === "PUBLISHED") stats.published = count;
    else if (row.status === "REVIEW_NEEDED") stats.review_needed = count;
    else if (row.status === "DRAFT") stats.draft = count;
    else if (row.status === "ARCHIVED") stats.retired = count;
  }

  let breakdown: { clusters: Record<string, number>; metros: Record<string, number> } | undefined;
  if (wantsBreakdown) {
    const [clusterGroups, metroGroups] = await Promise.all([
      prisma.contentArticle.groupBy({ by: ["cluster"], where, _count: { _all: true } }),
      prisma.contentArticle.groupBy({ by: ["metro"], where, _count: { _all: true } }),
    ]);
    breakdown = {
      clusters: Object.fromEntries(clusterGroups.map((g) => [g.cluster, g._count._all])),
      metros: Object.fromEntries(metroGroups.map((g) => [g.metro ?? "Unassigned", g._count._all])),
    };
  }

  return adminSuccess({
    articles: items,
    total,
    page,
    hasMore: page * limit < total,
    stats,
    ...(breakdown ? { breakdown } : {}),
  });
}
