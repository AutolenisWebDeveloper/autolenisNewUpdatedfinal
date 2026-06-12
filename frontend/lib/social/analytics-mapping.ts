// AutoLenis Social Engine — analytics → SocialPerformance row mapping.
//
// Single source of truth for translating a provider's PostAnalyticsResult into
// the metric columns of a SocialPerformance snapshot. Centralized (and exported)
// so the persistence contract is unit-testable end-to-end with the sync route.
//
// Degradation contract: an *unavailable* metric (provider returned null, or the
// optional field was omitted) is stored as NULL — never a fabricated 0. A 0 is
// reserved for a value the platform API confirmed is zero. `?? null` collapses
// both null and undefined to a stored null. watch_time_pct holds the completion
// *rate* (0-1), never average watch-time seconds.

import type { PostAnalyticsResult } from "@/lib/social/providers/publishing.provider";

export interface PerformanceMetricRow {
  impressions: number | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  linkClicks: number | null;
  profileVisits: number | null;
  watchTimePct: number | null;
  completionRate: number | null;
}

export function mapAnalyticsToPerformanceMetrics(a: PostAnalyticsResult): PerformanceMetricRow {
  return {
    impressions: a.impressions ?? null,
    reach: a.reach ?? null,
    views: a.views ?? a.impressions ?? null,
    likes: a.likes ?? null,
    comments: a.comments ?? null,
    shares: a.shares ?? null,
    saves: a.saves ?? null,
    linkClicks: a.clicks ?? null,
    profileVisits: a.profileVisits ?? null,
    watchTimePct: a.completionRate ?? null,
    completionRate: a.completionRate ?? null,
  };
}
