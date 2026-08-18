// lib/services/analytics/funnel-observability.service.ts
//
// S5 — derive-by-snapshot funnel observability + alerting.
//
// On the existing daily analytics-snapshot cadence (/api/cron/analytics-snapshot,
// 0 1 * * *), each buyer-funnel stage is COUNTed from its authoritative domain
// table (VehicleRequest lifecycle + Deal completion) and persisted to
// FunnelStageSnapshot as a named counter. This is a DERIVED snapshot — there is
// no event-incremented counter table and no parallel write path.
//
// Two failure modes are counted over a rolling window and alerted on
// INDEPENDENTLY (never unioned — they measure different failures at different
// funnel stages):
//   • requests_closed_no_match    — VehicleRequest → CLOSED_NO_MATCH
//   • auctions_closed_zero_offers — Auction → CLOSED/EXPIRED with 0 offers
//
// Drop-off between adjacent funnel stages is alerted when conversion falls below
// a floor at meaningful upstream volume. Alerts are persisted to PlatformAlert
// (the existing alert record) and routed through the observability seam
// (notifyOncall / pageOnCall). The split mirrors the rest of the codebase: a
// PURE evaluator (`evaluateFunnelAlerts`) decides what to raise; the impure
// orchestrator (`snapshotAndAlertFunnel`) persists + routes.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AuctionStatus, VehicleRequestStatus } from "@prisma/client";
import { createAlert } from "@/lib/services/monitoring/health-alert.service";
import { notifyOncall, pageOnCall } from "@/lib/observability/alert";

// Rolling window for the two windowed failure counters.
export const FUNNEL_WINDOW_HOURS = 24;

