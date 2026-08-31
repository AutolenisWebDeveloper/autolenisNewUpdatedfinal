// AMIPS Phase 3 — Lifecycle Manager.
//
// Every published page carries a lifecycle status. This reviewer walks the
// ACTIVE and UNDER_REVIEW sets weekly and applies the AMIPS transition rules:
//
//   ACTIVE → REFRESH_REQUIRED   data went stale, or no impressions for 180d
//   ACTIVE → UNDER_REVIEW       duplicate cluster, or conversion < 0.1% for 90d+
//   UNDER_REVIEW → RETIRED      no impressions AND no clicks for 365d+
//
// Freshness thresholds mirror the Quality Gate: vehicle data ≤180d, dealer data
// ≤90d (Tier C+), market data ≤30d (Tier C+). RETIRED pages drop out of the
// sitemaps automatically (those queries filter lifecycleStatus = ACTIVE) and are
// 301-redirected to the most relevant active page at the route layer — manual
// admin retirement of an UNDER_REVIEW page is the other path into RETIRED.
//
// Impression/click history comes from search_intelligence (weekly GSC rows),
// matched to pages by the /intelligence/<slug> URL.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { slugFromUrl } from "@/lib/amips/pipelines/search-intelligence.pipeline";
import {
  requiresMarketData,
  isServableLifecycleStatus,
  SERVABLE_LIFECYCLE_STATUSES,
  LIFECYCLE_UNDER_REVIEW,
} from "@/lib/amips/tiers";

/**
 * One recorded lifecycle transition. Persisted inside the cron result JSON so a
 * demotion can be dated and attributed after the fact.
 *
 * The absence of this record cost a full investigation round trip: 31 pages were
 * found demoted with no way to determine which run did it or why, because the
 * three status writes below left no trace and cron_job_logs had aged out.
 */
export interface LifecycleTransition {
  slug: string;
  from: string;
  to: string;
  reason: string;
}

/** Cap on transitions embedded in the cron result, to bound the JSON payload. */
export const MAX_LOGGED_TRANSITIONS = 500;

