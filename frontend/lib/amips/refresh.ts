// AMIPS — refresh planning.
//
// THE GAP THIS CLOSES
// lifecycle-manager demotes ACTIVE → REFRESH_REQUIRED and nothing anywhere
// promotes back: the status is a one-way door. Compounding it, the two pipelines
// that refresh the underlying data (syncMarketIntelligence, computeMarketScoreBatch)
// are reachable only from admin routes — no cron runs them — so the data a page
// is judged against never got newer on its own. Pages went stale, were demoted,
// and stayed demoted.
//
// WHY THIS NEVER WRITES AN AS-OF DATE
// A page's body embeds real numbers: Quality Gate 1 requires at least three, and
// the assembler feeds them in as dataTokens. Moving marketDataAsOf forward
// without rewriting the body would publish last quarter's figures under this
// week's date — the page would assert freshness it does not have. So refreshing
// is REGENERATION, never a timestamp bump: this module decides only WHICH pages
// to re-open for the existing generator, and generateAmipsPage rewrites body,
// as-of dates and lifecycleStatus together, through the quality gate, as one
// upsert keyed on the same slug.
//
// This module is pure so every rule below is testable without a database.

import { hasStaleData, hasNoImpressions } from "@/lib/amips/lifecycle-manager";

/** A REFRESH_REQUIRED page, joined to the queue item that produced it. */
export interface RefreshCandidate {
  id: string;
  slug: string;
  contentTier: string;
  publishedAt: Date | null;
  /**
   * The as-of dates a regeneration WOULD write — read from the SOURCE rows
   * (marketIntelligence, amipsMarketScore, vehicleIntelligence) after the
   * source refresh has run, not from the page's own columns.
   *
   * This distinction is the whole point. A page's stored vehicleDataAsOf /
   * dealerDataAsOf / marketDataAsOf only change when the page is regenerated,
   * so immediately after a successful source refresh they are still the old
   * values. Judging eligibility on them would mark every page "still stale"
   * and the cron would never requeue anything — it would run daily, report
   * work, and change nothing. The question that actually decides eligibility
   * is whether the data a regeneration is about to read is fresh.
   */
  projectedVehicleDataAsOf: Date | null;
  projectedDealerDataAsOf: Date | null;
  projectedMarketDataAsOf: Date | null;
  /**
   * The ContentQueue row whose keywordTarget produced this page's slug, found
   * via ContentQueue.contentPageId. Null when the link is missing — see
   * "no_queue_item" below.
   */
  queueItemId: string | null;
  /** Queue priority, carried through so the budget spends on the best pages. */
  priorityScore: number;
  /**
   * True when the page's queue row already carries the entity guard's
   * duplicate-entity verdict. Read from the guard rather than re-derived, so
   * the two cannot disagree about what counts as a duplicate.
   */
  blockedAsDuplicate: boolean;
}

export type RefreshSkipReason =
  /** The SOURCE rows are still stale after the refresh — the upstream data for
   *  this metro/vehicle did not get newer, so regenerating would fail Gate 5
   *  and land the page in UNDER_REVIEW, strictly worse than the
   *  REFRESH_REQUIRED it already sits in. Reported so a persistent count here
   *  points at the real problem: a source the refresh does not cover. */
  | "still_stale"
  /** Demoted for earning no impressions, not for staleness. Fresh data does not
   *  make a page people do not read worth regenerating; the next lifecycle run
   *  would demote it again on the same rule. */
  | "no_impressions"
  /** No ContentQueue row links to this page, so its keywordTarget — the only
   *  input that reproduces its slug — is unrecoverable. Regenerating from a
   *  guessed keyword would mint a SECOND page at a different slug rather than
   *  refresh this one. Reported, never guessed at. */
  | "no_queue_item"
  /** The generator already refused this page: a sibling covers the same
   *  (make, model, metro), so the entity guard fails it before the LLM call.
   *  Re-opening it nightly would fail the same check forever — and clearing its
   *  failureReason would erase the verdict that says so. The duplicate cluster
   *  is a repair problem (lifecycle-repair.ts), not a refresh problem. */
  | "duplicate_entity"
  /** Eligible, but the run's regeneration budget was already spent. */
  | "over_budget";

export type RefreshDisposition =
  | { action: "requeue"; queueItemId: string }
  | { action: "skip"; reason: RefreshSkipReason };

/**
 * Decide what to do with ONE REFRESH_REQUIRED page, assuming the source-data
 * refresh has already run.
 *
 * Order matters. Staleness is checked first because it is the condition this
 * cron exists to clear; a page that is still stale afterwards is telling us the
 * upstream row is missing, which is a different problem from an unread page.
 */
export function planPageRefresh(
  page: RefreshCandidate,
  ctx: { now: number; impressions180: number },
): RefreshDisposition {
  // Judged on the PROJECTED dates — what a regeneration would write — so the
  // same freshness authority the quality gate and lifecycle manager use decides
  // this too, applied to the data that is actually about to be read.
  const wouldStillBeStale = hasStaleData(
    {
      contentTier: page.contentTier,
      vehicleDataAsOf: page.projectedVehicleDataAsOf,
      dealerDataAsOf: page.projectedDealerDataAsOf,
      marketDataAsOf: page.projectedMarketDataAsOf,
    },
    ctx.now,
  );
  if (wouldStillBeStale) {
    return { action: "skip", reason: "still_stale" };
  }

  const pubAgeDays =
    page.publishedAt === null
      ? null
      : (ctx.now - page.publishedAt.getTime()) / (24 * 60 * 60 * 1000);

  if (hasNoImpressions({ pubAgeDays, impressions180: ctx.impressions180 })) {
    return { action: "skip", reason: "no_impressions" };
  }

  if (page.queueItemId === null) {
    return { action: "skip", reason: "no_queue_item" };
  }

  if (page.blockedAsDuplicate) {
    return { action: "skip", reason: "duplicate_entity" };
  }

  return { action: "requeue", queueItemId: page.queueItemId };
}

/**
 * How many pages one run may re-open for regeneration.
 *
 * amips-generate takes BATCH_LIMIT (17) items per run at 06:00/14:00/22:00 —
 * about 51 generations a day, shared with brand-new pages from the content
 * queue. Re-opening the whole backlog (production carries hundreds of demoted
 * pages) would monopolise every slot for days and starve new coverage, so a
 * refresh run claims at most a third of one day's throughput and the backlog
 * drains over successive days, newest-priority first.
 */
export const REFRESH_REQUEUE_BUDGET = 17;

/**
 * Apply the budget to an ordered candidate list.
 *
 * Ordering is the caller's (priorityScore desc). Only pages that would actually
 * be re-opened consume budget — a skip is free, so one unusable page never
 * costs another page its slot.
 */
export function planRefreshBatch(
  pages: readonly RefreshCandidate[],
  ctx: { now: number; impressions180: Map<string, number>; budget?: number },
): Array<{ page: RefreshCandidate; disposition: RefreshDisposition }> {
  const budget = ctx.budget ?? REFRESH_REQUEUE_BUDGET;
  let spent = 0;

  return pages.map((page) => {
    const disposition = planPageRefresh(page, {
      now: ctx.now,
      impressions180: ctx.impressions180.get(page.slug) ?? 0,
    });
    if (disposition.action !== "requeue") return { page, disposition };

    if (spent >= budget) {
      return { page, disposition: { action: "skip", reason: "over_budget" as const } };
    }
    spent += 1;
    return { page, disposition };
  });
}
