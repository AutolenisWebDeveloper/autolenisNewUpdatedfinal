// ─────────────────────────────────────────────────────────────────────────────
//  Content Article data service (Phase C1)
//
//  Read-side access to ContentArticle rows for the public /buying-guide pages
//  and the sitemap. Public callers only ever see PUBLISHED articles — DRAFT and
//  ARCHIVED rows are filtered out here so individual pages can't leak unpublished
//  content. Admin tooling (Phase C3) queries Prisma directly for all statuses.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentArticle } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface PublishedArticleFilter {
  cluster?: string;
  city?: string;
}

/** A single parsed FAQ entry (faqJson is stored as a JSON string). */
export interface ArticleFaq {
  question: string;
  answer: string;
}

/**
 * Look up one PUBLISHED article by slug. Returns null for unknown slugs and for
 * DRAFT/ARCHIVED articles so the public page renders a 404 in both cases.
 */
export async function getArticle(slug: string): Promise<ContentArticle | null> {
  if (!slug) return null;
  try {
    return await prisma.contentArticle.findFirst({
      where: { slug, status: "PUBLISHED" },
    });
  } catch {
    // DB unavailable (e.g. at build time before the table exists) — treat as miss.
    return null;
  }
}

/**
 * All PUBLISHED articles, newest first, optionally filtered by cluster and/or
 * city. Used by the index page and the related-articles surface (Phase C4).
 */
export async function getPublishedArticles(
  filter?: PublishedArticleFilter,
): Promise<ContentArticle[]> {
  try {
    return await prisma.contentArticle.findMany({
      where: {
        status: "PUBLISHED",
        ...(filter?.cluster ? { cluster: filter.cluster } : {}),
        ...(filter?.city ? { city: filter.city } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
  } catch {
    return [];
  }
}

/** Count of PUBLISHED articles. */
export async function getArticleCount(): Promise<number> {
  try {
    return await prisma.contentArticle.count({ where: { status: "PUBLISHED" } });
  } catch {
    return 0;
  }
}

/** Safely parse the stored faqJson string into a typed array. */
export function parseFaqs(faqJson: string | null | undefined): ArticleFaq[] {
  if (!faqJson) return [];
  try {
    const parsed = JSON.parse(faqJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is ArticleFaq =>
        f &&
        typeof f.question === "string" &&
        typeof f.answer === "string",
    );
  } catch {
    return [];
  }
}
