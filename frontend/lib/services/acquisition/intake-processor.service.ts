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
import {
  runIntakePipeline,
  sanitizeIntakeMessage,
  REQUIRED_STAGES,
  type IntakePipelineResult,
} from "./intake-pipeline.service";
import {
  getSupabase,
  claimJob,
  updateIdempotencyState,
  releaseIdempotencyGuard,
} from "@/lib/jobs/idempotency";

// Bounded retry for a REQUIRED-stage execution failure. Matches the repo's
// existing retry conventions (the retired Inngest intake worker used retries:3;
// the DLQ auto-drainer uses maxAutoRetries:3). After this many REQUIRED-stage
// failures the intake is transitioned to a terminal state and is no longer
// re-driven by intake-reconcile.
export const MAX_INTAKE_ATTEMPTS = 3;

// A pipeline run can legitimately take minutes (per-prospect script drafting has a
// 12s spacer, dealer sends are rate-limited). The claim must outlive the longest
// possible live run — comfortably above the route's maxDuration (300s) — so an
// overlapping cron tick can NEVER steal a still-running claim. A run killed by the
// platform (maxDuration/redeploy/crash) leaves a stale claim that becomes
// reclaimable after this window, and the pipeline resumes idempotently.
export const INTAKE_STALE_CLAIM_MS = 10 * 60 * 1000; // 10 min

export type IntakeOutcomeStatus =
  | "SUCCESS" // completed; dealer discovery found dealers (or a prior pass had)
  | "ZERO_SUPPLY" // completed; discovery ran fine and found zero dealers (valid)
  | "DEFERRED" // transient throttle (rate limit) blocked outreach; retry later, NOT counted
  | "REQUIRED_FAILED" // a REQUIRED stage FAILED; not stamped, will retry (< N)
  | "DEAD_LETTERED" // REQUIRED failed N times → terminal; no longer re-driven
  | "ALREADY_PROCESSED"
  | "DUPLICATE_BLOCKED"
  | "NOT_FOUND"
  | "FAILED"; // unexpected throw (infra) outside the stage machinery

export type IntakeFailureCategory =
  | "NOT_FOUND"
  | "REQUIRED_STAGE_FAILED"
  | "PIPELINE_ERROR"
  | "UNKNOWN";

export interface IntakeOutcome {
  status: IntakeOutcomeStatus;
  opportunityId: string;
  dealersContacted?: number;
  category?: IntakeFailureCategory;
  /** Sanitized, bounded error string — safe for logs/cron result JSON. */
  error?: string;
  /** REQUIRED stage names that FAILED this run (for observability). */
  failedStages?: string[];
  /** REQUIRED-failure attempt count after this run (bounded-retry visibility). */
  attempts?: number;
}

// One sanitizer, shared with the pipeline (imported). Opportunity ids are cuids
// (not PII); downstream errors could embed an email/phone, so both are redacted.
const sanitizeError = sanitizeIntakeMessage;

function categorize(message: string): IntakeFailureCategory {
  if (/not found/i.test(message)) return "NOT_FOUND";
  return "PIPELINE_ERROR";
}

// The REQUIRED stages that FAILED in a pipeline result, as bare stage names.
function failedRequiredStages(result: IntakePipelineResult): string[] {
  return result.stages
    .filter((s) => REQUIRED_STAGES.has(s.stage) && s.status === "FAILED")
    .map((s) => s.stage);
}

function requiredFailureReason(result: IntakePipelineResult): string {
  const failed = result.stages.filter(
    (s) => REQUIRED_STAGES.has(s.stage) && s.status === "FAILED",
  );
  return sanitizeError(
    failed.map((s) => `${s.stage}: ${s.reason ?? "failed"}`).join("; ") ||
      "required stage failed",
  );
}

/**
 * Run buyer-intake orchestration for ONE BuyerOpportunity. Idempotent,
 * concurrency-safe, retry-safe, crash-recoverable. Never throws for a business
 * failure — returns a structured outcome the caller can tally and surface.
 */
