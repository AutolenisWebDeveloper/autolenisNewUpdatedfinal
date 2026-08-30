// Phase C3 — Admin Content Management service.
//
// Data layer for the /admin/content management UI. Aggregates ContentArticle
// (Phase C1 model, populated by the Phase C2 generation engine) into the
// dashboard stats, the cluster breakdown, the metro-level breakdown (the v3
// addition), and the filterable/paginated article list. Also handles the
// single-article fetch and the status-change mutation used by the review flow.
//
// All reads are server-only. Mutations are audit-logged by the calling API
// route, so this layer just returns the before/after records for the log.

import { prisma } from "@/lib/prisma";
import type { ArticleStatus, Prisma } from "@prisma/client";
import {
  CONTENT_KEYWORDS,
  type ContentKeyword,
} from "@/lib/seo/content-keywords";
import { ARTICLE_STATUSES, CLUSTER_ORDER } from "@/lib/content/cluster-meta";

const UNASSIGNED_METRO = "Unassigned";

// ── Filter option sources (derived from the keyword DB so the dropdowns are
//    populated even before any article has been generated) ──────────────────
export const CLUSTER_OPTIONS: string[] = [...CLUSTER_ORDER];

export const METRO_OPTIONS: string[] = Array.from(
  new Set(CONTENT_KEYWORDS.map((k: ContentKeyword) => k.metro)),
).sort((a, b) => a.localeCompare(b));

export const KEYWORD_TOTAL = CONTENT_KEYWORDS.length;

// ── Status pivot helper ─────────────────────────────────────────────────────
interface StatusBuckets {
  draft: number;
  review: number;
  published: number;
  archived: number;
}

function emptyBuckets(): StatusBuckets {
  return { draft: 0, review: 0, published: 0, archived: 0 };
}

function applyStatus(buckets: StatusBuckets, status: string, count: number) {
  switch (status) {
    case "DRAFT":
      buckets.draft += count;
      break;
    case "REVIEW_NEEDED":
      buckets.review += count;
      break;
    case "PUBLISHED":
      buckets.published += count;
      break;
    case "ARCHIVED":
      buckets.archived += count;
      break;
  }
}

// ── Dashboard stats ─────────────────────────────────────────────────────────
export interface ContentBreakdownRow extends StatusBuckets {
  key: string; // cluster id or metro name
  total: number;
  avgQuality: number | null;
  publishedWords: number;
}

export interface ContentDashboardStats {
  total: number;
  byStatus: Record<ArticleStatusValue, number>;
  avgQuality: number | null;
  publishedWordTotal: number;
  clusters: ContentBreakdownRow[];
  metros: ContentBreakdownRow[];
  keywordTotal: number;
  coveragePct: number;
}

type ArticleStatusValue = (typeof ARTICLE_STATUSES)[number];

export async function getContentDashboardStats(): Promise<ContentDashboardStats> {
  const [
    statusCounts,
    clusterStatus,
    clusterAvg,
    metroStatus,
    metroAvg,
    overallAvg,
    publishedWords,
  ] = await Promise.all([
    prisma.contentArticle.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.contentArticle.groupBy({
      by: ["cluster", "status"],
      _count: { _all: true },
      _sum: { wordCount: true },
    }),
    prisma.contentArticle.groupBy({
      by: ["cluster"],
      _avg: { qualityScore: true },
      _count: { _all: true },
    }),
    prisma.contentArticle.groupBy({
      by: ["metro", "status"],
      _count: { _all: true },
      _sum: { wordCount: true },
    }),
    prisma.contentArticle.groupBy({
      by: ["metro"],
      _avg: { qualityScore: true },
      _count: { _all: true },
    }),
    prisma.contentArticle.aggregate({ _avg: { qualityScore: true } }),
    prisma.contentArticle.aggregate({
      where: { status: "PUBLISHED" },
      _sum: { wordCount: true },
    }),
  ]);

  // By-status totals.
  const byStatus: Record<ArticleStatusValue, number> = {
    DRAFT: 0,
    REVIEW_NEEDED: 0,
    PUBLISHED: 0,
    ARCHIVED: 0,
  };
  let total = 0;
  for (const row of statusCounts) {
    const count = row._count._all;
    total += count;
    if ((ARTICLE_STATUSES as readonly string[]).includes(row.status)) {
      byStatus[row.status as ArticleStatusValue] = count;
    }
  }

  // Cluster breakdown — pivot per-status counts, attach avg quality.
  const clusterBuckets = new Map<string, ContentBreakdownRow>();
  const ensureCluster = (key: string): ContentBreakdownRow => {
    let row = clusterBuckets.get(key);
    if (!row) {
      row = { key, total: 0, avgQuality: null, publishedWords: 0, ...emptyBuckets() };
      clusterBuckets.set(key, row);
    }
    return row;
  };
  // Seed all known clusters so the table is complete even with zero articles.
  for (const c of CLUSTER_ORDER) ensureCluster(c);
  for (const row of clusterStatus) {
    const bucket = ensureCluster(row.cluster);
    applyStatus(bucket, row.status, row._count._all);
    bucket.total += row._count._all;
    if (row.status === "PUBLISHED") bucket.publishedWords += row._sum.wordCount ?? 0;
  }
  for (const row of clusterAvg) {
    const bucket = ensureCluster(row.cluster);
    bucket.avgQuality = row._avg.qualityScore;
  }
  const clusters = [...clusterBuckets.values()].sort((a, b) => {
    const ai = CLUSTER_ORDER.indexOf(a.key as (typeof CLUSTER_ORDER)[number]);
    const bi = CLUSTER_ORDER.indexOf(b.key as (typeof CLUSTER_ORDER)[number]);
    if (ai !== -1 && bi !== -1) return ai - bi;
    return a.key.localeCompare(b.key);
  });

  // Metro breakdown (the v3 addition) — only metros that have articles.
  const metroBuckets = new Map<string, ContentBreakdownRow>();
  const ensureMetro = (key: string): ContentBreakdownRow => {
    let row = metroBuckets.get(key);
    if (!row) {
      row = { key, total: 0, avgQuality: null, publishedWords: 0, ...emptyBuckets() };
      metroBuckets.set(key, row);
    }
    return row;
  };
  for (const row of metroStatus) {
    const key = row.metro ?? UNASSIGNED_METRO;
    const bucket = ensureMetro(key);
    applyStatus(bucket, row.status, row._count._all);
    bucket.total += row._count._all;
    if (row.status === "PUBLISHED") bucket.publishedWords += row._sum.wordCount ?? 0;
  }
  for (const row of metroAvg) {
    const key = row.metro ?? UNASSIGNED_METRO;
    const bucket = ensureMetro(key);
    bucket.avgQuality = row._avg.qualityScore;
  }
  const metros = [...metroBuckets.values()].sort((a, b) => b.total - a.total);

  const coveragePct =
    KEYWORD_TOTAL > 0 ? Math.min(100, Math.round((total / KEYWORD_TOTAL) * 100)) : 0;

  return {
    total,
    byStatus,
    avgQuality: overallAvg._avg.qualityScore,
    publishedWordTotal: publishedWords._sum.wordCount ?? 0,
    clusters,
    metros,
    keywordTotal: KEYWORD_TOTAL,
    coveragePct,
  };
}

