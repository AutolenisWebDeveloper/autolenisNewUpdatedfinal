// lib/crm/coverage.ts
// PHASE F — "No Lead Left Behind" (NLLB) coverage KPI.
//
// Surfaces the forbidden 4th state from the System Overview: a live, contactable
// contact that is NOT in an active campaign, NOT in re-engagement, NOT suppressed,
// and has gone stale (or was never contacted). The daily reconcile sweep
// (PHASE A, /api/crm/reconcile/run) drives this count toward ~0; this module is
// the read-side that reports it.
//
// The selection rule MUST agree with reconcile-selection.ts: "uncovered" =
// deleted_at IS NULL AND do_not_contact=false AND nurture_status='none' AND
// (last_contacted_at IS NULL OR last_contacted_at < now() - staleDays).
//
// `summarizeCoverage` is a pure function (dependency-free, unit-tested) so the
// derived KPIs are verifiable without a DB; `getCoverageSummary` runs the count
// queries and feeds it.

import type { SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_STALE_DAYS = 30;

// Raw counts pulled from `contacts` (each query is a single COUNT, head-only).
export interface RawCoverageCounts {
  totalLive: number; // deleted_at IS NULL
  doNotContact: number; // deleted_at IS NULL AND do_not_contact = true
  // The next four are all within the contactable set
  // (deleted_at IS NULL AND do_not_contact = false), partitioned by nurture_status:
  active: number; // nurture_status = 'active'
  reengagement: number; // nurture_status = 'reengagement'
  suppressedStatus: number; // nurture_status = 'suppressed'
  none: number; // nurture_status = 'none'
  // Subset of `none` that is stale/never-contacted — the NLLB KPI.
  uncovered: number;
}

export type CoverageStatus = 'clear' | 'attention' | 'critical';

export interface CoverageSummary {
  staleDays: number;
  totalLive: number; // all non-deleted contacts
  contactable: number; // totalLive - doNotContact
  doNotContact: number; // hard-suppressed plane (outside contactable)
  suppressedStatus: number; // nurture_status='suppressed' (within contactable)
  suppressed: number; // doNotContact + suppressedStatus (both "held out" planes)
  active: number; // in an active campaign
  reengagement: number; // being re-engaged
  covered: number; // active + reengagement
  none: number; // nurture_status='none' (contactable)
  graceNone: number; // 'none' but recently contacted (not yet stale) — none - uncovered
  uncovered: number; // KPI → drive to ~0
  coverageRate: number; // covered / contactable (0..1)
  uncoveredRate: number; // uncovered / contactable (0..1)
  status: CoverageStatus; // KPI health for the dashboard banner
}

// Pure: derive the dashboard summary from raw counts. No DB, no clock.
export function summarizeCoverage(
  counts: RawCoverageCounts,
  staleDays: number = DEFAULT_STALE_DAYS,
): CoverageSummary {
  const contactable = Math.max(0, counts.totalLive - counts.doNotContact);
  const covered = counts.active + counts.reengagement;
  const suppressed = counts.doNotContact + counts.suppressedStatus;
  const graceNone = Math.max(0, counts.none - counts.uncovered);
  const uncoveredRate = contactable > 0 ? counts.uncovered / contactable : 0;
  const coverageRate = contactable > 0 ? covered / contactable : 0;

  // Target is ~0 uncovered. Anything above a small fraction is escalated.
  const status: CoverageStatus =
    counts.uncovered === 0 ? 'clear' : uncoveredRate <= 0.05 ? 'attention' : 'critical';

  return {
    staleDays,
    totalLive: counts.totalLive,
    contactable,
    doNotContact: counts.doNotContact,
    suppressedStatus: counts.suppressedStatus,
    suppressed,
    active: counts.active,
    reengagement: counts.reengagement,
    covered,
    none: counts.none,
    graceNone,
    uncovered: counts.uncovered,
    coverageRate,
    uncoveredRate,
    status,
  };
}

// Minimal shape we need off the Supabase count responses.
type CountResult = { count: number | null; error: { message: string } | null };

// Runs the coverage COUNT queries against Supabase and returns the summary.
// Mirrors the reconcile route's coarse filter so the dashboard and the sweep
// report the same population.
export async function getCoverageSummary(
  supabase: SupabaseClient,
  opts: { staleDays?: number; now?: Date } = {},
): Promise<CoverageSummary> {
  const staleDays = Number.isFinite(opts.staleDays)
    ? Number(opts.staleDays)
    : DEFAULT_STALE_DAYS;
  const now = opts.now ?? new Date();
  const cutoffIso = new Date(now.getTime() - staleDays * 86_400_000).toISOString();

  const base = () =>
    supabase.from('contacts').select('id', { count: 'exact', head: true }).is('deleted_at', null);
  const contactable = () => base().eq('do_not_contact', false);

  const [
    totalLive,
    doNotContact,
    active,
    reengagement,
    suppressedStatus,
    none,
    uncovered,
  ] = (await Promise.all([
    base(),
    base().eq('do_not_contact', true),
    contactable().eq('nurture_status', 'active'),
    contactable().eq('nurture_status', 'reengagement'),
    contactable().eq('nurture_status', 'suppressed'),
    contactable().eq('nurture_status', 'none'),
    contactable()
      .eq('nurture_status', 'none')
      .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoffIso}`),
  ])) as unknown as CountResult[];

  const firstError = [
    totalLive,
    doNotContact,
    active,
    reengagement,
    suppressedStatus,
    none,
    uncovered,
  ].find((r) => r.error);
  if (firstError?.error) {
    throw new Error(`coverage query failed: ${firstError.error.message}`);
  }

  return summarizeCoverage(
    {
      totalLive: totalLive.count ?? 0,
      doNotContact: doNotContact.count ?? 0,
      active: active.count ?? 0,
      reengagement: reengagement.count ?? 0,
      suppressedStatus: suppressedStatus.count ?? 0,
      none: none.count ?? 0,
      uncovered: uncovered.count ?? 0,
    },
    staleDays,
  );
}
