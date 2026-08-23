// Buyer-intake processor + reconciler — the ONE authoritative execution path for
// buyer-intake orchestration. Runs on the internal Vercel-Cron / application /
// Postgres substrate; it requires NO Inngest.
//
// Every few minutes it selects recent, eligible, unprocessed BuyerOpportunity rows
// (intakeProcessedAt IS NULL, completed, within the eligibility window, whose
// linked VehicleRequest is still sourcing OR which have none) and runs each through
// the shared `processBuyerOpportunityIntake` service. This is BOTH the normal
// execution of freshly-created intakes AND the recovery of any that did not
// complete — one idempotent, concurrency-safe, crash-recoverable path.
//
// HISTORICAL SAFETY: the eligibility window (default 48h, env-tunable) excludes
// long-dormant historical opportunities, so this cron can NEVER auto-process the
// pre-existing backlog. Historical backfill is a separate, owner-authorized
// process — not this route.
//
// OBSERVABILITY: the per-run structured result records eligible / attempted /
// succeeded / failed / skipped counts, failed ids + sanitized reasons, and the
// eligibility floor. A run that attempted work but had ZERO successes is escalated
// to a FAILED cron (HTTP 500) so a green invocation can never conceal a dead
// workload.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { processEligibleBuyerIntakes } from "@/lib/services/acquisition/intake-processor.service";

// Buyer-intake orchestration can legitimately take minutes (per-prospect script
// drafting is spaced 12s, dealer sends are rate-limited). Give each batch the
// full window; the pipeline is resumable, so anything not finished this tick
// continues on the next.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Shared cron authorizer (Phase 4): requires `Bearer <CRON_SECRET>`; 401 on a
  // bad/absent token, 500 (fail-closed) when CRON_SECRET is unconfigured — all
  // BEFORE any DB access or work.
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("intake-reconcile", async () => {
    const summary = await processEligibleBuyerIntakes();

    // Truthful, disambiguated log line: completions vs zero-supply vs
    // required-stage failures vs terminal dead-letters.
    if (summary.attempted > 0 || summary.deadLettered > 0) {
      logger.info(
        `[intake-reconcile] succeeded=${summary.succeeded} zeroSupply=${summary.zeroSupply} ` +
          `deferred=${summary.deferred} requiredStageFailed=${summary.requiredStageFailed} ` +
          `deadLettered=${summary.deadLettered} failed=${summary.failed} ` +
          `dealersContacted=${summary.totalDealersContacted}`,
        { stageFailureCounts: summary.stageFailureCounts },
      );
    }
    if (summary.failures.length > 0) {
      logger.error(`[intake-reconcile] ${summary.failures.length} intake failure(s)`, {
        failures: summary.failures,
      });
    }

    // Business-dead guard: zero valid completions AND execution failures present
    // (e.g. a provider outage failing the REQUIRED sourcing spine). Throw so the
    // cron is recorded FAILED (HTTP 500) instead of a misleading green. A
    // legitimate all-ZERO_SUPPLY batch (dealers ran, none found) is NOT dead and
    // stays green.
    if (summary.businessDead) {
      throw new Error(
        `intake business failure: 0 completed, ` +
          `requiredStageFailed=${summary.requiredStageFailed} deadLettered=${summary.deadLettered} ` +
          `failed=${summary.failed} (first: ${summary.failures[0]?.category} — ${summary.failures[0]?.error})`,
      );
    }

    return summary;
  });

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "reconcile_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