export interface LifecycleResult {
  flaggedForRefresh: number;
  flaggedForReview: number;
  retired: number;
  /** Every transition this run applied, capped at MAX_LOGGED_TRANSITIONS. */
  transitions: LifecycleTransition[];
  /** True when more transitions occurred than are listed above. */
  transitionsTruncated: boolean;
  /**
   * Whether any page in the corpus has a nonzero leadsGenerated. When false the
   * conversion branch is skipped entirely — see the comment at its call site.
   */
  leadsTrackingActive: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VEHICLE_MAX_AGE_DAYS = 180;
const DEALER_MAX_AGE_DAYS = 90;
const MARKET_MAX_AGE_DAYS = 30;
const NO_IMPRESSIONS_DAYS = 180;
const LOW_CONVERSION_DAYS = 90;
const ZERO_TRAFFIC_DAYS = 365;
const LOW_CONVERSION_THRESHOLD = 0.001; // 0.1%

/**
 * Should this page be demoted for sustained low conversion?
 *
 * `leadsTrackingActive` is the guard that separates "measured zero" from "never
 * measured". Nothing writes AmipsPage.leadsGenerated today, so without it the
 * ratio is 0/clicks for every page that has ever been clicked — which reads as
 * catastrophic conversion and demotes precisely the pages that earn traffic.
 *
 * Pure and synchronous so the decision can be tested without a database.
 */
export function shouldFlagLowConversion(input: {
  leadsTrackingActive: boolean;
  clicks: number;
  leadsGenerated: number;
  pubAgeDays: number | null;
}): boolean {
  const { leadsTrackingActive, clicks, leadsGenerated, pubAgeDays } = input;
  if (!leadsTrackingActive) return false; // signal unavailable, not zero
  if (clicks <= 0) return false;
  if (pubAgeDays === null || pubAgeDays < LOW_CONVERSION_DAYS) return false;
  return leadsGenerated / clicks < LOW_CONVERSION_THRESHOLD;
}

function ageDays(from: Date | null | undefined, now: number): number | null {
  if (!from) return null;
  return (now - new Date(from).getTime()) / DAY_MS;
}

// Staleness applies to the tiers that carry market data. This is the SAME
// authoritative set Quality Gate 5 uses (lib/amips/tiers.ts) — the two must
// never diverge, or a tier gets certified fresh at generation and de-indexed as
// stale a week later.
function isTierCPlus(tier: string): boolean {
  return requiresMarketData(tier);
}

// A page's data is stale if any applicable source has aged past its threshold.
// A missing date is only treated as failure when the tier requires that source;
// otherwise (e.g. a Tier A page with no market date) it is simply not applicable.
export function hasStaleData(
  page: {
    contentTier: string;
    vehicleDataAsOf: Date | null;
    dealerDataAsOf: Date | null;
    marketDataAsOf: Date | null;
  },
  now: number,
): boolean {
  const vAge = ageDays(page.vehicleDataAsOf, now);
  if (vAge !== null && vAge > VEHICLE_MAX_AGE_DAYS) return true;

  if (isTierCPlus(page.contentTier)) {
    const dAge = ageDays(page.dealerDataAsOf, now);
    if (dAge === null || dAge > DEALER_MAX_AGE_DAYS) return true;
    const mAge = ageDays(page.marketDataAsOf, now);
    if (mAge === null || mAge > MARKET_MAX_AGE_DAYS) return true;
  }
  return false;
}

interface TrafficWindow {
  impressions: number;
  clicks: number;
  leads: number;
}

// Aggregate search_intelligence into per-slug traffic windows. Returns lookups
// for the 180/365-day windows plus a 90-day conversion estimate.
async function loadTraffic(now: number): Promise<{
  imp180: Map<string, number>;
  traffic365: Map<string, TrafficWindow>;
}> {
  const since = new Date(now - ZERO_TRAFFIC_DAYS * DAY_MS);
  const rows = await prisma.searchIntelligence.findMany({
    where: { weekOf: { gte: since } },
    select: {
      url: true,
      weekOf: true,
      searchImpressions: true,
      clicks: true,
      leadsGenerated: true,
    },
  });

  const imp180 = new Map<string, number>();
  const traffic365 = new Map<string, TrafficWindow>();
  const cutoff180 = now - NO_IMPRESSIONS_DAYS * DAY_MS;

  for (const r of rows) {
    const slug = slugFromUrl(r.url);
    if (!slug) continue;

    const win365 = traffic365.get(slug) ?? { impressions: 0, clicks: 0, leads: 0 };
    win365.impressions += r.searchImpressions;
    win365.clicks += r.clicks;
    win365.leads += r.leadsGenerated;
    traffic365.set(slug, win365);

    if (new Date(r.weekOf).getTime() >= cutoff180) {
      imp180.set(slug, (imp180.get(slug) ?? 0) + r.searchImpressions);
    }
  }
  return { imp180, traffic365 };
}

/**
 * Run the weekly lifecycle review. Pure transitions — no deletes; RETIRED pages
 * are excluded from sitemaps by query, not removed from the table.
 */
export async function runLifecycleReview(): Promise<LifecycleResult> {
  logger.info("[amips-p3-lifecycle] starting lifecycle review");
  const now = Date.now();

  // Servable statuses are loaded so a live REFRESH_REQUIRED page counts toward
  // duplicate clustering (it is public since FIX 3, so it competes for the
  // entity), plus UNDER_REVIEW for the retirement branch. Pages in a servable
  // state other than ACTIVE fall through both branches below without a write.
  const pages = await prisma.amipsPage.findMany({
    where: {
      lifecycleStatus: { in: [...SERVABLE_LIFECYCLE_STATUSES, LIFECYCLE_UNDER_REVIEW] },
    },
    select: {
      id: true,
      slug: true,
      make: true,
      model: true,
      metro: true,
      contentTier: true,
      lifecycleStatus: true,
      vehicleDataAsOf: true,
      dealerDataAsOf: true,
      marketDataAsOf: true,
      publishedAt: true,
      impressions: true,
      clicks: true,
      leadsGenerated: true,
    },
  });

  const { imp180, traffic365 } = await loadTraffic(now);

  // Duplicate-cluster detection over the SERVABLE set: pages sharing the same
  // make+model+metro. The strongest page (most impressions, then earliest
  // published) is canonical; the rest are flagged for review.
  //
  // Servable, not ACTIVE: a REFRESH_REQUIRED page is public, so it occupies its
  // entity and must be able to win canonical. Clustering only ACTIVE pages would
  // leave an ACTIVE duplicate live alongside it, undetected.
  const clusters = new Map<string, typeof pages>();
  for (const p of pages) {
    // Cluster on what is PUBLIC, not on what is ACTIVE. Since FIX 3 a
    // REFRESH_REQUIRED page is served and listed, so it occupies the entity and
    // must be able to win canonical — otherwise an ACTIVE duplicate would be
    // left live alongside it, undetected.
    if (!isServableLifecycleStatus(p.lifecycleStatus)) continue;
    if (!p.make || !p.model || !p.metro) continue;
    const key = `${p.make}|${p.model}|${p.metro}`.toLowerCase();
    const list = clusters.get(key) ?? [];
    list.push(p);
    clusters.set(key, list);
  }
  const duplicateIds = new Set<string>();
  for (const list of clusters.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      if (b.impressions !== a.impressions) return b.impressions - a.impressions;
      const at = a.publishedAt ? new Date(a.publishedAt).getTime() : Infinity;
      const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : Infinity;
      return at - bt;
    });
    for (const dup of sorted.slice(1)) duplicateIds.add(dup.id);
  }

  let flaggedForRefresh = 0;
  let flaggedForReview = 0;
  let retired = 0;
  const transitions: LifecycleTransition[] = [];
  let transitionsTruncated = false;

  const record = (slug: string, from: string, to: string, reason: string): void => {
    if (transitions.length < MAX_LOGGED_TRANSITIONS) {
      transitions.push({ slug, from, to, reason });
    } else {
      transitionsTruncated = true;
    }
  };

  // Nothing writes AmipsPage.leadsGenerated today, so a 0/clicks ratio measures
  // the ABSENCE OF INSTRUMENTATION, not the absence of conversions. Treating the
  // two as the same thing would de-index every page that earns a click the
  // moment a click is ever recorded. Until at least one page reports a lead, the
  // conversion signal is "unknown" and the branch below is skipped.
  const leadsTrackingActive = pages.some((p) => p.leadsGenerated > 0);
  if (!leadsTrackingActive) {
    logger.info(
      "[amips-p3-lifecycle] no page reports leadsGenerated > 0 — conversion review skipped (signal unavailable, not zero)",
    );
  }

  for (const p of pages) {
    const pubAge = ageDays(p.publishedAt, now);

    if (p.lifecycleStatus === "ACTIVE") {
      // 1) Refresh — data integrity takes priority over review.
      const stale = hasStaleData(p, now);
      const noImpressions =
        pubAge !== null &&
        pubAge >= NO_IMPRESSIONS_DAYS &&
        (imp180.get(p.slug) ?? 0) === 0;

      if (stale || noImpressions) {
        await prisma.amipsPage.update({
          where: { id: p.id },
          data: { lifecycleStatus: "REFRESH_REQUIRED" },
        });
        flaggedForRefresh++;
        record(
          p.slug,
          "ACTIVE",
          "REFRESH_REQUIRED",
          stale ? "stale_data" : "no_impressions_180d",
        );
        continue;
      }

      // 2) Review — duplicate cluster or sustained low conversion.
      const duplicate = duplicateIds.has(p.id);
      const lowConversion = shouldFlagLowConversion({
        leadsTrackingActive,
        clicks: p.clicks,
        leadsGenerated: p.leadsGenerated,
        pubAgeDays: pubAge,
      });

      if (duplicate || lowConversion) {
        await prisma.amipsPage.update({
          where: { id: p.id },
          data: { lifecycleStatus: "UNDER_REVIEW" },
        });
        flaggedForReview++;
        record(
          p.slug,
          "ACTIVE",
          "UNDER_REVIEW",
          duplicate ? "duplicate_cluster" : "low_conversion_90d",
        );
      }
      continue;
    }

    // UNDER_REVIEW → RETIRED: no impressions AND no clicks for 365 days.
    //
    // KNOWN GAP (not in this batch's authorized scope): traffic365 is built from
    // search_intelligence, which is empty while the Search Console sync returns
    // synced: 0, and p.impressions/p.clicks are only written by that same sync.
    // Every input therefore reads zero for every page regardless of real traffic,
    // so this branch cannot currently distinguish "no traffic" from "no
    // measurement". It is unreachable until a page is 365 days old (earliest
    // cohort: 2027-06-08) and only applies to pages already withheld from the
    // index, so no page is at risk today — but it needs the same
    // measurement-available guard as shouldFlagLowConversion() before then.
    if (p.lifecycleStatus === "UNDER_REVIEW") {
      const win = traffic365.get(p.slug);
      const noTraffic =
        pubAge !== null &&
        pubAge >= ZERO_TRAFFIC_DAYS &&
        (win?.impressions ?? 0) === 0 &&
        (win?.clicks ?? 0) === 0 &&
        p.impressions === 0 &&
        p.clicks === 0;

      if (noTraffic) {
        await prisma.amipsPage.update({
          where: { id: p.id },
          data: { lifecycleStatus: "RETIRED" },
        });
        retired++;
        record(p.slug, "UNDER_REVIEW", "RETIRED", "zero_traffic_365d");
      }
    }
  }

  logger.info(
    `[amips-p3-lifecycle] done — refresh ${flaggedForRefresh}, review ${flaggedForReview}, retired ${retired}, leadsTracking=${leadsTrackingActive}`,
  );
  // `transitions` rides in the cron result, which withCronRun persists to
  // cron_job_logs.result (Json). No new table: the existing payload carries the
  // audit trail, so every demotion is dateable and attributable from then on.
  return {
    flaggedForRefresh,
    flaggedForReview,
    retired,
    transitions,
    transitionsTruncated,
    leadsTrackingActive,
  };
}
