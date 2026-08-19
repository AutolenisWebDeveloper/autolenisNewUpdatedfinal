// Y2 — request-time coverage gate (soft-hold + recruit).
//
// After a VehicleRequest's intake pipeline has discovered + email-enriched
// prospects, assess how many DISTINCT CONTACTABLE dealerships sit around the
// buyer using the ONE shared coverage primitive (assessCoverageForZip, via the
// ZIP radius ladder selectCoverageRadiusForZip). If coverage is thin
// (< MIN_COVERAGE_DEALERS at the widest tier), SOFT-HOLD the request — a flag
// pair on VehicleRequest, never a new status, never a block on the buyer — so
// downstream (the deposit-activation radius ladder / ops) can see thin coverage
// and a reconciler keeps recruiting until it recovers. When coverage is (or
// becomes) adequate, the hold is cleared.
//
// The gate does exactly ONE coverage assessment per call and sets-or-clears the
// flag from it. Release is emergent: the reconciler re-runs the gate over held
// requests, each run recruiting the next bounded batch, until an assessment
// finally reads ≥ MIN and clears the hold. No inline re-assessment, no recursion,
// bounded cost per call.
//
// This introduces NO second coverage assessor and NO second recruitment system:
// coverage counting is the shared auction primitive, and recruitment is the
// existing opportunity-keyed enrichProspectEmailsForOpportunity. The gate only
// decides + records the hold and (off the pipeline) nudges the existing recruiter.
//
// All effects are injectable for offline tests.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  selectCoverageRadiusForZip,
  MIN_COVERAGE_DEALERS,
  type CoverageResult,
} from "@/lib/services/auction/coverage.service";
import { enrichProspectEmailsForOpportunity } from "@/lib/services/dealer-recruitment/prospect-email-enrichment.service";

// Active sourcing statuses a coverage hold is meaningful for. Past OFFER_READY the
// auction/offer already formed, so recruitment can't change the outcome; cancelled/
// closed/expired requests are terminal. The reconciler only re-checks these.
const HELD_RECONCILE_STATUSES = ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"] as const;

export interface CoverageGateDeps {
  prisma: PrismaClient;
  now: Date;
  // Assess coverage for a buyer ZIP across the radius ladder. Defaults to the
  // shared ZIP ladder (selectCoverageRadiusForZip). `label` is for logging only.
  assessCoverage: (buyerZip: string | null, label: string) => Promise<CoverageResult>;
  // Kick recruitment for the opportunity. Defaults to the existing
  // enrichProspectEmailsForOpportunity (bounded, idempotent, per-prospect
  // isolated). Fired only on thin coverage, only when an opportunity is linked,
  // and only when recruitOnThin is true.
  recruit: (buyerOpportunityId: string) => Promise<unknown>;
  // Whether to recruit when coverage is thin. The intake pipeline sets this false
  // (it already ran enrichment unconditionally this pass, so the gate is
  // record-only there); the reconciler leaves it true to drive the next batch.
  recruitOnThin: boolean;
}

export interface CoverageGateResult {
  vehicleRequestId: string;
  found: boolean;
  coverage: number;
  radiusMiles: number;
  buyerGeocoded: boolean;
  held: boolean;
  recruitmentFired: boolean;
  released: boolean;
}

function resolveDeps(deps?: Partial<CoverageGateDeps>): CoverageGateDeps {
  const prisma = deps?.prisma ?? defaultPrisma;
  return {
    prisma,
    now: deps?.now ?? new Date(),
    assessCoverage:
      deps?.assessCoverage ??
      ((buyerZip, label) => selectCoverageRadiusForZip(buyerZip, { prisma, label })),
    recruit: deps?.recruit ?? ((oppId) => enrichProspectEmailsForOpportunity(oppId)),
    recruitOnThin: deps?.recruitOnThin ?? true,
  };
}

interface RequestRow {
  id: string;
  buyerOpportunityId: string | null;
  coverageHoldAt: Date | null;
  buyer: { zip: string | null } | null;
}

async function loadRequest(prisma: PrismaClient, vehicleRequestId: string): Promise<RequestRow | null> {
  return (await prisma.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: {
      id: true,
      buyerOpportunityId: true,
      coverageHoldAt: true,
      buyer: { select: { zip: true } },
    },
  })) as RequestRow | null;
}

function holdReason(cov: CoverageResult): string {
  const tag = `thin_coverage:${cov.coverage}@${cov.radiusMiles}mi`;
  return cov.buyerGeocoded ? tag : `${tag}:ungeocoded`;
}

/**
 * Request-time coverage gate. Assesses coverage ONCE for the request's buyer ZIP
 * and either SOFT-HOLDS (thin — recruiting the next batch when recruitOnThin) or
 * CLEARS the hold (adequate). Idempotent and safe to run repeatedly; re-running
 * over successive reconciler ticks is the release path. Fully awaited — the
 * non-blocking guarantee comes from the caller running it in the durable worker /
 * after().
 */
