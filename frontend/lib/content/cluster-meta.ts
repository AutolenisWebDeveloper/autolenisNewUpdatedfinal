// Phase C3 — Shared display metadata for the content engine admin UI.
//
// Single source of truth for cluster labels, status labels, and badge styling
// so the dashboard, article list, and detail/review pages all render
// consistently. Pure data — safe to import from server or client components.

import type { ContentCluster } from "@/lib/seo/content-keywords";

export const CLUSTER_ORDER: ContentCluster[] = [
  "dealer_quotes",
  "otd_price",
  "dealer_fees",
  "trade_in",
  "leasing",
];

export const CLUSTER_LABELS: Record<string, string> = {
  dealer_quotes: "Dealer Quotes",
  otd_price: "OTD Price",
  dealer_fees: "Dealer Fees",
  trade_in: "Trade-In",
  leasing: "Leasing",
};

export function clusterLabel(cluster: string): string {
  return CLUSTER_LABELS[cluster] ?? cluster;
}

export const ARTICLE_STATUSES = [
  "DRAFT",
  "REVIEW_NEEDED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type ArticleStatusValue = (typeof ARTICLE_STATUSES)[number];

// Maps each status to a human label and a Badge variant from components/ui/badge.
export const STATUS_META: Record<
  string,
  { label: string; variant: "green" | "amber" | "gray" | "secondary" | "blue" }
> = {
  PUBLISHED: { label: "Published", variant: "green" },
  REVIEW_NEEDED: { label: "Review Needed", variant: "amber" },
  DRAFT: { label: "Draft", variant: "gray" },
  ARCHIVED: { label: "Archived", variant: "secondary" },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, variant: "secondary" as const };
}

// ── Shared parsing + tone helpers ───────────────────────────────────────────
// These were previously re-implemented in the detail page and twice inside the
// bulk client, which is how "Archived" came to be shown as "Retired" on one
// surface and "Archive" on another. One state, one word, one place.

export interface ArticleFaq {
  question: string;
  answer: string;
}

/** Failed rubric checks, from the qualityFlags JSON column. Never throws. */
export function parseQualityFlags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data.filter((f): f is string => typeof f === "string");
  } catch {
    /* a malformed column must not break the page that displays it */
  }
  return [];
}

/** FAQ pairs, from the faqJson column. Never throws. */
export function parseFaqs(raw: string | null | undefined): ArticleFaq[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data.filter(
        (f): f is ArticleFaq =>
          !!f && typeof f.question === "string" && typeof f.answer === "string",
      );
    }
  } catch {
    /* ignore malformed JSON */
  }
  return [];
}

export type Tone = "good" | "warn" | "bad" | "neutral";

/** Rubric score out of 6. */
export function qualityTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  if (score >= 6) return "good";
  if (score === 5) return "warn";
  return "bad";
}

/** Word count against the content engine's length rubric. */
export function wordCountTone(words: number | null | undefined): Tone {
  if (words === null || words === undefined) return "neutral";
  if (words < 700) return "bad";
  if (words < 800) return "warn";
  return "good";
}

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-al-success",
  warn: "text-al-warning",
  bad: "text-al-danger",
  neutral: "text-slate-400",
};

export const TONE_DOT: Record<Tone, string> = {
  good: "bg-al-success",
  warn: "bg-al-warning",
  bad: "bg-al-danger",
  neutral: "bg-slate-300",
};
