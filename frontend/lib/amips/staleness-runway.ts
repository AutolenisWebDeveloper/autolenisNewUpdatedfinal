// lib/amips/staleness-runway.ts — how long before the servable AMIPS corpus
// starts going dark, and how loudly to say so.
//
// WHY THIS EXISTS
// STALE_WITHHOLD_DAYS bounds how stale a page may be before it stops serving.
// The bound is correct, but it fires SILENTLY, and owner verification showed the
// shape of the problem is worse than a gradual ramp:
//
//   all 393 servable pages share a withhold date of 2026-12-04
//
// Every AMIPS page was generated from one VehicleIntelligence seed run, so every
// page's vehicle_data_as_of is the same day — including the 185 ACTIVE Tier B
// pages, whose market and dealer dates are null but whose vehicle date is
// populated and therefore applicable. The corpus does not decay page by page; it
// goes to 404 in a single day.
//
// A cliff with no warning is an outage waiting to happen, so the runway is
// computed on a schedule and escalated before it arrives.
//
// WHY THE THRESHOLDS ARE WHAT THEY ARE — LEAD TIME IS THE WHOLE POINT
// Refreshing the source data is NOT automated and this batch does not automate
// it. It requires either running lib/amips/seed/vehicle-intelligence.seed.ts
// against production (a person, a terminal, production DB access) or an
// authenticated admin POST to /api/admin/amips/sync-market-intelligence. So the
// thresholds are sized to HUMAN SCHEDULING, not machine reaction time: each one
// marks the point at which the remaining runway still permits a particular kind
// of response.
//
//   > 90d  OK       Beyond a quarter. Recorded, not alerted — alerting this far
//                   out teaches people to ignore the alert.
//   <= 90d NOTICE   One quarter: the first point at which the refresh can be put
//                   INTO a planning cycle rather than interrupting one.
//   <= 45d WARN     A monthly cycle plus half. If the notice was missed, there is
//                   still room to schedule, run and verify without displacing
//                   planned work. 30 would be exactly one cycle with zero slack.
//   <= 21d CRITICAL Three weeks covers a standard two-week absence plus a week to
//                   act. Below this there is no guarantee the person who can run
//                   the seed is even available before the cliff — which is why
//                   this is not 14.
//   <= 0d  CRITICAL Pages are dark now.
//
// Severity maps onto the EXISTING platform alert levels (HealthAlertLevel), and
// escalation is expressed through the alert TITLE, which is how
// health-alert.service.ts documents breaking through an already-open lower alert.

import { STALE_WITHHOLD_DAYS, oldestApplicableDataAsOf, type DataAsOfBearing } from "@/lib/amips/tiers";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runway thresholds in days. See the header for why each one is where it is. */
export const RUNWAY_NOTICE_DAYS = 90;
export const RUNWAY_WARN_DAYS = 45;
export const RUNWAY_CRITICAL_DAYS = 21;

export type RunwaySeverity = "OK" | "NOTICE" | "WARN" | "CRITICAL";

export interface StalenessRunway {
  /** Pages considered — servable by lifecycle status. */
  servablePages: number;
  /** Pages with no applicable as-of date; they never withhold and are excluded. */
  undatedPages: number;
  /** Days until the FIRST page withholds. Negative once the cliff has passed. */
  minDaysToWithhold: number | null;
  /** ISO date (YYYY-MM-DD) on which the first page withholds. */
  firstWithholdDate: string | null;
  /** True when every dated page shares one withhold date — a cliff, not a ramp. */
  isSingleDayCliff: boolean;
  /** Pages withholding within N days of now (cumulative). */
  within30: number;
  within60: number;
  within90: number;
  /** Pages already past the bound — serving nothing despite a servable status. */
  alreadyWithheld: number;
  severity: RunwaySeverity;
}

