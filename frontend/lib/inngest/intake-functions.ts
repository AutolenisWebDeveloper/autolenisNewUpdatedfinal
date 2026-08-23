// Retained Inngest transport for buyer intake — a THIN delegator.
//
// Buyer intake no longer REQUIRES Inngest: the authoritative execution path is the
// internal Vercel-Cron / Postgres processor (app/api/cron/intake-reconcile →
// processEligibleBuyerIntakes). No repository code emits `autolenis/intake.process`
// anymore. This worker is kept (Inngest is not being removed in this batch) purely
// as a compatibility sink: if a legacy/in-flight event is ever delivered from the
// Inngest queue, it is handled by the SAME shared orchestration service, so there
// is exactly one implementation of intake business logic.
//
// The claim, completion marker, idempotency, and structured outcome all live in
// `processBuyerOpportunityIntake`. This wrapper only maps a business FAILURE onto a
// throw so Inngest's own retry policy still applies to a delivered event.

import { inngest } from "@/lib/inngest/client";
import { processBuyerOpportunityIntake } from "@/lib/services/acquisition/intake-processor.service";

interface IntakeProcessEvent {
  buyerOpportunityId: string;
}

interface StepTools {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export async function runIntakeProcess(ctx: {
  event: { data: IntakeProcessEvent };
  step: StepTools;
  runId?: string;
}) {
  const { buyerOpportunityId } = ctx.event.data;

  const outcome = await ctx.step.run("process-intake", async () =>
    processBuyerOpportunityIntake(buyerOpportunityId),
  );

  // This worker is a dormant compatibility sink (no repo code emits the event).
  // The internal intake-reconcile cron owns retries and the bounded-retry/terminal
  // machinery, so the Batch-2 statuses that mean "the internal path will handle it"
  // — REQUIRED_FAILED, DEAD_LETTERED, DEFERRED — plus the normal terminal ones
  // (SUCCESS / ZERO_SUPPLY / ALREADY_PROCESSED / DUPLICATE_BLOCKED / NOT_FOUND) are
  // returned as-is and never re-thrown. In particular DEAD_LETTERED must NOT throw,
  // so a terminal intake is never re-emitted or DLQ'd by Inngest. Only an
  // unexpected infra FAILED surfaces to Inngest's retry policy.
  if (outcome.status === "FAILED") {
    throw new Error(`intake failed for ${buyerOpportunityId}: ${outcome.error ?? "unknown"}`);
  }
  return outcome;
}

export const intakeProcessFn = inngest.createFunction(
  { id: "intake-process-worker", name: "Buyer Intake Orchestration", retries: 3, concurrency: 5 },
  { event: "autolenis/intake.process" },
  async (ctx) => runIntakeProcess(ctx as never),
);

export const intakeFunctions = [intakeProcessFn];
