// S3 — G1 dealer award/non-award dispatch as a durable Inngest function.
//
// Phase 1 fired emitDealerAwardOutcomes from select-offer's `after()` — which
// dies if the serverless instance is reclaimed before it finishes. It now runs
// in this worker (event autolenis/dealer.award), inheriting retry/backoff,
// concurrency, and dead-letter, and — with S3 — its award/non-award emails ride
// the autolenis/email.send spine (the sender wrappers now enqueue). The in-app
// Notification rows are still written by emitDealerAwardOutcomes (preserved).
//
// Idempotency keyed on dealId: a completed run keeps its guard so a duplicate
// dispatch is blocked. On failure the guard is held across Inngest's automatic
// retries and released + dead-lettered only once isFinalAttempt(ctx) is true, so
// the job stays re-drivable after a terminal failure. That final-attempt signal
// depends on Inngest surfacing attempt/maxAttempts on the function context
// (NOT YET VERIFIED against a live Inngest run — see the Phase 2 staging
// checklist); if it never reports true, the guard is simply held and a stuck
// dispatch is blocked rather than dead-lettered — safe, but needing manual
// re-drive. emitDealerAwardOutcomes is itself internally idempotent (per-email
// idempotencyKeys + in-app dedupe), so a re-run is always safe.

import { inngest } from "@/lib/inngest/client";
import {
  getSupabase,
  acquireIdempotencyGuard,
  updateIdempotencyState,
  releaseIdempotencyGuard,
  moveJobToDeadLetter,
  isFinalAttempt,
} from "@/lib/inngest/idempotency";
import { emitDealerAwardOutcomes } from "@/lib/services/notifications/dealer-award";

interface DealerAwardEvent {
  auctionId: string;
  winningOfferId: string;
  dealId: string;
}

interface StepTools {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export async function runDealerAward(ctx: {
  event: { data: DealerAwardEvent };
  step: StepTools;
  runId?: string;
}) {
  const { event, step } = ctx;
  const { auctionId, winningOfferId, dealId } = event.data;
  const supabase = getSupabase();
  const key = `dealer-award:${dealId}`;

  const proceed = await step.run("evaluate-idempotency", async () =>
    acquireIdempotencyGuard(supabase, key),
  );
  if (!proceed) return { status: "DUPLICATE_BLOCKED", dealId };

  try {
    await step.run("emit-outcomes", async () =>
      emitDealerAwardOutcomes({ auctionId, winningOfferId, dealId }),
    );
    await updateIdempotencyState(supabase, key, "completed", {});
    return { status: "SUCCESS", dealId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateIdempotencyState(supabase, key, "failed", { error: message });
    if (isFinalAttempt(ctx as unknown as Record<string, unknown>)) {
      await moveJobToDeadLetter(
        supabase,
        ctx.runId ?? "unknown",
        "autolenis/dealer.award",
        event.data,
        message,
      );
      await releaseIdempotencyGuard(supabase, key);
    }
    throw err;
  }
}

export const dealerAwardFn = inngest.createFunction(
  { id: "dealer-award-worker", name: "Dealer Award Notifications", retries: 3, concurrency: 5 },
  { event: "autolenis/dealer.award" },
  async (ctx) => runDealerAward(ctx as never),
);

export const dealerAwardFunctions = [dealerAwardFn];
