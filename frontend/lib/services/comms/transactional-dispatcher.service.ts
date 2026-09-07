// lib/services/comms/transactional-dispatcher.service.ts
//
// THE §27 dispatcher. Every transactional email, SMS and in-app notice in the
// transaction goes through here.
//
//   "All transactional email, SMS, and in-app notices dispatch through the durable
//    outbox with: trigger event, recipient, template and required content, a
//    send-time state recheck, an idempotency key, delivery status, retry policy,
//    cancellation rule, and a terminal-failure Operations alert.
//    NO PAGE REQUEST DETERMINES WHETHER A TRANSACTION COMMUNICATION SURVIVES."
//
// HOW THIS RELATES TO THE EXISTING SERVICE. `comms-outbox.service.ts` already owns
// the same table for the CRM/campaign rail: `enqueueEmail` / `enqueueSms` write
// rows with no `template_key`, and `drainCommsOutbox` claims them with a PostgREST
// compare-and-set. That rail is not replaced and not duplicated — this module
// REUSES its `deliverEmail` / `deliverSms`, so the DNC, suppression, TCPA,
// marketing-consent and EmailSendLog gates are the same code for both rails, and
// so is the provider adapter and its `COMMS_TRANSPORT=capture` boundary.
//
// The two rails are partitioned by `template_key`: transactional rows always carry
// one, CRM rows never do, and each drain filters on it. Without that partition the
// two claim mechanisms would race for the same rows.
//
// WHY A SEPARATE CLAIM. §8.2 requires claiming through `claimed_at` plus
// `FOR UPDATE SKIP LOCKED`. PostgREST cannot express row locking, so the claim
// here is one Prisma raw statement: a `SELECT … FOR UPDATE SKIP LOCKED` CTE
// feeding an `UPDATE … RETURNING`. Two drains running at once take disjoint rows
// with no read-then-write window at all, which the PostgREST CAS only approximates.
//
// WHY ENQUEUE GOES THROUGH PRISMA. `enqueueTransactional` accepts a transaction
// handle, so a caller can write the state change and the message it implies in ONE
// transaction. That is what makes §27's guarantee true rather than aspirational:
// if the request rolls back, so does the message; if it commits, the message is
// durable before the response is written.
//
// THE PHASE 1 COLUMNS THIS FILLS. `trigger_event`, `template_key`,
// `recipient_kind`, `recipient_id`, `vehicle_request_id`, `deal_id`, `auction_id`,
// `state_recheck`, `max_attempts`, `next_attempt_at`, `cancel_key`, `cancelled_at`,
// `cancel_reason`, `terminal_failed_at` were all added by the Phase 1 wave and,
// until this file, had zero readers and zero writers.
//
// Run: pnpm test:comms-outbox

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import {
  deliverEmail,
  deliverSms,
  type DeliveryOutcome,
  type EmailOutboxPayload,
  type SmsOutboxPayload,
} from "./comms-outbox.service";
import { hasStateRecheck, runStateRecheck } from "./state-recheck-registry";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = typeof prisma | Prisma.TransactionClient;

/** Default retry budget. Overridable per message; persisted on the row. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Backoff between attempts, in minutes, indexed by attempt number. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

const TERMINAL_STATUS: Record<DeliveryOutcome, "sent" | "suppressed" | "skipped"> = {
  SUCCESS: "sent",
  SUPPRESSED: "suppressed",
  GATED: "skipped",
  CONSENT_GATED: "skipped",
  TCPA_GATED: "skipped",
  INVALID_PHONE: "skipped",
  DUPLICATE: "skipped",
};

export type RecipientKind = "buyer" | "dealer" | "admin" | "affiliate" | "operations" | "finance";

export interface EnqueueTransactionalInput {
  /** The §27.1 event that fired. Recorded for the completeness assertion in Phase 10. */
  triggerEvent: string;
  /** The §27.1 template. Must have a registered state recheck. */
  templateKey: string;
  channel: "email" | "sms" | "in_app";
  recipientKind: RecipientKind;
  /** The recipient's row id — buyer id, dealer id, admin id. */
  recipientId?: string | null;
  /** The rendered address. Required for email and sms. */
  to?: string | null;
  /** The message body, as the delivery functions expect it. */
  payload: EmailOutboxPayload | SmsOutboxPayload | Record<string, unknown>;
  /** Transaction refs, so a human can find what a message was about. */
  vehicleRequestId?: string | null;
  dealId?: string | null;
  auctionId?: string | null;
  /**
   * The dedup key. Defaults to `${templateKey}:${recipientId ?? to}` — one message
   * per template per recipient. Pass an explicit key for a sequence (touch 1..4).
   */
  idempotencyKey?: string | null;
  /** Send no earlier than this. Defaults to now. */
  runAt?: Date | null;
  /** Cancel handle. Every row sharing a key is cancelled together. */
  cancelKey?: string | null;
  maxAttempts?: number;
}

