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

export interface LifecycleResult {
  flaggedForRefresh: number;
  flaggedForReview: number;
  retired: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VEHICLE_MAX_AGE_DAYS = 180;
const DEALER_MAX_AGE_DAYS = 90;
const MARKET_MAX_AGE_DAYS = 30;
const NO_IMPRESSIONS_DAYS = 180;
const LOW_CONVERSION_DAYS = 90;
const ZERO_TRAFFIC_DAYS = 365;
const LOW_CONVERSION_THRESHOLD = 0.001; // 0.1%

function ageDays(from: Date | null | undefined, now: number): number | null {
  if (!from) return null;
  return (now - new Date(from).getTime()) / DAY_MS;
}

function isTierCPlus(tier: string): boolean {
  return tier === "C" || tier === "D" || tier === "E" || tier === "F";
}

// A page's data is stale if any applicable source has aged past its threshold.
// A missing date is only treated as failure when the tier requires that source;
// otherwise (e.g. a Tier A page with no market date) it is simply not applicable.
function hasStaleData(
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

  const pages = await prisma.amipsPage.findMany({
    where: { lifecycleStatus: { in: ["ACTIVE", "UNDER_REVIEW"] } },
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

  // Duplicate-cluster detection over the ACTIVE set: pages sharing the same
  // make+model+metro. The strongest page (most impressions, then earliest
  // published) is canonical; the rest are flagged for review.
  const clusters = new Map<string, typeof pages>();
  for (const p of pages) {
    if (p.lifecycleStatus !== "ACTIVE") continue;
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
        continue;
      }

      // 2) Review — duplicate cluster or sustained low conversion.
      const duplicate = duplicateIds.has(p.id);
      const conversion = p.clicks > 0 ? p.leadsGenerated / p.clicks : null;
      const lowConversion =
        pubAge !== null &&
        pubAge >= LOW_CONVERSION_DAYS &&
        conversion !== null &&
        conversion < LOW_CONVERSION_THRESHOLD;

      if (duplicate || lowConversion) {
        await prisma.amipsPage.update({
          where: { id: p.id },
          data: { lifecycleStatus: "UNDER_REVIEW" },
        });
        flaggedForReview++;
      }
      continue;
    }

    // UNDER_REVIEW → RETIRED: no impressions AND no clicks for 365 days.
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
      }
    }
  }

  logger.info(
    `[amips-p3-lifecycle] done — refresh ${flaggedForRefresh}, review ${flaggedForReview}, retired ${retired}`,
  );
  return { flaggedForRefresh, flaggedForReview, retired };
}