export async function processBuyerOpportunityIntake(
  opportunityId: string,
): Promise<IntakeOutcome> {
  // 1. Durable pre-check — the authoritative "done" and "terminal" markers.
  const pre = await prisma.buyerOpportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, intakeProcessedAt: true, intakeFailedAt: true },
  });
  if (!pre) return { status: "NOT_FOUND", opportunityId, category: "NOT_FOUND" };
  if (pre.intakeProcessedAt) return { status: "ALREADY_PROCESSED", opportunityId };
  // Defense-in-depth: a terminal (dead-lettered) intake is never re-driven. The
  // cron eligibility query already excludes these, so this only guards a direct
  // caller passing a terminal id — no claim, no pipeline, no re-run.
  if (pre.intakeFailedAt)
    return { status: "DEAD_LETTERED", opportunityId, category: "REQUIRED_STAGE_FAILED" };

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

    // 5. COMPLETION POLICY.
    //    A REQUIRED sourcing-spine stage (dealer discovery / outreach) that FAILED
    //    (threw / all-sends-failed / DB error) is an EXECUTION failure — it must
    //    NOT masquerade as completion. Do not stamp; account a bounded retry and,
    //    at the cap, transition to a terminal state that intake-reconcile no longer
    //    selects. ZERO_RESULTS / SKIPPED are valid terminal states and DO complete.
    if (result.requiredFailed) {
      const reason = requiredFailureReason(result);
      const failedStages = failedRequiredStages(result);
      const rec = await recordRequiredFailure(supabase, opportunityId, key, reason);
      logger.error(
        `[intake-processor] REQUIRED stage(s) failed for ${opportunityId} (attempt ${rec?.attempts ?? "?"}): ${failedStages.join(", ")}`,
      );
      if (!rec) {
        return {
          status: "REQUIRED_FAILED",
          opportunityId,
          category: "REQUIRED_STAGE_FAILED",
          error: reason,
          failedStages,
        };
      }
      return {
        status: rec.terminal ? "DEAD_LETTERED" : "REQUIRED_FAILED",
        opportunityId,
        category: "REQUIRED_STAGE_FAILED",
        error: reason,
        failedStages,
        attempts: rec.attempts,
      };
    }

    // A REQUIRED stage was DEFERRED by a transient throttle (channel rate limit)
    // and none FAILED. Nobody was contacted, so do NOT complete — but this is
    // backpressure, not an execution failure, so do NOT count it toward the
    // terminal cap. Release the claim and let a later tick retry when the throttle
    // clears (the limit is self-imposed and self-clearing).
    if (result.deferred) {
      await releaseIdempotencyGuard(supabase, key).catch(() => {});
      return { status: "DEFERRED", opportunityId, dealersContacted: result.dealersContacted };
    }

    // No REQUIRED stage failed or deferred → a valid terminal intake. Mark complete.
    await prisma.buyerOpportunity.update({
      where: { id: opportunityId },
      data: { intakeProcessedAt: new Date() },
    });
    await updateIdempotencyState(supabase, key, "completed", {
      dealersContacted: result.dealersContacted,
      zeroSupply: result.zeroSupply,
    }).catch((e) => logger.warn("[intake-processor] guard-complete write failed:", e));

    return {
      status: result.zeroSupply ? "ZERO_SUPPLY" : "SUCCESS",
      opportunityId,
      dealersContacted: result.dealersContacted,
    };
  } catch (err) {
    // Unexpected throw OUTSIDE the stage machinery (e.g. the opportunity row
    // vanished, or a write failed). Account a bounded retry so a persistent
    // unexpected error can't re-drive forever, then free the claim.
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[intake-processor] intake failed for ${opportunityId}:`, err);
    const rec = await recordRequiredFailure(supabase, opportunityId, key, sanitizeError(message));
    return {
      status: rec?.terminal ? "DEAD_LETTERED" : "FAILED",
      opportunityId,
      category: categorize(message),
      error: sanitizeError(message),
      attempts: rec?.attempts,
    };
  }
}

/**
 * Record ONE REQUIRED-stage execution failure against the opportunity: increment
 * the durable attempt counter and, at MAX_INTAKE_ATTEMPTS, transition to a
 * terminal state (intakeFailedAt + sanitized reason) that the intake-reconcile
 * eligibility query excludes — stopping the re-drive. The claim is ALWAYS released
 * so the next tick can reclaim (before the cap) or so nothing lingers (at the cap).
 *
 * TERMINAL STATE IS INNGEST-FREE: it lives entirely on BuyerOpportunity. Nothing
 * is written to jobs_dead_letter, so the Inngest-based DLQ drainer
 * (OperationsService.autoDrainDeadLetterJobs → inngest.send) can NEVER pick up a
 * terminal intake and re-emit it through Inngest.
 *
 * Returns null when the counter could not be persisted (row gone / DB error), in
 * which case the caller degrades to a plain retryable failure.
 */
async function recordRequiredFailure(
  supabase: ReturnType<typeof getSupabase>,
  opportunityId: string,
  key: string,
  reason: string,
): Promise<{ attempts: number; terminal: boolean } | null> {
  try {
    const u = await prisma.buyerOpportunity.update({
      where: { id: opportunityId },
      data: { intakeAttempts: { increment: 1 } },
      select: { intakeAttempts: true },
    });
    const terminal = u.intakeAttempts >= MAX_INTAKE_ATTEMPTS;
    if (terminal) {
      await prisma.buyerOpportunity.update({
        where: { id: opportunityId },
        data: { intakeFailedAt: new Date(), intakeFailureReason: reason },
      });
      logger.error(
        `[intake-processor] intake DEAD-LETTERED (terminal) for ${opportunityId} after ${u.intakeAttempts} attempts: ${reason}`,
      );
    }
    await updateIdempotencyState(supabase, key, "failed", {
      attempts: u.intakeAttempts,
      terminal,
    }).catch(() => {});
    return { attempts: u.intakeAttempts, terminal };
  } catch (e) {
    logger.error("[intake-processor] could not record required-stage failure:", e);
    return null;
  } finally {
    // Free the claim so the next tick can re-drive (pre-cap) — the pipeline is
    // idempotent, so a partial run's completed side effects are not repeated.
    await releaseIdempotencyGuard(supabase, key).catch(() => {});
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
  /** Completed with dealers found (or a prior pass had found them). */
  succeeded: number;
  /** Completed, dealer discovery ran fine and found ZERO dealers — valid supply gap. */
  zeroSupply: number;
  /** Transient throttle (rate limit) blocked outreach; NOT completed, retry later, NOT counted to cap. */
  deferred: number;
  /** A REQUIRED stage FAILED this run; NOT completed, will retry (attempts < N). */
  requiredStageFailed: number;
  /** Reached the retry cap → terminal; intake-reconcile no longer selects it. */
  deadLettered: number;
  /** Unexpected infra throw outside the stage machinery. */
  failed: number;
  duplicateBlocked: number;
  alreadyProcessed: number;
  notFound: number;
  totalDealersContacted: number;
  /** Count of REQUIRED-stage failures by stage name, across the batch. */
  stageFailureCounts: Record<string, number>;
  /** Sanitized per-item failures for operator diagnosis. */
  failures: Array<{
    opportunityId: string;
    category: IntakeFailureCategory;
    error: string;
    terminal?: boolean;
    failedStages?: string[];
  }>;
  /**
   * True when NO opportunity was successfully sourced (0 SUCCESS) AND execution
   * failures occurred (requiredStageFailed + deadLettered + failed > 0) — a real
   * dead workload (e.g. a discovery or outreach provider outage). Deliberately
   * does NOT let a `zeroSupply` completion mask concurrent execution failures: a
   * lone "no dealers found" buyer must not turn a batch where everyone else's
   * outreach failed into a green run. A pure supply gap (only zeroSupply, no
   * failures) is NOT business-dead; a pure throttle (only deferred) is NOT
   * business-dead. The cron escalates to a FAILED run / HTTP 500 on this.
   */
  businessDead: boolean;
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
      // TERMINAL EXCLUSION — an intake that failed its REQUIRED stages
      // MAX_INTAKE_ATTEMPTS times is dead-lettered (intakeFailedAt set) and must
      // never be re-driven, so a provider outage cannot make the cron retry it
      // every 5 minutes forever.
      intakeFailedAt: null,
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
    zeroSupply: 0,
    deferred: 0,
    requiredStageFailed: 0,
    deadLettered: 0,
    failed: 0,
    duplicateBlocked: 0,
    alreadyProcessed: 0,
    notFound: 0,
    totalDealersContacted: 0,
    stageFailureCounts: {},
    failures: [],
    businessDead: false,
    windowHours,
    eligibilityFloor: floor.toISOString(),
    timestamp: now.toISOString(),
  };

  const recordFailure = (outcome: IntakeOutcome, terminal: boolean) => {
    summary.attempted += 1;
    for (const s of outcome.failedStages ?? []) {
      summary.stageFailureCounts[s] = (summary.stageFailureCounts[s] ?? 0) + 1;
    }
    summary.failures.push({
      opportunityId: outcome.opportunityId,
      category: outcome.category ?? "UNKNOWN",
      error: outcome.error ?? "unknown",
      terminal,
      failedStages: outcome.failedStages,
    });
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
      case "ZERO_SUPPLY":
        summary.attempted += 1;
        summary.zeroSupply += 1;
        break;
      case "DEFERRED":
        summary.attempted += 1;
        summary.deferred += 1;
        break;
      case "REQUIRED_FAILED":
        summary.requiredStageFailed += 1;
        recordFailure(outcome, false);
        break;
      case "DEAD_LETTERED":
        summary.deadLettered += 1;
        recordFailure(outcome, true);
        break;
      case "FAILED":
        summary.failed += 1;
        recordFailure(outcome, false);
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

  // Business-health signal (disambiguated — the whole point of Batch 2):
  //   blocked = requiredStageFailed + deadLettered + failed (execution failures)
  // Dead ONLY when NO opportunity was successfully sourced AND execution failures
  // occurred. `zeroSupply` is intentionally EXCLUDED from the suppressor: a lone
  // "no dealers found" completion must not mask a batch in which everyone else's
  // outreach failed (an outreach-provider outage). `deferred` (throttle) is neither
  // a completion nor a failure, so it never triggers or suppresses the alarm.
  const blocked = summary.requiredStageFailed + summary.deadLettered + summary.failed;
  summary.businessDead = summary.succeeded === 0 && blocked > 0;

  return summary;
}