/** Whole days from `now` until this page crosses STALE_WITHHOLD_DAYS. */
export function daysToWithhold(page: DataAsOfBearing, now: number): number | null {
  const oldest = oldestApplicableDataAsOf(page);
  if (!oldest) return null;
  const withholdAt = oldest.getTime() + STALE_WITHHOLD_DAYS * DAY_MS;
  return Math.floor((withholdAt - now) / DAY_MS);
}

/** Map a remaining-days figure onto the escalation ladder. */
export function runwaySeverity(minDays: number | null): RunwaySeverity {
  if (minDays === null) return "OK"; // nothing dated, nothing to withhold
  if (minDays <= 0) return "CRITICAL";
  if (minDays <= RUNWAY_CRITICAL_DAYS) return "CRITICAL";
  if (minDays <= RUNWAY_WARN_DAYS) return "WARN";
  if (minDays <= RUNWAY_NOTICE_DAYS) return "NOTICE";
  return "OK";
}

/**
 * Compute the runway across the servable corpus. Pure — the caller supplies the
 * pages, so this is testable without a database.
 */
export function computeStalenessRunway(
  pages: readonly DataAsOfBearing[],
  now: number,
): StalenessRunway {
  const dated: number[] = [];
  let undatedPages = 0;

  for (const p of pages) {
    const d = daysToWithhold(p, now);
    if (d === null) undatedPages++;
    else dated.push(d);
  }

  if (dated.length === 0) {
    return {
      servablePages: pages.length,
      undatedPages,
      minDaysToWithhold: null,
      firstWithholdDate: null,
      isSingleDayCliff: false,
      within30: 0,
      within60: 0,
      within90: 0,
      alreadyWithheld: 0,
      severity: "OK",
    };
  }

  const minDays = Math.min(...dated);
  const firstWithholdDate = new Date(now + minDays * DAY_MS).toISOString().slice(0, 10);

  return {
    servablePages: pages.length,
    undatedPages,
    minDaysToWithhold: minDays,
    firstWithholdDate,
    // Every dated page landing on one day is the signal that this is a cliff.
    // Worth reporting on its own: a ramp can be absorbed, a cliff cannot.
    isSingleDayCliff: new Set(dated).size === 1,
    // Cumulative buckets — a page in within30 is also in within60 and within90.
    within30: dated.filter((d) => d <= 30).length,
    within60: dated.filter((d) => d <= 60).length,
    within90: dated.filter((d) => d <= 90).length,
    alreadyWithheld: dated.filter((d) => d <= 0).length,
    severity: runwaySeverity(minDays),
  };
}

/** Alert title. Escalation lives in the title so a higher severity breaks
 *  through an already-open lower one — see health-alert.service.ts. */
export function runwayAlertTitle(severity: RunwaySeverity): string {
  return `AMIPS staleness runway — ${severity}`;
}

/** Human-readable alert body naming the remedy, since the remedy is manual. */
export function runwayAlertBody(r: StalenessRunway): string {
  const when = r.firstWithholdDate ?? "unknown";
  const lines = [
    r.minDaysToWithhold !== null && r.minDaysToWithhold <= 0
      ? `${r.alreadyWithheld} AMIPS page(s) are past the staleness bound and returning 404 now.`
      : `${r.within30 || r.servablePages} AMIPS page(s) stop serving in ${r.minDaysToWithhold} day(s), on ${when}.`,
    r.isSingleDayCliff
      ? `All ${r.servablePages} servable pages share this date — the corpus goes dark in one day, not gradually.`
      : `Withholding is staggered: ${r.within30} within 30d, ${r.within60} within 60d, ${r.within90} within 90d.`,
    "",
    "Remedy (manual — there is no scheduled refresh):",
    "  - run lib/amips/seed/vehicle-intelligence.seed.ts against production, or",
    "  - POST /api/admin/amips/sync-market-intelligence (admin)",
    "Regenerating pages will NOT clear this: the as-of dates come from the source rows.",
  ];
  return lines.join("\n");
}