export interface EnqueueResult {
  enqueued: boolean;
  id: string | null;
  dedupKey: string;
}

/**
 * Write one transactional message to the outbox.
 *
 * Idempotent on `dedup_key`: a duplicate emit adds no row and does not resurrect a
 * completed one. Pass `db` to enqueue inside the caller's transaction.
 */
export async function enqueueTransactional(input: EnqueueTransactionalInput, db: Db = prisma): Promise<EnqueueResult> {
  if (!hasStateRecheck(input.templateKey)) {
    throw new Error(
      `enqueueTransactional("${input.templateKey}"): no state recheck is registered for this template. ` +
        `§27 requires a send-time state recheck on every transactional message. Register one in ` +
        `lib/services/comms/state-recheck-registry.ts — use alwaysSend("<why this cannot become false>") ` +
        `if the trigger genuinely cannot be invalidated.`
    );
  }
  if ((input.channel === "email" || input.channel === "sms") && !input.to) {
    throw new Error(`enqueueTransactional("${input.templateKey}"): channel ${input.channel} requires a recipient address.`);
  }

  const dedupKey = input.idempotencyKey ?? `${input.templateKey}:${input.recipientId ?? input.to ?? "unknown"}`;
  const now = new Date();

  try {
    const row = await db.commsOutbox.create({
      data: {
        id: randomUUID(),
        channel: input.channel,
        dedupKey,
        status: "pending",
        payload: input.payload as Prisma.InputJsonValue,
        runAt: input.runAt ?? now,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: input.runAt ?? now,
        triggerEvent: input.triggerEvent,
        templateKey: input.templateKey,
        recipientKind: input.recipientKind,
        recipientId: input.recipientId ?? null,
        vehicleRequestId: input.vehicleRequestId ?? null,
        dealId: input.dealId ?? null,
        auctionId: input.auctionId ?? null,
        cancelKey: input.cancelKey ?? null,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    return { enqueued: true, id: row.id, dedupKey };
  } catch (err) {
    // ON CONFLICT (dedup_key) DO NOTHING, expressed the way Prisma can: the unique
    // key already holds a row, so this emit is the duplicate the key exists to
    // absorb. Anything else propagates — a failed enqueue must not look like a
    // successful dedup.
    if ((err as { code?: string } | null)?.code === "P2002") {
      return { enqueued: false, id: null, dedupKey };
    }
    throw err;
  }
}

export interface CancelResult {
  cancelled: number;
}

/**
 * §27's cancellation rule. Cancels every not-yet-sent row sharing a cancel key.
 *
 * A sent row is never touched — a message that has left cannot be unsent, and
 * rewriting its status would make the delivery record lie.
 */
export async function cancelByKey(cancelKey: string, reason: string, db: Db = prisma): Promise<CancelResult> {
  if (!cancelKey) throw new Error("cancelByKey requires a cancel key");
  const now = new Date();
  const res = await db.commsOutbox.updateMany({
    where: { cancelKey, status: { in: ["pending", "sending"] } },
    data: { status: "cancelled", cancelledAt: now, cancelReason: reason, updatedAt: now },
  });
  return { cancelled: res.count };
}

interface ClaimedRow {
  id: string;
  channel: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  template_key: string;
  trigger_event: string | null;
  recipient_kind: string | null;
  recipient_id: string | null;
  vehicle_request_id: string | null;
  deal_id: string | null;
  auction_id: string | null;
  dispatched_at: Date | null;
}

/**
 * Claim up to `limit` due transactional rows.
 *
 * `FOR UPDATE SKIP LOCKED` inside the CTE is what makes two concurrent drains take
 * disjoint work: a row another transaction has locked is skipped rather than
 * waited on, and the claim and the read are the same statement, so there is no
 * window between them.
 *
 * Also reclaims rows stuck in `sending` past `stale_minutes` — a drain that died
 * mid-flight must not strand its rows forever.
 */
export async function claimDueTransactional(limit = 100, staleMinutes = 10, db: Db = prisma): Promise<ClaimedRow[]> {
  return db.$queryRaw<ClaimedRow[]>`
    WITH due AS (
      SELECT id
        FROM comms_outbox
       WHERE template_key IS NOT NULL
         AND (
              status = 'pending'
              OR (status = 'sending' AND claimed_at < now() - make_interval(mins => ${staleMinutes}::int))
             )
         AND run_at <= now()
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY run_at ASC
       LIMIT ${limit}::int
       FOR UPDATE SKIP LOCKED
    )
    UPDATE comms_outbox o
       SET status = 'sending', claimed_at = now(), updated_at = now()
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.channel, o.attempts, o.max_attempts, o.payload, o.template_key,
              o.trigger_event, o.recipient_kind, o.recipient_id, o.vehicle_request_id,
              o.deal_id, o.auction_id, o.dispatched_at
  `;
}

export type DispatchResult = "SENT" | "GATED" | "SKIPPED_BY_RECHECK" | "RETRY" | "FAILED";

/**
 * Deliver one claimed row: recheck, send, record.
 *
 * Order matters. The recheck runs BEFORE the provider is touched, because a
 * message that has become false must not be sent and then apologised for.
 */
export async function dispatchTransactionalRow(
  row: ClaimedRow,
  supabase: SupabaseClient,
  db: Db = prisma
): Promise<DispatchResult> {
  const now = new Date();

  // A reclaimed row that already reached the provider is never re-sent: we cannot
  // know whether it was delivered, and a duplicate transactional message is worse
  // than a reported failure. Same rule as the CRM rail.
  if (row.dispatched_at) {
    await terminalFail(db, row, "RECLAIM_UNCERTAIN", "reclaimed after dispatch; not re-sent to avoid a duplicate");
    return "FAILED";
  }

  const decision = await runStateRecheck({
    templateKey: row.template_key,
    triggerEvent: row.trigger_event ?? "",
    vehicleRequestId: row.vehicle_request_id,
    dealId: row.deal_id,
    auctionId: row.auction_id,
    recipientKind: row.recipient_kind,
    recipientId: row.recipient_id,
    payload: row.payload ?? {},
    db,
  });

  if (!decision.proceed) {
    await db.commsOutbox.update({
      where: { id: row.id },
      data: {
        status: "skipped",
        lastResult: "STATE_RECHECK_SKIP",
        lastError: decision.reason,
        stateRecheck: { checkedAt: now.toISOString(), proceed: false, reason: decision.reason } as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });
    return "SKIPPED_BY_RECHECK";
  }

  const attempt = row.attempts + 1;
  const onDispatch = async () => {
    await db.commsOutbox.update({ where: { id: row.id }, data: { dispatchedAt: new Date(), updatedAt: new Date() } });
  };

  try {
    // in_app has no provider: the row IS the record, and the buyer surface reads
    // the outbox. Nothing is "sent" anywhere, so it is marked delivered directly.
    if (row.channel === "in_app") {
      await db.commsOutbox.update({
        where: { id: row.id },
        data: {
          status: "delivered",
          lastResult: "IN_APP",
          attempts: attempt,
          deliveredAt: now,
          stateRecheck: { checkedAt: now.toISOString(), proceed: true } as Prisma.InputJsonValue,
          updatedAt: now,
        },
      });
      return "SENT";
    }

    const { outcome, providerId } =
      row.channel === "email"
        ? await deliverEmail(supabase, row.payload as EmailOutboxPayload, { onDispatch })
        : await deliverSms(supabase, row.payload as SmsOutboxPayload, { onDispatch });

    await db.commsOutbox.update({
      where: { id: row.id },
      data: {
        status: TERMINAL_STATUS[outcome],
        lastResult: outcome,
        providerId: providerId ?? null,
        attempts: attempt,
        stateRecheck: { checkedAt: now.toISOString(), proceed: true } as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });
    return outcome === "SUCCESS" ? "SENT" : "GATED";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const maxAttempts = row.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
    if (attempt >= maxAttempts) {
      await terminalFail(db, row, "FAILED", message, attempt);
      return "FAILED";
    }
    const backoff = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)]!;
    await db.commsOutbox.update({
      where: { id: row.id },
      data: {
        status: "pending",
        lastError: message,
        attempts: attempt,
        nextAttemptAt: new Date(Date.now() + backoff * 60_000),
        updatedAt: new Date(),
      },
    });
    logger.warn(`[comms-dispatcher] ${row.template_key} attempt ${attempt}/${maxAttempts} failed, retrying in ${backoff}m`, message);
    return "RETRY";
  }
}

/**
 * Terminal failure. §27's last clause: "a terminal-failure Operations alert".
 *
 * The exception is raised through the single writer. If THAT fails the error
 * propagates — a transactional message that could not be delivered AND could not
 * be reported is not something to log and move past.
 */
async function terminalFail(
  db: Db,
  row: ClaimedRow,
  lastResult: string,
  message: string,
  attempts?: number
): Promise<void> {
  const now = new Date();
  await db.commsOutbox.update({
    where: { id: row.id },
    data: {
      status: "failed",
      lastResult,
      lastError: message,
      terminalFailedAt: now,
      ...(attempts !== undefined ? { attempts } : {}),
      updatedAt: now,
    },
  });
  logger.error(`[comms-dispatcher] ${row.template_key} terminally failed`, { rowId: row.id, message });

  await raiseException(
    {
      code: "COMMS_TERMINAL_FAILURE",
      vehicleRequestId: row.vehicle_request_id,
      dealId: row.deal_id,
      auctionId: row.auction_id,
      buyerId: row.recipient_kind === "buyer" ? row.recipient_id : null,
      dealerId: row.recipient_kind === "dealer" ? row.recipient_id : null,
      // Once-ever per outbox row: a terminal failure happens once, and re-raising
      // it on a later sweep would multiply the alert.
      idempotencyKey: `COMMS_TERMINAL_FAILURE:${row.id}`,
      detail: `template ${row.template_key} to ${row.recipient_kind ?? "unknown"} ${row.recipient_id ?? ""}: ${message}`,
    },
    db
  );
}

export interface TransactionalDrainSummary {
  status: "OK" | "NO_PENDING";
  claimed: number;
  sent: number;
  gated: number;
  skippedByRecheck: number;
  retried: number;
  failed: number;
  errored: number;
}

/**
 * Drain the transactional rail. Called by the existing `comms-outbox-drain` cron
 * alongside `drainCommsOutbox`; no new cron and no new schedule.
 */
export async function drainTransactionalOutbox(batchSize = 100): Promise<TransactionalDrainSummary> {
  const { getServiceSupabase } = await import("@/lib/supabase-service");
  const supabase = getServiceSupabase();

  const rows = await claimDueTransactional(batchSize);
  if (rows.length === 0) {
    return { status: "NO_PENDING", claimed: 0, sent: 0, gated: 0, skippedByRecheck: 0, retried: 0, failed: 0, errored: 0 };
  }

  const summary: TransactionalDrainSummary = {
    status: "OK",
    claimed: rows.length,
    sent: 0,
    gated: 0,
    skippedByRecheck: 0,
    retried: 0,
    failed: 0,
    errored: 0,
  };

  for (const row of rows) {
    let result: DispatchResult;
    try {
      result = await dispatchTransactionalRow(row, supabase);
    } catch (err) {
      // One row must not abort the batch. The row stays claimed and is reclaimed
      // by the stale-claim path on a later tick, so nothing is lost.
      logger.error(`[comms-dispatcher] unexpected error on row ${row.id}`, err);
      summary.errored++;
      continue;
    }
    if (result === "SENT") summary.sent++;
    else if (result === "GATED") summary.gated++;
    else if (result === "SKIPPED_BY_RECHECK") summary.skippedByRecheck++;
    else if (result === "RETRY") summary.retried++;
    else summary.failed++;
  }
  return summary;
}
