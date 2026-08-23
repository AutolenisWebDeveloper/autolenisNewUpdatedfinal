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

  // Surface a business failure to Inngest's retry policy. Every other outcome
  // (SUCCESS / ALREADY_PROCESSED / DUPLICATE_BLOCKED / NOT_FOUND) is terminal and
  // returned as-is.
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
