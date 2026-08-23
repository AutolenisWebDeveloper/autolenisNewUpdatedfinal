// lib/services/acquisition/intake-processor.service.ts
//
// THE single, transport-agnostic authority for running buyer-intake orchestration.
//
// It wraps the (already Inngest-free) `runIntakePipeline` with the three concerns
// that used to live inside the Inngest worker `intakeProcessFn`:
//   1. a crash-safe concurrency claim (so duplicate/concurrent/retried invocations
//      never double-run, yet a run killed mid-flight can be re-driven);
//   2. the durable completion marker (`BuyerOpportunity.intakeProcessedAt`), set
//      ONLY after the pipeline reaches completion;
//   3. a structured outcome (never throws for business failures) so a cron can
//      isolate per-item failures AND report real business progress.
//
// Buyer intake now runs on the internal Vercel-Cron / application / Postgres
// substrate — it requires NO Inngest. The retained Inngest worker delegates to
// THIS service, so there is exactly one implementation of the orchestration.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { runIntakePipeline } from "./intake-pipeline.service";
import {
  getSupabase,
  claimJob,
  updateIdempotencyState,
  releaseIdempotencyGuard,
} from "@/lib/jobs/idempotency";

// A pipeline run can legitimately take minutes (per-prospect script drafting has a
// 12s spacer, dealer sends are rate-limited). The claim must outlive the longest
// possible live run — comfortably above the route's maxDuration (300s) — so an
// overlapping cron tick can NEVER steal a still-running claim. A run killed by the
// platform (maxDuration/redeploy/crash) leaves a stale claim that becomes
// reclaimable after this window, and the pipeline resumes idempotently.
export const INTAKE_STALE_CLAIM_MS = 10 * 60 * 1000; // 10 min

export type IntakeOutcomeStatus =
  | "SUCCESS"
  | "ALREADY_PROCESSED"
  | "DUPLICATE_BLOCKED"
  | "NOT_FOUND"
  | "FAILED";

export type IntakeFailureCategory = "NOT_FOUND" | "PIPELINE_ERROR" | "UNKNOWN";

export interface IntakeOutcome {
  status: IntakeOutcomeStatus;
  opportunityId: string;
  dealersContacted?: number;
  category?: IntakeFailureCategory;
  /** Sanitized, bounded error string — safe for logs/cron result JSON. */
  error?: string;
}

// Keep only a bounded, single-line, non-sensitive message. Opportunity ids are
// cuids (not PII). The pipeline already swallows every PII-bearing downstream
// error, so only infrastructure-shaped messages reach here — but as
// defense-in-depth we also redact anything that looks like an email or phone
// before it can land in cron_job_logs / logs, cap length, and strip newlines.
function sanitizeError(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted-phone]")
    .trim()
    .slice(0, 300);
}

function categorize(message: string): IntakeFailureCategory {
  if (/not found/i.test(message)) return "NOT_FOUND";
  return "PIPELINE_ERROR";
}

/**
 * Run buyer-intake orchestration for ONE BuyerOpportunity. Idempotent,
 * concurrency-safe, retry-safe, crash-recoverable. Never throws for a business
 * failure — returns a structured outcome the caller can tally and surface.
 */
