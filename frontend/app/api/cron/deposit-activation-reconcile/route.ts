// W0-A — Deposit settlement + activation reconciler cron.
//
// Two stages, in order, because the second is useless without the first:
//
//   1. SETTLEMENT (P0 #2) — PENDING deposit whose Stripe PaymentIntent already
//      succeeded → PAID. The Stripe webhook is the only other writer of that
//      transition and it has never delivered in production, so without this a
//      buyer whose $99 genuinely left their card stayed PENDING forever.
//      OFF BY DEFAULT (DEPOSIT_SETTLEMENT_RECONCILE_ENABLED) because it writes
//      money state; while off it reports an honest skip and stage 2 still runs.
//
//   2. ACTIVATION — the original sweep: PAID deposits with no auction, PENDING
//      auctions, and ACTIVE auctions with zero invitations converge to a
//      populated ACTIVE auction or a terminal CLOSED one. The $99 is never
//      auto-refunded (refundable on request, subject to manual review).
//
// Stage 1 feeds stage 2 within the same tick: a deposit settled above is picked
// up by the activation sweep below and turned into a real auction. Both stages
// are idempotent and serialized, so a missed or slow tick self-heals and
// overlapping runs never double-act.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { reconcileStuckActivations } from "@/lib/services/auction/deposit-activation.service";
import { reconcileDepositSettlements } from "@/lib/services/payment/deposit-settlement.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("deposit-activation-reconcile", async () => {
    // Settlement first: a deposit settled here becomes activation's input below.
    // A settlement failure must not prevent activation from converging deposits
    // that are ALREADY paid, so it is reported rather than thrown.
    // Reported rather than thrown, which the comment above has always claimed and the
    // code did not do: an awaited call with no guard meant one failed `findMany` in
    // stage 1 skipped stage 2 entirely, stranding deposits that were ALREADY paid and
    // had nothing to do with the failure.
    let settlement: Awaited<ReturnType<typeof reconcileDepositSettlements>>;
    try {
      settlement = await reconcileDepositSettlements();
    } catch (err) {
      logger.error("[deposit-activation-reconcile] settlement stage failed; activation still runs:", err);
      settlement = { scanned: 0, settled: 0, unsettled: 0, errors: 1, skipped: "settlement_stage_threw" };
      // AND SAY SO ON THE RAIL A PERSON READS.
      //
      // Catching lets stage 2 run — deposits that are ALREADY paid have nothing to do
      // with a stage-1 failure and must still converge. But catching alone turned a dead
      // money-settling stage into a COMPLETED cron row and a 200: anything alerting on
      // cron status would have seen a healthy job while the stage that recovers missed
      // webhooks had been failing for days. The one exception rail is where that belongs.
      //
      // Keyed on the day, so a stage failing every tick produces one row to work rather
      // than one every fifteen minutes.
      try {
        const { raiseException } = await import("@/lib/services/operations/queue-item.service");
        await raiseException({
          code: "PAYMENT_WEBHOOK_MISSED",
          idempotencyKey: `SETTLEMENT_STAGE_DOWN:${new Date().toISOString().slice(0, 10)}`,
          detail:
            `The deposit SETTLEMENT stage of deposit-activation-reconcile threw and recovered no ` +
            `payments this tick: ${err instanceof Error ? err.message : String(err)}. The activation ` +
            `stage still ran. While this persists, a buyer whose Stripe webhook was missed stays ` +
            `PENDING with their money gone — which is the exact condition this stage exists to ` +
            `recover. Check Stripe reachability and the database, then re-run /api/cron/` +
            `deposit-activation-reconcile.`,
        });
      } catch (raiseErr) {
        logger.error("[deposit-activation-reconcile] could not raise the stage-failure exception:", raiseErr);
      }
    }
    const activation = await reconcileStuckActivations();
    return { settlement, activation };
  });

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "RECONCILE_FAILED" }, { status: 500 });
  }

  const { settlement, activation } = run.result;
  // Log only when something happened, so a quiet tick stays quiet.
  if (settlement.settled > 0 || settlement.errors > 0 || activation.scanned > 0) {
    logger.info(`[deposit-activation-reconcile] ${JSON.stringify(run.result)}`);
  }
  return NextResponse.json({ success: true, data: run.result });
}
