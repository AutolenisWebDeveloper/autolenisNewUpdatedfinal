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