export async function processBuyerOpportunityIntake(
  opportunityId: string,
): Promise<IntakeOutcome> {
  // 1. Durable completion pre-check — the authoritative "done" marker.
  const pre = await prisma.buyerOpportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, intakeProcessedAt: true },
  });
  if (!pre) return { status: "NOT_FOUND", opportunityId, category: "NOT_FOUND" };
  if (pre.intakeProcessedAt) return { status: "ALREADY_PROCESSED", opportunityId };

  // 2. Concurrency claim (crash-safe). Only one executor runs an opportunity at a
  //    time; a stranded claim from a killed run is reclaimable after the stale
  //    window.
  const supabase = getSupabase();
  const key = `intake:process:${opportunityId}`;
  const claimed = await claimJob(supabase, key, { staleMs: INTAKE_STALE_CLAIM_MS });
  if (!claimed) return { status: "DUPLICATE_BLOCKED", opportunityId };

  try {
    // 3. Close the check-then-claim race: a concurrent run may have completed
    //    between our pre-check and our claim.
    const recheck = await prisma.buyerOpportunity.findUnique({
      where: { id: opportunityId },
      select: { intakeProcessedAt: true },
    });
    if (recheck?.intakeProcessedAt) {
      await releaseIdempotencyGuard(supabase, key).catch(() => {});
      return { status: "ALREADY_PROCESSED", opportunityId };
    }

    // 4. Run the (idempotent, resumable) pipeline.
    const result = await runIntakePipeline(opportunityId);

    // 5. Mark complete ONLY after the pipeline reached completion.
    await prisma.buyerOpportunity.update({
      where: { id: opportunityId },
      data: { intakeProcessedAt: new Date() },
    });
    await updateIdempotencyState(supabase, key, "completed", {
      dealersContacted: result.dealersContacted,
    }).catch((e) => logger.warn("[intake-processor] guard-complete write failed:", e));

    return { status: "SUCCESS", opportunityId, dealersContacted: result.dealersContacted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Free the claim so the NEXT tick can re-drive immediately (the pipeline is
    // idempotent, so a partial run's completed side effects are not repeated).
    await updateIdempotencyState(supabase, key, "failed", {
      error: sanitizeError(message),
    }).catch(() => {});
    await releaseIdempotencyGuard(supabase, key).catch(() => {});
    logger.error(`[intake-processor] intake failed for ${opportunityId}:`, err);
    return {
      status: "FAILED",
      opportunityId,
      category: categorize(message),
      error: sanitizeError(message),
    };
  }
}

// ── Batch execution over eligible, recent, unprocessed opportunities ──────────

const DEFAULT_ELIGIBILITY_WINDOW_HOURS = 48;
const DEFAULT_BATCH_SIZE = 10;

// Active linked-request statuses (or no linked request) — an opportunity whose
// VehicleRequest has advanced PAST sourcing is intentionally excluded (its
// sourcing already happened; fresh outreach would be wrong).
const ACTIVE_VR_STATUSES = ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"] as const;

export interface IntakeBatchOptions {
  /** Trailing recency window; older opportunities are excluded (historical gate). */
  windowHours?: number;
  /** Max opportunities to ATTEMPT per invocation. */
  batchSize?: number;
  /** Test seam: current time. */
  now?: Date;
}

export interface IntakeBatchSummary {
  eligible: number;
  attempted: number;
  succeeded: number;
  failed: number;
  duplicateBlocked: number;
  alreadyProcessed: number;
  notFound: number;
  totalDealersContacted: number;
  /** Sanitized per-item failures for operator diagnosis. */
  failures: Array<{ opportunityId: string; category: IntakeFailureCategory; error: string }>;
  /** True when work was attempted but NONE succeeded — business dead. */
  allAttemptedFailed: boolean;
  windowHours: number;
  eligibilityFloor: string;
  timestamp: string;
}

function eligibilityWindowHours(override?: number): number {
  if (typeof override === "number" && override > 0) return override;
  const env = Number(process.env.INTAKE_ELIGIBILITY_WINDOW_HOURS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_ELIGIBILITY_WINDOW_HOURS;
}

function batchSize(override?: number): number {
  if (typeof override === "number" && override > 0) return override;
  const env = Number(process.env.INTAKE_BATCH_SIZE);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_BATCH_SIZE;
}

// Optional hard floor set by the owner at cutover. When set, no opportunity
// created before it is EVER eligible, regardless of the trailing window. Invalid
// values are ignored (fail safe to the window).
function historicalCutoff(): Date | null {
  const raw = process.env.INTAKE_ELIGIBILITY_START_AT;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Select recent, eligible, unprocessed opportunities and run each through
 * `processBuyerOpportunityIntake`. Oldest-first, bounded, per-item isolated.
 *
 * HISTORICAL SAFETY (default ON): only opportunities created within the trailing
 * eligibility window (and at/after an optional owner cutoff) are ever eligible, so
 * the deploy can NOT sweep long-dormant historical opportunities. Backfilling
 * historical records is a separate, owner-authorized process — never this path.
 */
export async function processEligibleBuyerIntakes(
  opts: IntakeBatchOptions = {},
): Promise<IntakeBatchSummary> {
  const now = opts.now ?? new Date();
  const windowHours = eligibilityWindowHours(opts.windowHours);
  const size = batchSize(opts.batchSize);
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const cutoff = historicalCutoff();
  const floor = cutoff && cutoff > windowStart ? cutoff : windowStart;

  const eligible = await prisma.buyerOpportunity.findMany({
    where: {
      intakeProcessedAt: null,
      // READINESS GATE — only process an opportunity once the buyer has FINISHED
      // providing their intake. `completed` is set exactly at completion (concierge
      // stage 3; every structured one-shot submission sets it true at creation).
      // Without this, a still-in-progress concierge chat — an empty BuyerOpportunity
      // created on the buyer's first message, with no VehicleRequest yet — would be
      // swept by the `none:{}` branch, run the pipeline on near-empty data, and get
      // stamped intakeProcessedAt, so the buyer's real discovery/outreach would
      // NEVER run once they finished. The completed gate is the fix.
      completed: true,
      createdAt: { gte: floor },
      OR: [
        // A completed promotion whose VehicleRequest is still sourcing.
        { vehicleRequests: { some: { status: { in: [...ACTIVE_VR_STATUSES] } } } },
        // A completed one-shot submission where no buyer resolved (no VR) — lead
        // enrichment/scoring still runs for it.
        { vehicleRequests: { none: {} } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: size,
  });

  const summary: IntakeBatchSummary = {
    eligible: eligible.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    duplicateBlocked: 0,
    alreadyProcessed: 0,
    notFound: 0,
    totalDealersContacted: 0,
    failures: [],
    allAttemptedFailed: false,
    windowHours,
    eligibilityFloor: floor.toISOString(),
    timestamp: now.toISOString(),
  };

  // Sequential: the pipeline itself is rate-limited (12s per script draft, spaced
  // dealer sends). Running items in parallel would multiply external load and blow
  // the route's time budget. A platform kill mid-batch is safe — unclaimed items
  // are simply re-queried next tick, and the killed item's claim reclaims.
  for (const opp of eligible) {
    // TRUE per-item isolation: processBuyerOpportunityIntake does its pre-check +
    // claim OUTSIDE its own try/catch, so an infra error (DB blip, claim insert
    // failure) there would otherwise abort the whole batch. Catch it here, record
    // it as a failure, and continue with the remaining items.
    let outcome: IntakeOutcome;
    try {
      outcome = await processBuyerOpportunityIntake(opp.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = {
        status: "FAILED",
        opportunityId: opp.id,
        category: "UNKNOWN",
        error: sanitizeError(message),
      };
      logger.error(`[intake-processor] claim/pre-check threw for ${opp.id}:`, err);
    }
    switch (outcome.status) {
      case "SUCCESS":
        summary.attempted += 1;
        summary.succeeded += 1;
        summary.totalDealersContacted += outcome.dealersContacted ?? 0;
        break;
      case "FAILED":
        summary.attempted += 1;
        summary.failed += 1;
        summary.failures.push({
          opportunityId: outcome.opportunityId,
          category: outcome.category ?? "UNKNOWN",
          error: outcome.error ?? "unknown",
        });
        break;
      case "DUPLICATE_BLOCKED":
        summary.duplicateBlocked += 1;
        break;
      case "ALREADY_PROCESSED":
        summary.alreadyProcessed += 1;
        break;
      case "NOT_FOUND":
        summary.notFound += 1;
        break;
    }
  }

  // Business-health signal: work was attempted but nothing succeeded. The caller
  // (cron) escalates this so a green invocation can NEVER hide a dead workload.
  summary.allAttemptedFailed = summary.attempted > 0 && summary.succeeded === 0;

  return summary;
}
