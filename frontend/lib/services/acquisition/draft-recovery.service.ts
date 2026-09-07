// lib/services/acquisition/draft-recovery.service.ts
//
// §6.4 — the four-touch draft recovery sequence, and the 14-day abandonment.
//
//   | Touch | Timing     | Content                                          |
//   |-------|------------|--------------------------------------------------|
//   | 1     | Immediately| What was captured, what remains, resume link      |
//   | 2     | 1 hour     | Resume link                                      |
//   | 3     | 24 hours   | Resume link plus what happens after               |
//   | 4     | 72 hours   | Final reminder                                    |
//
//   "Mark the draft abandoned after 14 calendar days. NEVER DELETE: the lead,
//    attribution, and audit history are retained for reactivation and for
//    marketing performance measurement."
//
// ALL FOUR ARE ENQUEUED AT CAPTURE, not chained. Four rows with four `run_at`
// times, written in one call, mean the sequence exists in the database the moment
// the visitor closes the tab — §27's "no page request determines whether a
// transaction communication survives", applied to a sequence rather than a single
// message. A chain, where each touch schedules the next, has three more chances to
// break and leaves no record of what was supposed to happen.
//
// THE STATE RECHECK IS WHAT MAKES THAT SAFE. Each row carries the
// `draft_recovery_*` template, whose registered recheck re-reads the request at
// send time and SKIPS when it is no longer a DRAFT (`state-recheck-registry.ts`).
// A buyer who finishes their request an hour in gets touch 1 and nothing after —
// without the recheck, enqueuing all four up front would keep chasing someone who
// already arrived.
//
// CANCELLATION IS THE SECOND HALF. Every row shares a cancel key, so
// `cancelDraftRecovery` stops the whole sequence at once when the request
// advances. The recheck alone would be enough to prevent a wrong send; cancelling
// also stops the rows being claimed and drained at all, which keeps the outbox
// honest about what is still pending.
//
// ABANDONMENT MARKS, IT DOES NOT DELETE. `abandonDraft` stamps
// `vehicle_requests.abandoned_at` at 14 days. The row, its attribution and its
// events all stay — §6.4 says so twice.
//
// Run: pnpm test:intake

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { enqueueTransactional, cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_2_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";

type Db = typeof prisma | Prisma.TransactionClient;

const HOUR = 3_600_000;

/** §6.4's four touches, with their delays. */
export const DRAFT_RECOVERY_TOUCHES = [
  { template: PHASE_2_TEMPLATES.DRAFT_RECOVERY_1, delayMs: 0, trigger: "draft_abandoned_recovery_1" },
  { template: PHASE_2_TEMPLATES.DRAFT_RECOVERY_2, delayMs: 1 * HOUR, trigger: "draft_abandoned_recovery_2" },
  { template: PHASE_2_TEMPLATES.DRAFT_RECOVERY_3, delayMs: 24 * HOUR, trigger: "draft_abandoned_recovery_3" },
  { template: PHASE_2_TEMPLATES.DRAFT_RECOVERY_4, delayMs: 72 * HOUR, trigger: "draft_abandoned_recovery_4" },
] as const;

/** §6.4: "Mark the draft abandoned after 14 calendar days." */
export const DRAFT_ABANDON_AFTER_DAYS = 14;

/** One cancel handle per request, so the whole sequence stops together. */
export function draftRecoveryCancelKey(vehicleRequestId: string): string {
  return `draft_recovery:${vehicleRequestId}`;
}

export interface EnqueueDraftRecoveryInput {
  vehicleRequestId: string;
  email: string;
  firstName?: string | null;
  /** Overrides "now", for tests. */
  from?: Date;
}

export interface EnqueueDraftRecoveryResult {
  enqueued: number;
  cancelKey: string;
}

/** Enqueue all four touches at capture. Idempotent per (template, request). */
export async function enqueueDraftRecovery(
  input: EnqueueDraftRecoveryInput,
  db: Db = prisma
): Promise<EnqueueDraftRecoveryResult> {
  const base = (input.from ?? new Date()).getTime();
  const cancelKey = draftRecoveryCancelKey(input.vehicleRequestId);
  let enqueued = 0;

  for (const touch of DRAFT_RECOVERY_TOUCHES) {
    const result = await enqueueTransactional(
      {
        triggerEvent: touch.trigger,
        templateKey: touch.template,
        channel: "email",
        recipientKind: "buyer",
        to: input.email,
        vehicleRequestId: input.vehicleRequestId,
        // Keyed on the REQUEST, not the address: a buyer whose address changes
        // must not receive the sequence twice, and one keyed on the address would
        // collide across two people sharing a mailbox.
        idempotencyKey: `${touch.template}:${input.vehicleRequestId}`,
        cancelKey,
        runAt: new Date(base + touch.delayMs),
        payload: {
          email: input.email,
          firstName: input.firstName ?? null,
          type: "transactional",
          templateId: touch.template,
          idempotencyKey: `${touch.template}:${input.vehicleRequestId}`,
        },
      },
      db
    );
    if (result.enqueued) enqueued++;
  }

  logger.info("[draft-recovery] sequence enqueued", { vehicleRequestId: input.vehicleRequestId, enqueued });
  return { enqueued, cancelKey };
}

/** Stop the sequence — the request advanced, or was cancelled. */
export async function cancelDraftRecovery(vehicleRequestId: string, reason: string, db: Db = prisma): Promise<number> {
  const { cancelled } = await cancelByKey(draftRecoveryCancelKey(vehicleRequestId), reason, db);
  if (cancelled > 0) {
    logger.info("[draft-recovery] sequence cancelled", { vehicleRequestId, cancelled, reason });
  }
  return cancelled;
}

export interface AbandonSweepResult {
  scanned: number;
  abandoned: string[];
}

/**
 * Mark drafts abandoned at 14 days. NEVER deletes.
 *
 * `abandoned_at` is a stamp, not a status change: the request keeps its DRAFT
 * status and its place in the one-open-per-buyer index, so a buyer who comes back
 * on day 20 resumes the same request rather than starting a second one.
 */
export async function abandonStaleDrafts(now: Date = new Date(), db: Db = prisma): Promise<AbandonSweepResult> {
  const cutoff = new Date(now.getTime() - DRAFT_ABANDON_AFTER_DAYS * 24 * HOUR);
  const stale = await db.vehicleRequest.findMany({
    where: { status: "DRAFT", abandonedAt: null, createdAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });

  const abandoned: string[] = [];
  for (const row of stale) {
    await db.vehicleRequest.update({ where: { id: row.id }, data: { abandonedAt: now } });
    await cancelDraftRecovery(row.id, "draft abandoned at 14 days", db);
    abandoned.push(row.id);
  }
  return { scanned: stale.length, abandoned };
}