// ---------------------------------------------------------------------------
// Thresholds — env-overridable. Defaults are conservative PLACEHOLDERS that MUST
// be tuned against real baseline volumes before the alerts are trusted (NOT
// VERIFIED — see the Phase 2 staging checklist).
// ---------------------------------------------------------------------------
export interface FunnelAlertThresholds {
  /** Alert when this many requests reach CLOSED_NO_MATCH within the window. */
  requestsClosedNoMatchPer24h: number;
  /** Alert when this many auctions close/expire with zero offers within the window. */
  auctionsClosedZeroOffersPer24h: number;
  /** Minimum acceptable adjacent stage-to-stage conversion (0..1). */
  dropoffFloorPct: number;
  /** Ignore drop-off when the upstream stage volume is below this (noise floor). */
  dropoffMinUpstream: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const DEFAULT_FUNNEL_ALERT_THRESHOLDS: FunnelAlertThresholds = {
  requestsClosedNoMatchPer24h: envInt("FUNNEL_ALERT_CLOSED_NO_MATCH_PER_24H", 5),
  auctionsClosedZeroOffersPer24h: envInt("FUNNEL_ALERT_ZERO_OFFERS_PER_24H", 3),
  dropoffFloorPct: envFloat("FUNNEL_ALERT_DROPOFF_FLOOR_PCT", 0.1),
  dropoffMinUpstream: envInt("FUNNEL_ALERT_DROPOFF_MIN_UPSTREAM", 10),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface FunnelStageCount {
  metric: string;
  count: number;
  /**
   * false → the adjacent drop-off pair ENDING at this stage is excluded from
   * drop-off evaluation. Used for a cross-table stage whose ratio is not a
   * comparable same-basis conversion — e.g. `deals_completed` (a terminal Deal
   * state) over `requests_deal_created` (a VehicleRequest state that persists
   * while the deal is still in flight), which would otherwise read as ~0%
   * conversion and false-page a perfectly healthy pipeline. Defaults to true;
   * the stage is still counted + persisted, just not drop-off-alerted.
   */
  dropoffEligible?: boolean;
}

export interface FunnelSnapshotCounts {
  /** Cumulative funnel stages, ordered top → bottom (each downstream ⊆ upstream). */
  stages: FunnelStageCount[];
  /** Windowed failure counters (evaluated + reported independently). */
  requestsClosedNoMatch: number;
  auctionsClosedZeroOffers: number;
}

export interface FunnelAlert {
  level: "P1" | "P2";
  metric: string;
  title: string;
  body: string;
  /** true → page on-call (severe); false → notify only. */
  severe: boolean;
}

// ---------------------------------------------------------------------------
// PURE evaluator — no DB, no network. Deterministic given (counts, thresholds).
// ---------------------------------------------------------------------------
export function evaluateFunnelAlerts(
  counts: FunnelSnapshotCounts,
  thresholds: FunnelAlertThresholds,
): FunnelAlert[] {
  const alerts: FunnelAlert[] = [];

  // Failure counter 1 — buyer requests closing with no match (independent).
  if (counts.requestsClosedNoMatch >= thresholds.requestsClosedNoMatchPer24h) {
    const severe = counts.requestsClosedNoMatch >= thresholds.requestsClosedNoMatchPer24h * 3;
    alerts.push({
      level: severe ? "P1" : "P2",
      metric: "requests_closed_no_match",
      title: "Funnel: buyer requests closing with no match",
      body:
        `${counts.requestsClosedNoMatch} vehicle request(s) reached CLOSED_NO_MATCH in the ` +
        `last ${FUNNEL_WINDOW_HOURS}h (threshold ${thresholds.requestsClosedNoMatchPer24h}).`,
      severe,
    });
  }

  // Failure counter 2 — auctions closing with zero offers (independent).
  if (counts.auctionsClosedZeroOffers >= thresholds.auctionsClosedZeroOffersPer24h) {
    const severe =
      counts.auctionsClosedZeroOffers >= thresholds.auctionsClosedZeroOffersPer24h * 3;
    alerts.push({
      level: severe ? "P1" : "P2",
      metric: "auctions_closed_zero_offers",
      title: "Funnel: auctions closing with zero offers",
      body:
        `${counts.auctionsClosedZeroOffers} auction(s) closed/expired with zero offers in the ` +
        `last ${FUNNEL_WINDOW_HOURS}h (threshold ${thresholds.auctionsClosedZeroOffersPer24h}).`,
      severe,
    });
  }

  // Drop-off — per adjacent funnel stage. A stage whose conversion falls below
  // the floor at meaningful upstream volume is where the funnel is leaking.
  for (let i = 0; i < counts.stages.length - 1; i++) {
    const up = counts.stages[i]!;
    const down = counts.stages[i + 1]!;
    // Skip pairs that aren't a comparable same-basis conversion (e.g. the
    // VehicleRequest→Deal boundary — see FunnelStageCount.dropoffEligible).
    if (up.dropoffEligible === false || down.dropoffEligible === false) continue;
    if (up.count < thresholds.dropoffMinUpstream) continue; // below noise floor
    const conversion = up.count > 0 ? down.count / up.count : 0;
    if (conversion < thresholds.dropoffFloorPct) {
      const severe = down.count === 0; // total collapse at a high-volume stage
      alerts.push({
        level: severe ? "P1" : "P2",
        metric: `dropoff:${up.metric}->${down.metric}`,
        title: `Funnel drop-off: ${up.metric} → ${down.metric}`,
        body:
          `Only ${down.count}/${up.count} (${(conversion * 100).toFixed(1)}%) progressed from ` +
          `${up.metric} to ${down.metric}; floor is ${(thresholds.dropoffFloorPct * 100).toFixed(0)}%.`,
        severe,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Derive the funnel snapshot by COUNTing authoritative domain tables.
//
// The buyer funnel is request-centric: a single authoritative table
// (VehicleRequest.status) plus Deal completion. Each "…_or_beyond" set is a
// strict SUBSET of the one above it, so the VehicleRequest stages are
// monotonically non-increasing and their adjacent conversions stay ≤ 100% —
// drop-off is meaningful ACROSS THOSE STAGES. The final stage, deals_completed,
// crosses VehicleRequest→Deal (a request lingers at DEAL_CREATED while its deal
// completes over days) so that last pair is NOT a comparable conversion; it is
// persisted for the snapshot/dashboard but excluded from drop-off alerting via
// dropoffEligible:false.
//
// These are CURRENT-STATE counts, not cumulative "furthest-ever-reached": a
// request that advanced then landed in a branch/terminal state (OFFER_DECLINED,
// CANCELLED, EXPIRED) counts only in `requests_submitted`, so it reads as
// drop-off at the first step. That is the intended point-in-time state
// distribution; CLOSED_NO_MATCH additionally has its own dedicated windowed
// counter below. (Thresholds are NOT VERIFIED against real baseline volumes —
// see the Phase 2 staging checklist.)
// ---------------------------------------------------------------------------
type CountingClient = Pick<typeof prisma, "vehicleRequest" | "deal" | "auction">;

const SOURCING_OR_BEYOND: VehicleRequestStatus[] = [
  VehicleRequestStatus.ACTIVE_SOURCING,
  VehicleRequestStatus.OFFER_READY,
  VehicleRequestStatus.OFFER_SENT,
  VehicleRequestStatus.OFFER_ACCEPTED,
  VehicleRequestStatus.DEAL_CREATED,
];
const OFFER_READY_OR_BEYOND: VehicleRequestStatus[] = [
  VehicleRequestStatus.OFFER_READY,
  VehicleRequestStatus.OFFER_SENT,
  VehicleRequestStatus.OFFER_ACCEPTED,
  VehicleRequestStatus.DEAL_CREATED,
];
const OFFER_ACCEPTED_OR_BEYOND: VehicleRequestStatus[] = [
  VehicleRequestStatus.OFFER_ACCEPTED,
  VehicleRequestStatus.DEAL_CREATED,
];

export async function computeFunnelSnapshot(
  client: CountingClient = prisma,
  windowHours: number = FUNNEL_WINDOW_HOURS,
): Promise<FunnelSnapshotCounts> {
  const windowStart = new Date(Date.now() - windowHours * 3_600_000);

  const [
    requestsSubmitted,
    requestsActiveSourcing,
    requestsOfferReady,
    requestsOfferAccepted,
    requestsDealCreated,
    dealsCompleted,
    requestsClosedNoMatch,
    auctionsClosedZeroOffers,
  ] = await Promise.all([
    client.vehicleRequest.count(),
    client.vehicleRequest.count({ where: { status: { in: SOURCING_OR_BEYOND } } }),
    client.vehicleRequest.count({ where: { status: { in: OFFER_READY_OR_BEYOND } } }),
    client.vehicleRequest.count({ where: { status: { in: OFFER_ACCEPTED_OR_BEYOND } } }),
    client.vehicleRequest.count({ where: { status: VehicleRequestStatus.DEAL_CREATED } }),
    client.deal.count({ where: { status: "COMPLETED" } }),
    client.vehicleRequest.count({
      where: { status: VehicleRequestStatus.CLOSED_NO_MATCH, updatedAt: { gte: windowStart } },
    }),
    client.auction.count({
      where: {
        status: { in: [AuctionStatus.CLOSED, AuctionStatus.EXPIRED] },
        updatedAt: { gte: windowStart },
        offers: { none: {} },
      },
    }),
  ]);

  return {
    stages: [
      { metric: "requests_submitted", count: requestsSubmitted },
      { metric: "requests_active_sourcing", count: requestsActiveSourcing },
      { metric: "requests_offer_ready", count: requestsOfferReady },
      { metric: "requests_offer_accepted", count: requestsOfferAccepted },
      { metric: "requests_deal_created", count: requestsDealCreated },
      // deals_completed crosses VehicleRequest→Deal: a request stays at
      // DEAL_CREATED while its deal completes over days, so this ratio is not a
      // comparable conversion — persisted for the snapshot/dashboard, but
      // excluded from drop-off alerting (dropoffEligible:false).
      { metric: "deals_completed", count: dealsCompleted, dropoffEligible: false },
    ],
    requestsClosedNoMatch,
    auctionsClosedZeroOffers,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — derive → persist snapshot → evaluate → persist + route alerts.
// Invoked from the analytics-snapshot cron (no new cron; reuses the cadence).
// `compute` is injectable for testing the persist/alert wiring in isolation.
// ---------------------------------------------------------------------------
export async function snapshotAndAlertFunnel(opts: {
  thresholds?: FunnelAlertThresholds;
  compute?: () => Promise<FunnelSnapshotCounts>;
} = {}): Promise<{ snapshotted: number; alerts: number }> {
  const thresholds = opts.thresholds ?? DEFAULT_FUNNEL_ALERT_THRESHOLDS;
  const counts = await (opts.compute ?? (() => computeFunnelSnapshot()))();

  // Persist the derived snapshot: cumulative funnel stages (window_hours null)
  // plus the two windowed failure counters (window_hours = FUNNEL_WINDOW_HOURS).
  const rows = [
    ...counts.stages.map((s) => ({ metric: s.metric, count: s.count, windowHours: null as number | null })),
    { metric: "requests_closed_no_match", count: counts.requestsClosedNoMatch, windowHours: FUNNEL_WINDOW_HOURS },
    { metric: "auctions_closed_zero_offers", count: counts.auctionsClosedZeroOffers, windowHours: FUNNEL_WINDOW_HOURS },
  ];
  await prisma.funnelStageSnapshot.createMany({ data: rows });

  // Evaluate + raise. Each alert is persisted once (deduped against an already
  // open PlatformAlert of the same title AND level) so a persistent condition
  // does not pile up a new row and re-page every day, yet a SEVERITY ESCALATION
  // (P2 → P1) is NOT swallowed by the still-open P2 row — the higher-severity
  // level doesn't match, so it creates a new row and pages. A condition re-alerts
  // after an admin resolves it and it recurs.
  const alerts = evaluateFunnelAlerts(counts, thresholds);
  let raised = 0;
  for (const a of alerts) {
    try {
      const existing = await prisma.platformAlert.findFirst({
        where: { isResolved: false, title: a.title, source: "funnel-observability", level: a.level },
        select: { id: true },
      });
      if (existing) continue;
      await createAlert(a.level, a.title, a.body, "funnel-observability");
      if (a.severe) pageOnCall(a.body, { metric: a.metric });
      else notifyOncall(a.body, { metric: a.metric });
      raised++;
    } catch (err) {
      logger.error("[funnel-observability] alert dispatch failed", a.metric, err);
    }
  }

  return { snapshotted: rows.length, alerts: raised };
}
