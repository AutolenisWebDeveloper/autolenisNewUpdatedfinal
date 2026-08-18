// S1 — durable buyer-intake orchestration as an Inngest function.
//
// The intake background pipeline (market enrichment → dealer discovery →
// phone-script drafting → lead scoring/alerts → dealer outreach) used to run in
// fire-and-forget `after()` blocks. It now runs here so it inherits Inngest's
// locking, retry/backoff, concurrency, and dead-letter — and so the S2
// intake-reconcile cron can re-drive a stranded request by re-emitting the same
// event. Idempotency is keyed on `buyerOpportunityId`:
//   • a completed run keeps its guard row → a duplicate delivery is blocked;
//   • the guard is HELD through in-run retries so a concurrent reconciler can't
//     double-run it;
//   • on the FINAL failed attempt it dead-letters AND releases the guard, so a
//     later reconciler pass can legitimately re-drive it.
// Completion is also marked on BuyerOpportunity.intakeProcessedAt, which is what
// the reconciler queries.
//
// New function; the existing messaging functions in functions.ts are untouched.
// Served alongside them from app/api/inngest/route.ts.

import { inngest } from "@/lib/inngest/client";
import {
  getSupabase,
  acquireIdempotencyGuard,
  updateIdempotencyState,
  releaseIdempotencyGuard,
  moveJobToDeadLetter,
  isFinalAttempt,
} from "@/lib/inngest/idempotency";
import { prisma } from "@/lib/prisma";
import { runIntakePipeline } from "@/lib/services/acquisition/intake-pipeline.service";

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
  const { event, step } = ctx;
  const { buyerOpportunityId } = event.data;
  const supabase = getSupabase();
  const key = `intake:process:${buyerOpportunityId}`;

  const proceed = await step.run("evaluate-idempotency", async () =>
    acquireIdempotencyGuard(supabase, key),
  );
  if (!proceed) return { status: "DUPLICATE_BLOCKED", buyerOpportunityId };

  try {
    const result = await step.run("run-pipeline", async () =>
      runIntakePipeline(buyerOpportunityId),
    );

    // Mark intake complete — this is the reconciler's "done" signal.
    await step.run("mark-processed", async () =>
      prisma.buyerOpportunity.update({
        where: { id: buyerOpportunityId },
        data: { intakeProcessedAt: new Date() },
      }),
    );

    await updateIdempotencyState(supabase, key, "completed", {
      dealersContacted: result.dealersContacted,
    });
    return { status: "SUCCESS", buyerOpportunityId, dealersContacted: result.dealersContacted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateIdempotencyState(supabase, key, "failed", { error: message });

    if (isFinalAttempt(ctx as unknown as Record<string, unknown>)) {
      await moveJobToDeadLetter(
        supabase,
        ctx.runId ?? "unknown",
        "autolenis/intake.process",
        event.data,
        message,
      );
      // Only now — after Inngest has exhausted retries — release the guard so a
      // later reconciler pass can re-drive it. Releasing earlier would let a
      // concurrent reconciler run in parallel with an in-flight retry.
      await releaseIdempotencyGuard(supabase, key);
    }
    throw err; // re-throw so Inngest's retry policy applies
  }
}

export const intakeProcessFn = inngest.createFunction(
  { id: "intake-process-worker", name: "Buyer Intake Orchestration", retries: 3, concurrency: 5 },
  { event: "autolenis/intake.process" },
  async (ctx) => runIntakeProcess(ctx as never),
);

export const intakeFunctions = [intakeProcessFn];
