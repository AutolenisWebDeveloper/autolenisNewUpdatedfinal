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
import { withSavepoint } from "@/lib/prisma-savepoint";
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
import { isDefinitiveNonDelivery } from "./comms-providers";
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


/** `email_templates.id` is a UUID column; anything else makes the lookup a 22P02. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An email row must carry content the drain can actually render.
 *
 * `deliverEmail` resolves `payload.templateId` through
 * `TemplateService.getTemplate`, which filters `email_templates.id` — a UUID
 * PRIMARY KEY. A template KEY there (`"draft_recovery_1"`) is not a lookup miss:
 * PostgreSQL rejects the comparison with 22P02, the render throws, and the row
 * retries five times and terminal-fails. The message is undeliverable and nothing
 * says so until an Operations exception appears hours later.
 *
 * The key belongs in `template_key` on the ROW, where the state recheck and the
 * §27 completeness assertion read it. The PAYLOAD carries the content. This
 * refuses at enqueue, where the stack trace still names the producer.
 */
function assertRenderableEmail(input: EnqueueTransactionalInput): void {
  if (input.channel !== "email") return;
  const payload = input.payload as {
    templateId?: unknown;
    subject?: unknown;
    html?: unknown;
    email?: unknown;
  };

  // THE ADDRESS LIVES IN THE PAYLOAD, AND ONLY IN THE PAYLOAD.
  //
  // `input.to` is validated above and then NOT stored: `comms_outbox` has no recipient-address
  // column, so the row the drain claims carries the address only inside `payload`. The drain
  // hands `row.payload` straight to `deliverEmail`, which reads `payload.email` both for the
  // suppression lookup and for the send.
  //
  // A caller that passes `to` and omits `payload.email` therefore enqueues a row that checks
  // suppression for `undefined` and then asks the provider to mail `undefined` — and because
  // `to` was validated, the call looked correct at the producer. That is how the two
  // `inventory-stale-sweep` dealer notices came to be undeliverable with nothing saying so.
  //
  // Refused here, where the stack trace still names the producer, and required to MATCH `to` so
  // the validated address and the sent address cannot diverge.
  if (typeof payload.email !== "string" || !payload.email) {
    throw new Error(
      `enqueueTransactional("${input.templateKey}"): an email payload must carry the recipient in ` +
        `payload.email. \`to\` is validated but not stored — comms_outbox has no address column, and ` +
        `deliverEmail reads payload.email for both the suppression check and the send. Without it the ` +
        `row is delivered to undefined.`
    );
  }
  if (payload.email !== input.to) {
    throw new Error(
      `enqueueTransactional("${input.templateKey}"): payload.email ("${payload.email}") and to ` +
        `("${String(input.to)}") disagree. Only payload.email is stored, so the row would be sent to an ` +
        `address the enqueue never validated.`
    );
  }

  if (payload.templateId !== undefined && payload.templateId !== null) {
    if (typeof payload.templateId !== "string" || !UUID_RE.test(payload.templateId)) {
      throw new Error(
        `enqueueTransactional("${input.templateKey}"): payload.templateId must be an email_templates UUID, got ` +
          `"${String(payload.templateId)}". The template KEY goes in templateKey (the row column); the payload ` +
          `carries either a real template UUID or a rendered subject + html.`
      );
    }
    return;
  }

  if (!payload.subject || !payload.html) {
    throw new Error(
      `enqueueTransactional("${input.templateKey}"): an email payload needs a rendered subject and html ` +
        `(or an email_templates UUID in templateId). Without either, deliverEmail throws EMAIL_PAYLOAD_INCOMPLETE ` +
        `on every attempt and the row terminal-fails.`
    );
  }
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
  assertRenderableEmail(input);

  const dedupKey = input.idempotencyKey ?? `${input.templateKey}:${input.recipientId ?? input.to ?? "unknown"}`;
  const now = new Date();

  try {
    // Savepointed: enqueueTransactional is designed to be called inside the
    // caller's transaction, and its dedup key makes P2002 the EXPECTED outcome of
    // a duplicate emit. Without a savepoint that expected conflict would abort the
    // caller's whole transaction (lib/prisma-savepoint.ts).
    const row = await withSavepoint(db, () => db.commsOutbox.create({
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
    }));
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

/**
 * Cancel every not-yet-sent row belonging to a transaction. §24's "close scheduled work".
 *
 * ── WHY THIS EXISTS RATHER THAN A LIST OF CANCEL KEYS ───────────────────────
 *
 * Phase 10's cancellation orchestration first tried to do this by building keys —
 * `deal:<id>`, `request:<id>`, `auction:<id>` — and those keys match NOTHING. The real
 * ones are minted by six different builders (`recapCancelKey`,
 * `signatureReminderCancelKey`, `contractRequestCancelKey`, `insuranceReviewCancelKey`,
 * `reaffirmationReminderCancelKey`, `selectionReminderCancelKey`) plus ad-hoc ones in
 * draft recovery, deposit reminders and invitations. `cancelByKey` matches on exact
 * equality, so the stop reported `affected: 0, ok: true` and a cancelled buyer kept
 * receiving every queued reminder. The first independent review found it — inside the
 * module written to remove exactly that class of silent success.
 *
 * Enumerating the keys would have worked until the seventh builder. The REFS are already
 * on the row: `deal_id`, `vehicle_request_id` and `auction_id` are columns
 * `enqueueTransactional` fills for precisely this reason ("Transaction refs, so a human
 * can find what a message was about"). Cancelling by them cannot drift as keys are added.
 *
 * SENT ROWS ARE NEVER TOUCHED, same rule as `cancelByKey`: a message that has left
 * cannot be unsent, and rewriting its status would make the delivery record lie.
 */
export async function cancelPendingForTransaction(
  refs: { dealId?: string | null; vehicleRequestId?: string | null; auctionId?: string | null },
  reason: string,
  db: Db = prisma,
): Promise<CancelResult> {
  const or: Prisma.CommsOutboxWhereInput[] = [];
  if (refs.dealId) or.push({ dealId: refs.dealId });
  if (refs.vehicleRequestId) or.push({ vehicleRequestId: refs.vehicleRequestId });
  if (refs.auctionId) or.push({ auctionId: refs.auctionId });
  // No refs means no scope. Cancelling every pending row in the table because a caller
  // passed nothing is the worst possible reading of an empty filter.
  if (or.length === 0) return { cancelled: 0 };

  const now = new Date();
  const res = await db.commsOutbox.updateMany({
    where: { OR: or, status: { in: ["pending", "sending"] } },
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
  /**
   * Carried so the reclaim guard can tell an OBSERVED provider refusal from an
   * unobserved crash, and so a terminal failure does not overwrite the transport
   * error that explains it. The claim used to return neither, which is exactly why
   * the reclaim note could only replace the real reason.
   */
  last_error: string | null;
  last_result: string | null;
  /**
   * The row's status BEFORE this claim. `'sending'` means a previous drain claimed
   * it and never came back — the only case where the outcome is genuinely unknown.
   * `'pending'` means the previous attempt finished its own bookkeeping and asked
   * for this retry. Absent on a hand-built row, which is treated as reclaimed.
   */
  prev_status?: string | null;
}

/**
 * `last_result` marking a failure we watched the provider refuse. Nothing was sent,
 * so the row is an ordinary pending retry however it was reclaimed.
 */
const PROVIDER_REJECTED = "PROVIDER_REJECTED";

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
      -- The PRIOR status, captured before the UPDATE below overwrites it. RETURNING
      -- yields new values, so without carrying it here there is no way to tell a row
      -- that came back on its own backoff from one whose drain died mid-flight — and
      -- that difference is the whole basis of the reclaim guard.
      SELECT id, status AS prev_status
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
              o.deal_id, o.auction_id, o.dispatched_at, o.last_error, o.last_result,
              due.prev_status
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
  //
  // "Cannot know" is the whole content of the rule, and this guard asked the wrong
  // question. `dispatched_at` is stamped immediately before the send, so EVERY
  // provider failure landed with it set — including ones whose attempt finished
  // normally, booked its own backoff and asked to be retried. Those were read as
  // crashes: the retry budget was unreachable for the entire failure class, and
  // §27's alert fired at attempt 1 of 5 with the transport error already overwritten.
  //
  // Two conditions now, and the first is the one that matters. `prev_status` is the
  // status before this claim: 'sending' means a previous drain took the row and
  // never came back, which is the only case where the outcome is genuinely unknown.
  // 'pending' means the last attempt completed its bookkeeping — the process
  // survived, and this is the retry it scheduled. That is the shape the CRM rail has
  // always used (`reclaimed && row.dispatched_at`, comms-outbox.service.ts:419) and
  // it is why that rail never had this defect.
  //
  // The second condition refines the genuinely-reclaimed case: if the last thing we
  // watched happen was the provider REFUSING, nothing was sent, so even a crashed
  // drain leaves nothing to duplicate.
  const unobserved = (row.prev_status ?? "sending") === "sending";
  if (unobserved && row.dispatched_at && row.last_result !== PROVIDER_REJECTED) {
    await terminalFail(
      db,
      row,
      "RECLAIM_UNCERTAIN",
      "reclaimed after dispatch; not re-sent to avoid a duplicate",
      undefined,
      true,
    );
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
    return recordFailedAttempt(db, row, err);
  }
}

/**
 * Book one failed attempt: back off, or terminal-fail once the budget is spent.
 *
 * Extracted so the BATCH-level catch can use it too. It could not before, and that
 * was a hole with no bottom: `claimDueTransactional` does not increment `attempts`,
 * so a row whose recheck or bookkeeping write threw — outside the send's own try —
 * stayed `sending` with `attempts` unchanged, was reclaimed by the stale-claim path
 * ten minutes later, and threw again. Forever. No retry budget was ever spent, so
 * §27's terminal-failure Operations alert never fired for that entire failure class.
 */
async function recordFailedAttempt(db: Db, row: ClaimedRow, err: unknown): Promise<DispatchResult> {
  const message = err instanceof Error ? err.message : String(err);
  const attempt = row.attempts + 1;
  const maxAttempts = row.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  // Whether we WATCHED the provider refuse, or only know the attempt threw. The
  // difference is the reclaim guard's entire premise, so it is recorded on the row
  // rather than re-derived later from an error string.
  const observed = isDefinitiveNonDelivery(err);
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
      // Always overwritten, never merely set. The marker describes THIS attempt: a
      // row refused on attempt 1 and then timing out on attempt 2 is uncertain
      // again, and leaving a stale PROVIDER_REJECTED behind would let the guard
      // wave through exactly the re-send it exists to prevent.
      lastResult: observed ? PROVIDER_REJECTED : null,
      attempts: attempt,
      nextAttemptAt: new Date(Date.now() + backoff * 60_000),
      updatedAt: new Date(),
    },
  });
  logger.warn(`[comms-dispatcher] ${row.template_key} attempt ${attempt}/${maxAttempts} failed, retrying in ${backoff}m`, message);
  return "RETRY";
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
  attempts?: number,
  /** Reclaim path only: `message` is a note about not re-sending, not a diagnosis. */
  preserveExistingError = false
): Promise<void> {
  const now = new Date();
  // PRESERVE THE TRANSPORT ERROR — but only where `message` is not itself the
  // diagnosis. Two callers reach here and they are opposites: the budget-exhausted
  // path passes the CURRENT attempt's provider error, which is the freshest and best
  // account of the failure, while the reclaim path passes a note about not re-sending,
  // which explains nothing about why the send failed and used to overwrite the only
  // record that did. On the production rows this defect produced, the real cause was
  // gone before anyone looked at them.
  const recordedError = preserveExistingError ? (row.last_error ?? message) : message;
  await db.commsOutbox.update({
    where: { id: row.id },
    data: {
      status: "failed",
      lastResult,
      lastError: recordedError,
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
      // Both halves: WHY it stopped (`message`, e.g. the reclaim note) and WHY it
      // failed (`recordedError`, the transport error), which are different questions
      // and were previously collapsed into whichever was written last. The recipient
      // is rendered as "unidentified" rather than an empty string when the enqueue
      // supplied no id — "to buyer :" read as a bug in the alert rather than a
      // missing field on the row.
      detail:
        `template ${row.template_key} to ${row.recipient_kind ?? "unknown"} ` +
        `${row.recipient_id ?? "(unidentified)"}: ${message}` +
        (recordedError !== message ? ` — last transport error: ${recordedError}` : ""),
    },
    db
  );
}

/**
 * §27 — A REQUIRED COMMUNICATION HAS NOWHERE TO GO.
 *
 * Owner ruling 2026-09-14: "a `logger.error` standing in for an exception is the defect class this
 * program has spent five phases eliminating." Five sites across this phase discovered that a
 * recipient had no address and returned silently; this is the one place that turns that discovery
 * into an owned case.
 *
 * NOT `COMMS_TERMINAL_FAILURE`. That code is for a message that entered the rail and exhausted its
 * retries: it keys on `comms_outbox.id` and sends the operator to the outbox. Here there is no row
 * — `enqueueTransactional` refuses a channel with no address before the insert — so the operator
 * would arrive to find nothing. See the catalogue entry for the full argument.
 *
 * THE TRY/CATCH IS IN HERE, NOT AT THE CALL SITES, and that placement is the point.
 * `queue-item.service.ts` states the contract: "a caller on a request hot path that must not fail
 * because of the queue wraps this call itself — the writer does not silently drop an exception on
 * the caller's behalf." No caller of this helper can afford a throw: three sit inside
 * `processAuctionClose`'s claimed block, one is on a buyer request path, and the fifth is inside
 * `sweepUnselectedAuctions`'s per-auction best-effort catch, where a throw would skip `swept++` and
 * report a buyer as swept whose terminal `BUYER_DOES_NOT_SELECT` marker has already landed — so the
 * auction never becomes a candidate again. Putting the wrap in one place is what stops the sixth
 * call site forgetting it.
 *
 * That matters more than it looks. A throw out of `enqueueCloseNotice` releases the post-close
 * claim and is rethrown, and the condition is DURABLE — a missing mailbox does not appear on its
 * own — so the five-minute cron would re-enter the whole close path forever: the zero-offer case
 * would never be raised (it sits after the notice), no dealership would ever be told there was no
 * winner, `postCloseProcessedAt` would stay NULL and permanently exclude the auction from the S15
 * sweep, and the admin manual close would 500 on a close that actually happened. One reportable
 * defect would become five.
 *
 * The deliberate asymmetry: `raiseCloseException` is correctly NOT wrapped. Its failure is
 * transient, so releasing the claim and retrying is the right answer there. This one's is not.
 */
export async function raiseNoDeliverableChannel(
  input: {
    templateKey: string;
    channel: "email" | "sms";
    /** The dedup key the notice WOULD have carried. The key names the message that does not exist. */
    outboxKey: string;
    recipientKind: "buyer" | "dealer";
    recipientId: string | null;
    refs: {
      vehicleRequestId?: string | null;
      dealId?: string | null;
      auctionId?: string | null;
      depositId?: string | null;
      buyerId?: string | null;
      dealerId?: string | null;
    };
  },
  db: Db = prisma,
): Promise<void> {
  try {
    await raiseException(
      {
        code: "COMMS_NO_DELIVERABLE_CHANNEL",
        ...input.refs,
        // Once-ever on the message that was never produced. The condition is durable, so a
        // recurrence suffix would open a new row on every pass for as long as the address is
        // missing.
        idempotencyKey: `COMMS_NO_DELIVERABLE_CHANNEL:${input.outboxKey}`,
        // Mirrors `terminalFail`'s detail shape, including its "(unidentified)" convention — a
        // recipient rendered as an empty string reads as a bug in the alert rather than a missing
        // field on the row.
        detail:
          `template ${input.templateKey} to ${input.recipientKind} ` +
          `${input.recipientId ?? "(unidentified)"}: no ${input.channel} address on record — ` +
          `no outbox row was produced`,
      },
      db,
    );
  } catch (err) {
    logger.error(
      `[comms-dispatcher] could not raise COMMS_NO_DELIVERABLE_CHANNEL for ${input.outboxKey}:`,
      err,
    );
  }
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
      // One row must not abort the batch — but it must still SPEND an attempt.
      // Leaving it claimed with attempts unchanged made it immortal: reclaimed,
      // rethrown, reclaimed, with the retry budget never consumed and the
      // terminal-failure alert never reached.
      logger.error(`[comms-dispatcher] unexpected error on row ${row.id}`, err);
      summary.errored++;
      try {
        const booked = await recordFailedAttempt(prisma, row, err);
        if (booked === "FAILED") summary.failed++;
        else summary.retried++;
      } catch (bookErr) {
        // The database is the thing that is failing. The stale-claim path is the
        // remaining safety net and it is still in place.
        logger.error(`[comms-dispatcher] could not book the failed attempt for ${row.id}`, bookErr);
      }
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

/**
 * §27 — enqueue a transactional message, and raise an EXCEPTION if the enqueue itself fails.
 *
 * WHY THIS EXISTS. `enqueueTransactional` throws on an unregistered template, an unrenderable
 * payload, or a database failure. Call sites were writing `.catch(() => undefined)` after it,
 * which turns all three into silence: the caller returns normally, the transaction the message
 * was about is committed, and nobody is told. That is exactly how the `RETURNED_TO_OFFERS` notice
 * §Stage 10 owes a buyer came to never send while every other assertion passed — the template had
 * no registered recheck, `enqueueTransactional` threw, and the blind catch ate it.
 *
 * A message that cannot be enqueued is an Operations condition, not a debug line. This is the
 * shape that site now uses, extracted so the next caller inherits it instead of re-deriving it:
 * log with the refs, then open a `COMMS_TERMINAL_FAILURE` row naming what the recipient is
 * missing. The raise is itself guarded — a failing queue writer must not mask the original
 * failure — but it is never the only record, because the log line above it always runs.
 *
 * Returns `true` when the row was enqueued, `false` when it was not. Callers that have something
 * to do differently (a status they should not advance) can branch on it; callers that only owed
 * the message can ignore it and the exception row carries the follow-up.
 */
export async function enqueueOrRaise(
  input: EnqueueTransactionalInput,
  context: {
    /** What a human reading the exception needs to know is missing, and for whom. */
    detail: string;
    /** Stable per subject, so a retried caller does not open a second row. */
    idempotencyKey: string;
    buyerId?: string | null;
    dealerId?: string | null;
    vehicleRequestId?: string | null;
  },
  db: Db = prisma,
): Promise<boolean> {
  try {
    await enqueueTransactional(input, db);
    return true;
  } catch (err) {
    logger.error(`[comms] ${input.templateKey}: enqueue failed`, {
      templateKey: input.templateKey,
      dealId: input.dealId ?? null,
      recipientKind: input.recipientKind,
      error: err instanceof Error ? err.message : String(err),
    });
    const { raiseException } = await import("@/lib/services/operations/queue-item.service");
    await raiseException({
      code: "COMMS_TERMINAL_FAILURE",
      dealId: input.dealId ?? null,
      auctionId: input.auctionId ?? null,
      vehicleRequestId: context.vehicleRequestId ?? input.vehicleRequestId ?? null,
      buyerId: context.buyerId ?? null,
      dealerId: context.dealerId ?? null,
      idempotencyKey: context.idempotencyKey,
      detail: context.detail,
    }).catch((raiseErr) => {
      // The queue writer is the thing that is failing. The log line above already ran, so this is
      // not silence — but it is the last record, and it says so.
      logger.error(`[comms] ${input.templateKey}: enqueue failed AND the exception could not be raised`, {
        dealId: input.dealId ?? null,
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
    return false;
  }
}
