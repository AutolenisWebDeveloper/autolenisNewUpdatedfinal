// lib/services/payment/deposit-reminder.service.ts
//
// PAY-19 / PAY-21 / PAY-23 / §5c — the six-touch $99 series, moved onto the
// transactional dispatcher and KEYED TO THE VEHICLE REQUEST.
//
// WHERE IT RAN BEFORE, and what was wrong with it. The series ran on
// `lifecycle_touch_schedule`: enrolment wrote one row, a cron drained it every FIFTEEN
// minutes, and each touch chained the next on success. Three consequences, in
// increasing order of seriousness:
//
//   1. FIFTEEN-MINUTE GRANULARITY, CHAINED. Every touch waits for a drain tick, and
//      each one's delay is measured from when the PREVIOUS one actually sent — so the
//      "+1h" touch lands up to fifteen minutes late, and the day-7 touch inherits the
//      accumulated drift of five predecessors. The outbox drains every minute and each
//      row carries its own absolute `run_at`, so the schedule is the schedule.
//   2. KEYED TO THE BUYER. `deposit-reminder:{buyerId}` cannot tell two Vehicle
//      Requests apart. §23.1 is explicit that a new request means a new $99, so a
//      buyer who paid for one request and started another was either chased for money
//      they had paid or not chased at all, depending on which row the guard read
//      first. The cancel key here is the REQUEST.
//   3. NO STATE RECHECK ON THE REQUEST. The old guard re-read the buyer's deposits and
//      the buyer's account flags, and nothing about the request — so cancelling the
//      request left the series running against it (PAY-21, PAY-23).
//
// WHAT IS DELIBERATELY UNCHANGED. The words. `DEPOSIT_REMINDER_RENDERERS` is imported
// from the module that already owned them, so the two rails cannot drift into two
// texts — which is the §13-D48 failure in miniature. The cadence is the same six
// offsets. The consent, suppression and TCPA gates are the ones `deliverEmail` /
// `deliverSms` already apply on every outbox row.
//
// REPORTED, NOT CHANGED: the copy calls the $99 an "Auction Access Deposit" and says
// dealers "compete in a private auction". §23.1 rules the $99 IS the Standard plan
// paid in full, and this phase stops settlement creating an auction at all. That is
// §13-D48's subject — legal-approved copy, written once and reused — and rewriting it
// here would be a third text, not a correction.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { DEPOSIT_REMINDER_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";

type Db = typeof prisma | Prisma.TransactionClient;

const HOUR = 60 * 60 * 1000;

/**
 * The cadence: 0 / +1h / +6h / +24h / +72h / day-7, every offset ABSOLUTE from
 * enrolment rather than relative to the previous send. Ported from the sequence table
 * this replaces, where the same schedule was expressed as five chained relative delays
 * (60m, 5h, 18h, 48h, 96m…) — a shape that is correct only if every predecessor sent
 * on time.
 */
export const DEPOSIT_REMINDER_TOUCHES = [
  { index: 1, delayMs: 0,         template: DEPOSIT_REMINDER_TEMPLATES.DEPOSIT_REMINDER_1, trigger: "deposit_pending_reminder_1" },
  { index: 2, delayMs: 1 * HOUR,  template: DEPOSIT_REMINDER_TEMPLATES.DEPOSIT_REMINDER_2, trigger: "deposit_pending_reminder_2" },
  { index: 3, delayMs: 6 * HOUR,  template: DEPOSIT_REMINDER_TEMPLATES.DEPOSIT_REMINDER_3, trigger: "deposit_pending_reminder_3" },
  { index: 4, delayMs: 24 * HOUR, template: DEPOSIT_REMINDER_TEMPLATES.DEPOSIT_REMINDER_4, trigger: "deposit_pending_reminder_4" },
  { index: 5, delayMs: 72 * HOUR, template: DEPOSIT_REMINDER_TEMPLATES.DEPOSIT_REMINDER_5, trigger: "deposit_pending_reminder_5" },
  { index: 6, delayMs: 168 * HOUR, template: DEPOSIT_REMINDER_TEMPLATES.DEPOSIT_REMINDER_6, trigger: "deposit_pending_reminder_6" },
] as const;

/**
 * One cancel handle for the whole series, per REQUEST.
 *
 * Matches the Phase 2 convention (`draft_recovery:<requestId>`) so an operator reading
 * `comms_outbox.cancel_key` sees one vocabulary rather than two.
 */
export function depositReminderCancelKey(vehicleRequestId: string): string {
  return `deposit_reminder:${vehicleRequestId}`;
}