// ── Article list (filtered + paginated) ─────────────────────────────────────
export interface ContentListFilters {
  cluster?: string;
  status?: string;
  metro?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ContentListItem {
  id: string;
  slug: string;
  title: string;
  cluster: string;
  make: string | null;
  model: string | null;
  city: string;
  state: string;
  metro: string | null;
  status: ArticleStatus;
  qualityScore: number | null;
  wordCount: number | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface ContentListResult {
  items: ContentListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function getContentArticleList(
  filters: ContentListFilters,
): Promise<ContentListResult> {
  const where: Prisma.ContentArticleWhereInput = {};
  if (filters.cluster) where.cluster = filters.cluster;
  if (filters.status && (ARTICLE_STATUSES as readonly string[]).includes(filters.status)) {
    where.status = filters.status as ArticleStatus;
  }
  if (filters.metro) where.metro = filters.metro;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { targetKeyword: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }

  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);

  const [items, total] = await Promise.all([
    prisma.contentArticle.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        slug: true,
        title: true,
        cluster: true,
        make: true,
        model: true,
        city: true,
        state: true,
        metro: true,
        status: true,
        qualityScore: true,
        wordCount: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
    prisma.contentArticle.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ── Single article ──────────────────────────────────────────────────────────
// Shape consumed by the review / bulk preview drawer. We select an explicit
// column subset (mirroring getContentArticleList) instead of pulling the whole
// row: it returns only what the preview renders, and — like the list endpoint —
// it never touches the Phase-1 lifecycle/media columns, so the read can't fail
// on a row that predates those extensions.
export interface ContentArticleDetail {
  id: string;
  slug: string;
  title: string;
  h1: string;
  cluster: string;
  make: string | null;
  model: string | null;
  city: string;
  state: string;
  metro: string | null;
  wave: number;
  targetKeyword: string;
  authorSlug: string;
  status: ArticleStatus;
  qualityScore: number | null;
  qualityFlags: string | null;
  wordCount: number | null;
  searchGrounded: boolean | null;
  groqModel: string | null;
  generatedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  body: string;
  faqJson: string | null;
  metaDescription: string;
  /** Why the last publish attempt was refused by the publish guards. */
  publishFailureReason: string | null;
  scheduledAt: Date | null;
}

export async function getContentArticleById(
  id: string,
): Promise<ContentArticleDetail | null> {
  return prisma.contentArticle.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      h1: true,
      cluster: true,
      make: true,
      model: true,
      city: true,
      state: true,
      metro: true,
      wave: true,
      targetKeyword: true,
      authorSlug: true,
      status: true,
      qualityScore: true,
      qualityFlags: true,
      wordCount: true,
      searchGrounded: true,
      groqModel: true,
      generatedAt: true,
      publishedAt: true,
      createdAt: true,
      body: true,
      faqJson: true,
      metaDescription: true,
      publishFailureReason: true,
      scheduledAt: true,
    },
  });
}

// ── Status mutation ─────────────────────────────────────────────────────────
export interface StatusUpdateResult {
  previousStatus: ArticleStatus;
  article: Awaited<ReturnType<typeof prisma.contentArticle.update>>;
}

export async function updateContentArticleStatus(
  id: string,
  status: ArticleStatusValue,
): Promise<StatusUpdateResult | null> {
  const existing = await prisma.contentArticle.findUnique({
    where: { id },
    select: { id: true, status: true, publishedAt: true },
  });
  if (!existing) return null;

  const data: Prisma.ContentArticleUpdateInput = { status };
  // Stamp publishedAt the first time an article goes live; clear it when an
  // article is pulled back to a non-public state so the sitemap stays accurate.
  if (status === "PUBLISHED") {
    if (!existing.publishedAt) data.publishedAt = new Date();
  } else if (status === "DRAFT" || status === "REVIEW_NEEDED") {
    data.publishedAt = null;
  }

  const article = await prisma.contentArticle.update({ where: { id }, data });
  return { previousStatus: existing.status, article };
}
