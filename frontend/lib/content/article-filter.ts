// The ONE place a ContentArticle filter becomes a Prisma WHERE clause.
//
// Why this module exists. The list endpoint and the bulk-mutation endpoint each
// built their own where clause. They agreed by convention, not by construction,
// and the convention had already slipped: the list searched four columns while
// bulk had no free-text predicate at all, so "select all matching" during a
// search would have targeted more rows than the operator was looking at. The
// first fix was to withhold select-all while searching — which capped a real
// capability to work around drift that was itself fixable.
//
// A parity test over two builders can only prove agreement on the params it
// thinks to try. One builder cannot disagree with itself. So both routes call
// this, and the test asserts the two ENTRY POINTS (query string and JSON filter)
// resolve to identical clauses.
//
// Anything added here reaches the list and the mutation in the same commit,
// which is the property that matters: the rows an operator sees are the rows
// the action touches.

import type { ArticleStatus, Prisma } from "@prisma/client";
import { ARTICLE_STATUSES } from "@/lib/content/cluster-meta";

/** The canonical filter shape. Both entry points normalise into this. */
export interface ContentArticleFilter {
  status?: string;
  cluster?: string;
  metro?: string;
  /** Free text over title, slug, target keyword and city. */
  search?: string;
  qualityScoreMin?: number;
  qualityScoreMax?: number;
  /** "1" — a publish is pending on a not-yet-public article. */
  scheduled?: string;
  /** "1" — the last publish attempt was refused by the publish guards. */
  failed?: string;
}

/** The columns a free-text search covers. Widened from title-only. */
export function searchClauses(q: string): Prisma.ContentArticleWhereInput[] {
  return [
    { title: { contains: q, mode: "insensitive" } },
    { slug: { contains: q, mode: "insensitive" } },
    { targetKeyword: { contains: q, mode: "insensitive" } },
    { city: { contains: q, mode: "insensitive" } },
  ];
}

export function buildContentArticleWhere(
  filter: ContentArticleFilter,
): Prisma.ContentArticleWhereInput {
  const where: Prisma.ContentArticleWhereInput = {};
  const and: Prisma.ContentArticleWhereInput[] = [];

  if (filter.status && (ARTICLE_STATUSES as readonly string[]).includes(filter.status)) {
    where.status = filter.status as ArticleStatus;
  }
  if (filter.cluster) where.cluster = filter.cluster;
  if (filter.metro) where.metro = filter.metro;

  if (filter.qualityScoreMin !== undefined || filter.qualityScoreMax !== undefined) {
    const range: Prisma.IntNullableFilter = {};
    if (filter.qualityScoreMin !== undefined) range.gte = filter.qualityScoreMin;
    if (filter.qualityScoreMax !== undefined) range.lte = filter.qualityScoreMax;
    if (Object.keys(range).length > 0) where.qualityScore = range;
  }

  const q = filter.search?.trim();
  if (q) where.OR = searchClauses(q);

  // The scheduled lens is AND-composed, never assigned to where.status: an
  // explicit status must still apply. Assigning would DROP it and widen the
  // match — and this clause drives mutations, not just reads.
  if (filter.scheduled === "1") {
    where.scheduledAt = { not: null };
    and.push({ status: { in: ["DRAFT", "REVIEW_NEEDED"] } });
  }
  if (filter.failed === "1") {
    where.publishFailureReason = { not: null };
  }

  if (and.length > 0) where.AND = and;
  return where;
}

/** Query-string entry point — the list endpoint. */
export function filterFromSearchParams(params: URLSearchParams): ContentArticleFilter {
  const min = params.get("quality_score_min");
  const max = params.get("quality_score_max");
  return {
    status: params.get("status") ?? undefined,
    cluster: params.get("cluster") ?? undefined,
    metro: params.get("metro") ?? undefined,
    search: params.get("search") ?? undefined,
    qualityScoreMin: min !== null && min !== "" ? Number(min) : undefined,
    qualityScoreMax: max !== null && max !== "" ? Number(max) : undefined,
    scheduled: params.get("scheduled") ?? undefined,
    failed: params.get("failed") ?? undefined,
  };
}

/** JSON entry point — the bulk endpoint's `filter` object. */
export interface BulkFilterInput {
  status?: string;
  cluster?: string;
  metro?: string;
  search?: string;
  quality_score_min?: number;
  quality_score_max?: number;
  scheduled?: string;
  failed?: string;
}

export function filterFromBulkPayload(filter: BulkFilterInput): ContentArticleFilter {
  return {
    status: filter.status,
    cluster: filter.cluster,
    metro: filter.metro,
    search: filter.search,
    qualityScoreMin: filter.quality_score_min,
    qualityScoreMax: filter.quality_score_max,
    scheduled: filter.scheduled,
    failed: filter.failed,
  };
}