export async function applyRequestCoverageGate(
  vehicleRequestId: string,
  deps?: Partial<CoverageGateDeps>,
): Promise<CoverageGateResult> {
  const { prisma, now, assessCoverage, recruit, recruitOnThin } = resolveDeps(deps);

  const vr = await loadRequest(prisma, vehicleRequestId);
  if (!vr) {
    logger.warn(`[coverage-gate] request ${vehicleRequestId} not found — skipping`);
    return {
      vehicleRequestId,
      found: false,
      coverage: 0,
      radiusMiles: 0,
      buyerGeocoded: false,
      held: false,
      recruitmentFired: false,
      released: false,
    };
  }

  const cov = await assessCoverage(vr.buyer?.zip ?? null, `request ${vehicleRequestId}`);
  const thin = cov.coverage < MIN_COVERAGE_DEALERS;
  const wasHeld = vr.coverageHoldAt != null;

  // Adequate coverage — clear any existing hold (only writes when currently held).
  if (!thin) {
    if (wasHeld) {
      await prisma.vehicleRequest.update({
        where: { id: vr.id },
        data: { coverageHoldAt: null, coverageHoldReason: null },
      });
      logger.info(
        `[coverage-gate] request ${vehicleRequestId} coverage=${cov.coverage}@${cov.radiusMiles}mi — hold cleared`,
      );
    }
    return {
      vehicleRequestId,
      found: true,
      coverage: cov.coverage,
      radiusMiles: cov.radiusMiles,
      buyerGeocoded: cov.buyerGeocoded,
      held: false,
      recruitmentFired: false,
      released: wasHeld,
    };
  }

  // Thin coverage — record the soft-hold (preserve the original hold timestamp on
  // re-runs; always refresh the reason so ops sees the latest count/radius).
  await prisma.vehicleRequest.update({
    where: { id: vr.id },
    data: { coverageHoldAt: vr.coverageHoldAt ?? now, coverageHoldReason: holdReason(cov) },
  });
  logger.info(
    `[coverage-gate] request ${vehicleRequestId} thin coverage=${cov.coverage}@${cov.radiusMiles}mi ` +
      `(geocoded=${cov.buyerGeocoded}) — soft-held`,
  );

  // Kick recruitment for the next batch (off the pipeline path). Best-effort:
  // recruitment failure never changes the hold decision.
  let recruitmentFired = false;
  if (recruitOnThin && vr.buyerOpportunityId) {
    try {
      await recruit(vr.buyerOpportunityId);
      recruitmentFired = true;
    } catch (err) {
      logger.error(`[coverage-gate] recruitment failed for opportunity ${vr.buyerOpportunityId}:`, err);
    }
  }

  return {
    vehicleRequestId,
    found: true,
    coverage: cov.coverage,
    radiusMiles: cov.radiusMiles,
    buyerGeocoded: cov.buyerGeocoded,
    held: true,
    recruitmentFired,
    released: false,
  };
}

export interface CoverageReconcileResult {
  found: number;
  cleared: number;
  stillHeld: number;
  recruited: number;
}

/**
 * Release path — re-run the gate over currently soft-held, still-sourcing
 * requests. Each tick recruits the next bounded batch (recruitOnThin) and clears
 * any request whose coverage has recovered to ≥ MIN. Bounded per run (oldest
 * hold first); the remainder is picked up next tick. Per-request isolated so one
 * failure never aborts the batch.
 */
export async function reconcileCoverageHolds(
  deps?: Partial<CoverageGateDeps> & { limit?: number },
): Promise<CoverageReconcileResult> {
  const resolved = resolveDeps(deps);
  const prisma = resolved.prisma;
  const limit = Math.min(Math.max(deps?.limit ?? 50, 1), 200);

  const held = await prisma.vehicleRequest.findMany({
    where: {
      coverageHoldAt: { not: null },
      status: { in: [...HELD_RECONCILE_STATUSES] },
    },
    select: { id: true },
    orderBy: { coverageHoldAt: "asc" },
    take: limit,
  });

  const result: CoverageReconcileResult = {
    found: held.length,
    cleared: 0,
    stillHeld: 0,
    recruited: 0,
  };

  for (const row of held) {
    try {
      const gate = await applyRequestCoverageGate(row.id, { ...deps, recruitOnThin: true });
      if (gate.released) result.cleared += 1;
      else if (gate.held) result.stillHeld += 1;
      if (gate.recruitmentFired) result.recruited += 1;
    } catch (err) {
      logger.error(`[coverage-gate] reconcile failed for request ${row.id}:`, err);
      result.stillHeld += 1;
    }
  }

  if (result.found > 0) {
    logger.info(
      `[coverage-gate] reconcile: found=${result.found} cleared=${result.cleared} ` +
        `stillHeld=${result.stillHeld} recruited=${result.recruited}`,
    );
  }
  return result;
}
