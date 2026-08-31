// lib/amips/refresh.service.ts — the I/O half of the AMIPS refresh.
//
// WHAT THIS CLOSES
// lifecycle-manager demotes ACTIVE → REFRESH_REQUIRED and nothing promoted back:
// REFRESH_REQUIRED was a one-way door. The reason it filled up is upstream —
// syncMarketIntelligence() and computeMarketScoreBatch() were reachable only
// from admin routes, so unless somebody clicked, the data every page is judged
// against never got newer. This runs both on a schedule and then re-opens the
// pages the refresh actually rescued.
//
// WHY REGENERATION AND NOT A TIMESTAMP BUMP
// A page's body embeds real numbers — Quality Gate 1 requires at least three.
// Writing a newer marketDataAsOf onto a page whose body still narrates last
// quarter's figures would publish a freshness claim the page cannot support.
// So this service never writes an as-of date. It re-opens the page's OWN
// ContentQueue row and lets the existing generator do the work: because
// slug = slugify(keywordTarget), generateAmipsPage upserts the same slug and
// rewrites body, as-of dates and lifecycleStatus together, through the quality
// gate, in one statement. Regeneration is throttled by amips-generate's own
// batch limit, which is also why this run is budgeted rather than draining the
// whole backlog at once.
//
// ORDERING IS LOAD-BEARING
// Sources are refreshed BEFORE candidates are evaluated, and a source failure
// aborts the requeue entirely. Re-opening pages against data that did not get
// newer would regenerate them straight into UNDER_REVIEW on Gate 5 — strictly
// worse than the REFRESH_REQUIRED they started in, and it would burn the LLM
// budget doing it.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { syncMarketIntelligence } from "@/lib/amips/pipelines/market-intelligence.pipeline";
import { computeMarketScoreBatch } from "@/lib/amips/pipelines/market-score-batch.pipeline";
import { loadTraffic } from "@/lib/amips/lifecycle-manager";
import { LIFECYCLE_REFRESH_REQUIRED, tierFDataAsOf } from "@/lib/amips/tiers";
import { DUPLICATE_ENTITY_FAILURE_PREFIX } from "@/lib/amips/amips-generator";
import {
  planRefreshBatch,
  REFRESH_REQUEUE_BUDGET,
  type RefreshCandidate,
  type RefreshSkipReason,
} from "@/lib/amips/refresh";

/** Bound on the demoted backlog read per run. Production carries hundreds. */
const CANDIDATE_QUERY_LIMIT = 1000;

export interface AmipsRefreshResult {
  /** Source-pipeline output, or null when the refresh failed before running. */
  sources: {
    metros: number;
    scored: number;
    combinations: number;
    computed: number;
  } | null;
  /** Set when a source pipeline threw; the requeue is skipped entirely. */
  sourceRefreshError: string | null;
  candidates: number;
  requeued: number;
  requeuedSlugs: string[];
  skipped: Record<RefreshSkipReason, number>;
  budget: number;
}

function emptySkips(): Record<RefreshSkipReason, number> {
  return {
    still_stale: 0,
    no_impressions: 0,
    no_queue_item: 0,
    duplicate_entity: 0,
    over_budget: 0,
  };
}

/**
 * Refresh the AMIPS source data, then re-open the demoted pages it rescued.
 */
