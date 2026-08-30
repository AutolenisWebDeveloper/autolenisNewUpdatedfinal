// Bulk Article Management — bulk action endpoint.
//
// POST /api/admin/content/articles/bulk — publish / reject / draft many
// ContentArticle rows at once. Targets either an explicit list of ids OR every
// row matching a filter (the "select all matching" path, which can span pages).
//
// NOTE ON STATUS: the ContentArticle.status enum (ArticleStatus) has no RETIRED
// value — the platform's terminal/withdrawn state is ARCHIVED. The "reject"
// action therefore maps to ARCHIVED. See route audit notes in the PR summary.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import type { ArticleStatus, Prisma } from "@prisma/client";
import { ARTICLE_STATUSES } from "@/lib/content/cluster-meta";

const ACTION_TO_STATUS: Record<"publish" | "reject" | "draft", ArticleStatus> = {
  publish: "PUBLISHED",
  reject: "ARCHIVED",
  draft: "DRAFT",
};

const bulkSchema = z
  .object({
    action: z.enum(["publish", "reject", "draft"]),
    ids: z.array(z.string()).optional(),
    // Exclusions apply to the filter path only. "Select all matching, except
    // these" is a real operator intent: without it, un-ticking one row in
    // all-matching mode had to collapse the whole selection.
    excludeIds: z.array(z.string()).optional(),
    filter: z
      .object({
        status: z.string().optional(),
        cluster: z.string().optional(),
        metro: z.string().optional(),
        quality_score_min: z.number().optional(),
        quality_score_max: z.number().optional(),
        scheduled: z.string().optional(),
        failed: z.string().optional(),
      })
      .optional(),
  })
  .refine((d) => (d.ids && d.ids.length > 0) || d.filter, {
    message: "Provide either a non-empty ids array or a filter",
  });

function whereFromFilter(filter: NonNullable<z.infer<typeof bulkSchema>["filter"]>): Prisma.ContentArticleWhereInput {
  const where: Prisma.ContentArticleWhereInput = {};
  if (filter.status && (ARTICLE_STATUSES as readonly string[]).includes(filter.status)) {
    where.status = filter.status as ArticleStatus;
  }
  if (filter.cluster) where.cluster = filter.cluster;
  if (filter.metro) where.metro = filter.metro;
  if (filter.quality_score_min !== undefined || filter.quality_score_max !== undefined) {
    const range: Prisma.IntNullableFilter = {};
    if (filter.quality_score_min !== undefined) range.gte = filter.quality_score_min;
    if (filter.quality_score_max !== undefined) range.lte = filter.quality_score_max;
    where.qualityScore = range;
  }
  // These two lenses must mirror buildArticleWhere in the list route exactly.
  // They are what the operator was looking at when they chose the action; if
  // they are dropped here the action hits a wider set than the list showed.
  if (filter.scheduled === "1") {
    where.scheduledAt = { not: null };
    // AND-composed so an explicit status filter is preserved, not overwritten.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { status: { in: ["DRAFT", "REVIEW_NEEDED"] } },
    ];
  }
  if (filter.failed === "1") {
    where.publishFailureReason = { not: null };
  }
  return where;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  }

  const { action, ids, excludeIds, filter } = parsed.data;
  const status = ACTION_TO_STATUS[action];

  let baseWhere: Prisma.ContentArticleWhereInput;
  if (ids && ids.length > 0) {
    // An explicit id list is already the exact target; exclusions are a
    // filter-path concept and are ignored here rather than silently subtracted.
    baseWhere = { id: { in: ids } };
  } else {
    baseWhere = whereFromFilter(filter!);
    if (excludeIds && excludeIds.length > 0) {
      baseWhere = { AND: [baseWhere, { id: { notIn: excludeIds } }] };
    }
  }

  let updated = 0;

  if (status === "PUBLISHED") {
    // Stamp published_at only on rows that have never been published, so we
    // preserve original go-live dates for already-public articles.
    const [freshlyPublished, alreadyPublished] = await Promise.all([
      prisma.contentArticle.updateMany({
        where: { AND: [baseWhere, { publishedAt: null }] },
        data: { status, publishedAt: new Date() },
      }),
      prisma.contentArticle.updateMany({
        where: { AND: [baseWhere, { publishedAt: { not: null } }] },
        data: { status },
      }),
    ]);
    updated = freshlyPublished.count + alreadyPublished.count;
  } else if (status === "DRAFT") {
    // Pulling back to draft clears published_at so the sitemap stays accurate.
    const res = await prisma.contentArticle.updateMany({
      where: baseWhere,
      data: { status, publishedAt: null },
    });
    updated = res.count;
  } else {
    // ARCHIVED (reject) — leave published_at untouched, mirroring the single
    // article status mutation.
    const res = await prisma.contentArticle.updateMany({ where: baseWhere, data: { status } });
    updated = res.count;
  }

  logger.info(`[bulk-articles] ${action}: ${updated} articles`);

  await createAuditLog(admin, request, {
    action: "CONTENT_ARTICLE_BULK_STATUS_CHANGED",
    entityType: "ContentArticle",
    entityId: ids && ids.length > 0 ? `bulk:${ids.length}` : "bulk:filter",
    metadata: {
      bulkAction: action,
      newStatus: status,
      updated,
      mode: ids && ids.length > 0 ? "ids" : "filter",
      ids: ids ?? undefined,
      filter: filter ?? undefined,
      excludedCount: excludeIds?.length ?? undefined,
      excludeIds: excludeIds?.length ? excludeIds : undefined,
    },
  });

  return adminSuccess({ updated, action });
}