export interface EnrollDepositRemindersInput {
  buyerId: string;
  vehicleRequestId: string;
  firstName: string | null;
  email: string;
  /** Used only to resolve the CRM contact for SMS; never sent to as a raw number. */
  phone?: string | null;
}

export interface EnrollDepositRemindersResult {
  emailsEnqueued: number;
  smsEnqueued: number;
  /** Set when SMS could not be enqueued at all, with the reason. */
  smsSkippedReason?: string;
}

/**
 * Enrol a buyer's $99 series for ONE Vehicle Request.
 *
 * Idempotent per touch and channel: each row's dedup key names the template, the
 * channel and the request, so a buyer who returns to checkout and re-creates their
 * intent adds no rows and resurrects none that already sent.
 *
 * BOTH CHANNELS, because the rail it replaces sent both and a capability may not
 * quietly disappear. One outbox row carries one channel, so a touch is two rows
 * sharing a cancel key. When no CRM contact resolves, the SMS half is skipped and the
 * reason is RETURNED rather than logged and swallowed — an SMS series that silently
 * became an email series is exactly the kind of quiet loss this rule exists for.
 */
export async function enrollDepositReminders(
  input: EnrollDepositRemindersInput,
  db: Db = prisma,
): Promise<EnrollDepositRemindersResult> {
  const firstName = input.firstName?.trim() || "there";
  const cancelKey = depositReminderCancelKey(input.vehicleRequestId);
  const base = Date.now();

  // DYNAMIC, and for the same reason the Stripe webhook imports the touch drain this
  // way: the module that owns the copy pulls the Resend and Twilio SDKs through
  // `lib/qstash/notify`, and this service is reached from the checkout route.
  const { DEPOSIT_REMINDER_RENDERERS } = await import(
    "@/lib/services/crm/lifecycle-touch-drain.service"
  );

  // The CRM contact is what `deliverSms` requires — its TCPA gate reads consent and
  // do-not-contact from that row and refuses without one. Resolved once, here, rather
  // than per touch.
  let contactId: string | null = null;
  let smsSkippedReason: string | undefined;
  try {
    const { resolveDispatchContact } = await import("@/lib/crm/resolve-contact");
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const contact = await resolveDispatchContact(getServiceSupabase(), {
      email: input.email,
      ...(input.phone ? { phone: input.phone } : {}),
    });
    contactId = contact?.id ?? null;
    if (!contactId) smsSkippedReason = "no CRM contact linked to this buyer";
  } catch (err) {
    smsSkippedReason = "contact resolution failed";
    logger.error(`[deposit-reminder] contact resolution failed for buyer ${input.buyerId}:`, err);
  }

  let emailsEnqueued = 0;
  let smsEnqueued = 0;

  for (const touch of DEPOSIT_REMINDER_TOUCHES) {
    const content = DEPOSIT_REMINDER_RENDERERS[touch.index]({
      entityId: input.buyerId,
      firstName,
      email: input.email,
    });
    const runAt = new Date(base + touch.delayMs);

    const email = await enqueueTransactional(
      {
        triggerEvent: touch.trigger,
        templateKey: touch.template,
        channel: "email",
        recipientKind: "buyer",
        recipientId: input.buyerId,
        to: input.email,
        vehicleRequestId: input.vehicleRequestId,
        idempotencyKey: `${touch.template}:email:${input.vehicleRequestId}`,
        cancelKey,
        runAt,
        payload: {
          email: input.email,
          firstName,
          type: "transactional",
          idempotencyKey: `${touch.template}:email:${input.vehicleRequestId}`,
          subject: content.emailSubject,
          html: content.emailHtml,
        },
      },
      db,
    );
    if (email.enqueued) emailsEnqueued += 1;

    if (!contactId) continue;

    const sms = await enqueueTransactional(
      {
        triggerEvent: touch.trigger,
        templateKey: touch.template,
        channel: "sms",
        recipientKind: "buyer",
        recipientId: input.buyerId,
        to: input.phone ?? null,
        vehicleRequestId: input.vehicleRequestId,
        idempotencyKey: `${touch.template}:sms:${input.vehicleRequestId}`,
        cancelKey,
        runAt,
        payload: {
          contactId,
          phone: input.phone ?? null,
          body: content.sms,
        },
      },
      db,
    );
    if (sms.enqueued) smsEnqueued += 1;
  }

  return { emailsEnqueued, smsEnqueued, ...(smsSkippedReason ? { smsSkippedReason } : {}) };
}