export async function runAmipsRefresh(now: Date = new Date()): Promise<AmipsRefreshResult> {
  const result: AmipsRefreshResult = {
    sources: null,
    sourceRefreshError: null,
    candidates: 0,
    requeued: 0,
    requeuedSlugs: [],
    skipped: emptySkips(),
    budget: REFRESH_REQUEUE_BUDGET,
  };

  // 1 — Refresh the sources. Sequential, not parallel: computeMarketScoreBatch
  // reads the marketIntelligence rows syncMarketIntelligence writes, so running
  // them together would score half the metros against the previous snapshot.
  try {
    const market = await syncMarketIntelligence();
    const scores = await computeMarketScoreBatch();
    result.sources = {
      metros: market.metros,
      scored: market.scored,
      combinations: scores.combinations,
      computed: scores.computed,
    };
  } catch (e) {
    // Reported, not thrown: the run stays COMPLETED so this diagnosis survives
    // in the result JSONB (failCronRun REPLACES result with { build }), and the
    // requeue below is skipped rather than run against unrefreshed data.
    result.sourceRefreshError = e instanceof Error ? e.message : String(e);
    logger.error("[amips-refresh] source refresh failed — requeue skipped:", e);
    return result;
  }

  // 2 — The demoted backlog.
  const pages = await prisma.amipsPage.findMany({
    where: { lifecycleStatus: LIFECYCLE_REFRESH_REQUIRED },
    select: {
      id: true,
      slug: true,
      contentTier: true,
      make: true,
      model: true,
      metro: true,
      publishedAt: true,
    },
    take: CANDIDATE_QUERY_LIMIT,
  });
  result.candidates = pages.length;
  if (pages.length === 0) return result;

  // 3 — The queue rows that produced them. One `in` query rather than a lookup
  // per page: content_queue has no index on contentPageId, so N queries would be
  // N sequential scans.
  const queueItems = await prisma.contentQueue.findMany({
    where: { contentPageId: { in: pages.map((p) => p.id) } },
    select: {
      id: true,
      contentPageId: true,
      priorityScore: true,
      status: true,
      failureReason: true,
    },
  });
  const queueByPage = new Map(
    queueItems.flatMap((q) => (q.contentPageId ? [[q.contentPageId, q] as const] : [])),
  );

  // 4 — The as-of dates a regeneration WOULD write, read from the just-refreshed
  // source rows. Not the pages' own columns: those only change when a page is
  // regenerated, so judging on them would find every page still stale and this
  // cron would requeue nothing, forever.
  const [markets, scores, vehicles, autolenis] = await Promise.all([
    prisma.marketIntelligence.findMany({ select: { metroName: true, lastUpdated: true } }),
    prisma.amipsMarketScore.findMany({
      select: { make: true, model: true, metro: true, computedAt: true },
    }),
    prisma.vehicleIntelligence.findMany({ select: { make: true, model: true, lastUpdated: true } }),
    prisma.autolenisIntelligence.findMany({
      select: { metro: true, vehicleMake: true, vehicleModel: true, lastUpdated: true },
    }),
  ]);

  const marketAsOf = new Map(markets.map((m) => [m.metroName, m.lastUpdated]));
  const scoreAsOf = new Map(scores.map((s) => [`${s.make}|${s.model}|${s.metro}`, s.computedAt]));
  const autolenisAsOf = new Map(
    autolenis.map((a) => [`${a.vehicleMake}|${a.vehicleModel}|${a.metro}`, a.lastUpdated]),
  );
  // The assembler picks the cheapest trim per make/model; freshness is a
  // per-model property, so the newest row for a make/model is the right proxy.
  const vehicleAsOf = new Map<string, Date>();
  for (const v of vehicles) {
    const key = `${v.make}|${v.model}`;
    const seen = vehicleAsOf.get(key);
    if (!seen || v.lastUpdated > seen) vehicleAsOf.set(key, v.lastUpdated);
  }

  const { imp180 } = await loadTraffic(now.getTime());

  const candidates: RefreshCandidate[] = pages.map((p) => {
    const vk = `${p.make}|${p.model}`;
    const ck = `${p.make}|${p.model}|${p.metro}`;
    const projectedVehicle = vehicleAsOf.get(vk) ?? null;
    let projectedDealer = scoreAsOf.get(ck) ?? null;
    let projectedMarket = p.metro ? (marketAsOf.get(p.metro) ?? null) : null;

    // Tier F carries the same fallback the assembler applies: its market rows
    // are optional, and the transaction record is its authority. Reusing
    // tierFDataAsOf keeps this projection and the assembler on one rule.
    if (p.contentTier === "F") {
      const txn = autolenisAsOf.get(ck);
      if (txn) {
        const fallback = tierFDataAsOf({
          scoreComputedAt: projectedDealer,
          marketLastUpdated: projectedMarket,
          transactionLastUpdated: txn,
        });
        projectedDealer = fallback.dealerDataAsOf;
        projectedMarket = fallback.marketDataAsOf;
      }
    }

    const q = queueByPage.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      contentTier: p.contentTier,
      publishedAt: p.publishedAt,
      projectedVehicleDataAsOf: projectedVehicle,
      projectedDealerDataAsOf: projectedDealer,
      projectedMarketDataAsOf: projectedMarket,
      queueItemId: q?.id ?? null,
      priorityScore: q?.priorityScore ?? 0,
      blockedAsDuplicate:
        q?.failureReason?.startsWith(DUPLICATE_ENTITY_FAILURE_PREFIX) ?? false,
    };
  });

  // 5 — Best pages first, so a budgeted run spends on what earns most.
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  const plan = planRefreshBatch(candidates, { now: now.getTime(), impressions180: imp180 });

  const toRequeue: string[] = [];
  for (const { page, disposition } of plan) {
    if (disposition.action === "requeue") {
      toRequeue.push(disposition.queueItemId);
      result.requeuedSlugs.push(page.slug);
    } else {
      result.skipped[disposition.reason] += 1;
    }
  }

  // 6 — Re-open them. Idempotent: a second run in the same window rewrites the
  // same rows to the same state.
  //
  // failureReason is cleared only for rows we are actually re-opening, and rows
  // carrying the entity guard's duplicate verdict are never among them (they are
  // skipped above). Clearing it indiscriminately would erase the very record that
  // stops a page in a duplicate cluster from being re-opened, failed, cleared and
  // re-opened again every night.
  if (toRequeue.length > 0) {
    const updated = await prisma.contentQueue.updateMany({
      where: { id: { in: toRequeue } },
      data: { status: "pending", failureReason: null },
    });
    result.requeued = updated.count;
  }

  logger.info(
    `[amips-refresh] candidates=${result.candidates} requeued=${result.requeued} ` +
      `still_stale=${result.skipped.still_stale} no_impressions=${result.skipped.no_impressions} ` +
      `no_queue_item=${result.skipped.no_queue_item} duplicate=${result.skipped.duplicate_entity} ` +
      `over_budget=${result.skipped.over_budget}`,
  );
  return result;
}
