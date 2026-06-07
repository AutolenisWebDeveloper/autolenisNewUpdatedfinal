// AMIPS Phase 3 — Indexation Gate.
//
// The 6th gate, applied at scale: before expanding a cohort we check how much
// of it Google actually indexed. A "cohort" is the set of pages published in
// the same ISO week. The decision throttles generation volume:
//
//   ≥ 70%  → "scale"  — indexation healthy, raise the cron limit
//   50–69% → "hold"   — maintain the current limit
//   < 50%  → "pause"  — stop new generation, investigate quality signals
//
// "Indexed" is inferred from Search Console: a page counts as indexed if any
// search_intelligence row marked it indexed (it drew impressions) or its mirrored
// page impressions are > 0. Surfaced read-only in the AMIPS admin dashboard.

import { prisma } from "@/lib/prisma";
import { mondayOf, slugFromUrl } from "@/lib/amips/pipelines/search-intelligence.pipeline";

export type IndexationDecision = "scale" | "hold" | "pause";

export interface IndexationGate {
  cohortWeek: string; // Monday (YYYY-MM-DD) of the publish week
  submitted: number;
  indexed: number;
  indexationRate: number; // 0–1
  decision: IndexationDecision;
}

/**
 * Map an indexation rate (0–1) onto the scaling decision.
 */
export function decideFromRate(indexationRate: number): IndexationDecision {
  if (indexationRate >= 0.7) return "scale";
  if (indexationRate >= 0.5) return "hold";
  return "pause";
}

/**
 * Evaluate a single cohort's gate. Returns the scaling decision string.
 */
export function evaluateIndexationGate(cohort: IndexationGate): IndexationDecision {
  return decideFromRate(cohort.indexationRate);
}

/**
 * Build per-cohort indexation gates from published AMIPS pages and their Search
 * Console history. Cohorts are keyed by the Monday of each page's publish week,
 * most recent first.
 */
export async function computeIndexationGates(): Promise<IndexationGate[]> {
  const pages = await prisma.amipsPage.findMany({
    where: { publishedAt: { not: null } },
    select: { slug: true, publishedAt: true, impressions: true },
  });
  if (pages.length === 0) return [];

  // Slugs that Search Console has confirmed indexed (drew impressions).
  const indexedRows = await prisma.searchIntelligence.findMany({
    where: { indexedStatus: true },
    select: { url: true },
  });
  const indexedSlugs = new Set<string>();
  for (const r of indexedRows) {
    const slug = slugFromUrl(r.url);
    if (slug) indexedSlugs.add(slug);
  }

  const byCohort = new Map<string, { submitted: number; indexed: number }>();
  for (const p of pages) {
    if (!p.publishedAt) continue;
    const week = mondayOf(new Date(p.publishedAt)).toISOString().slice(0, 10);
    const bucket = byCohort.get(week) ?? { submitted: 0, indexed: 0 };
    bucket.submitted++;
    if (indexedSlugs.has(p.slug) || p.impressions > 0) bucket.indexed++;
    byCohort.set(week, bucket);
  }

  return [...byCohort.entries()]
    .map(([cohortWeek, b]) => {
      const indexationRate = b.submitted > 0 ? b.indexed / b.submitted : 0;
      return {
        cohortWeek,
        submitted: b.submitted,
        indexed: b.indexed,
        indexationRate,
        decision: decideFromRate(indexationRate),
      };
    })
    .sort((a, b) => (a.cohortWeek < b.cohortWeek ? 1 : -1));
}
