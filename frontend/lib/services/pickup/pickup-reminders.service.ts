// §Stage 17's APPOINTMENT reminders — at 24 hours and at 2 hours — and the missed-pickup path.
//
// WHAT WAS THERE BEFORE, AND WHY IT IS NOT THIS. The document says so itself: "The existing job
// chases proposal responses, not appointment reminders." `pickup-sla.service.ts` nudges a
// dealership that has not answered a proposal and a buyer who has not answered a counter — both
// about a time that is not yet agreed. These fire once a time IS agreed, and they carry
// completely different content: what to bring, not what to answer.
//
// THE SEVEN THINGS EACH REMINDER CARRIES are §Stage 17's list, verbatim and in its order: time
// and location; required government identification for buyer and co-buyer; insurance reminder;
// down-payment or funding instructions and accepted methods; trade instructions including title,
// keys and payoff documents; release-token instructions; and the rescheduling contact. The count
// is asserted in `pickup-reminders.test.ts` against this list, because a reminder that quietly
// drops "bring the trade title" is a wasted trip for a buyer and an empty bay for a dealership.
//
// WHAT THE REMINDER DOES NOT CARRY IS THE CODE ITSELF. The raw release token is returned ONCE by
// `issueReleaseToken` and is never stored, so this job could not include it even if it should —
// and it should not: an email is forwarded, quoted and left open on a screen. §Stage 17 asks for
// "release-token instructions", and the instruction is where to get the code from a logged-in
// session at the dealership.
//
// THE MARKERS ARE THE IDEMPOTENCY, and they already existed. `reminder_24h_sent_at` and
// `reminder_2h_sent_at` arrived with the Phase 1 wave and had never had a writer. They are
// cleared on a reschedule by the coordination service, which is what re-arms both reminders for
// the new appointment — a buyer whose Tuesday handover moves to Friday must be reminded about
// Friday.
//
// A LATE RUN STILL SENDS, and that is deliberate. The windows are "less than 24 hours away" and
// "less than 2 hours away", not "between 23 and 24 hours away": an hourly cron that misses a run
// would otherwise skip the reminder entirely, and a reminder that arrives at 21 hours is worth
// far more than none. The 2h reminder is not sent for an appointment already in the past.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { PICKUP_REMINDER_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { revokeReleaseToken } from "./release-token.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const BATCH_LIMIT = 200;

export const REMINDER_LEAD_HOURS = { first: 24, second: 2 } as const;

/**
 * How long after a scheduled appointment with no release recorded before it is treated as
 * possibly missed.
 *
 * FOUR HOURS, AND IT IS A SUSPICION RATHER THAN A FINDING. Handovers run late — paperwork, a
 * delayed valet, a queue — so a pickup still unreleased an hour after its slot is ordinary. What
 * this margin buys is the difference between "running late" and "nobody came", and only a human
 * can tell which, which is why the sweep raises an exception instead of deciding.
 */
export const NO_SHOW_GRACE_HOURS = 4;

export interface ReminderSweepResult {
  reminded24h: number;
  reminded2h: number;
  noShowsFlagged: number;
  failed: number;
}

/** §Stage 17's seven-part reminder body. Exported so the test can assert all seven are present. */
export function renderAppointmentReminder(params: {
  buyerFirstName: string | null;
  scheduledAt: Date | null;
  location: string | null;
  dealershipName: string;
  hasCoBuyer: boolean;
  hasTrade: boolean;
  downPaymentMethod: string | null;
  dealId: string;
}): { subject: string; html: string } {
  const when = params.scheduledAt
    ? params.scheduledAt.toUTCString()
    : "the time confirmed with the dealership";
  const where = params.location ?? params.dealershipName;

  const identity = params.hasCoBuyer
    ? "Government-issued photo identification for BOTH you and your co-buyer. Both of you must attend."
    : "Your government-issued photo identification.";

  const funding = params.downPaymentMethod
    ? `Your down payment by ${params.downPaymentMethod.replace(/_/g, " ").toLowerCase()}. ` +
      "The dealership collects it directly — AutoLenis never takes a down payment."
    : "Your down payment, by a method the dealership accepts. Confirm the method with them before " +
      "you travel. The dealership collects it directly — AutoLenis never takes a down payment.";

  const trade = params.hasTrade
    ? "Your trade-in: the title, BOTH sets of keys, and the payoff letter. A missing title or an " +
      "expired payoff quote stops the handover."
    : null;

  const items = [
    `<li><strong>When and where.</strong> ${when}, at ${where}.</li>`,
    `<li><strong>Identification.</strong> ${identity}</li>`,
    `<li><strong>Insurance.</strong> Your policy must be active on this vehicle before it can be ` +
      `released. If it is not verified yet, upload proof now.</li>`,
    `<li><strong>Funding.</strong> ${funding}</li>`,
    ...(trade ? [`<li><strong>Trade-in.</strong> ${trade}</li>`] : []),
    `<li><strong>Your release code.</strong> Open your pickup page on your phone when you arrive ` +
      `and show the code to the dealership. It is single-use and expires with the appointment — ` +
      `we do not send it by email, and nobody from AutoLenis or the dealership will ask you for ` +
      `it over the phone.</li>`,
    `<li><strong>Need to change the time?</strong> Reschedule from your pickup page, or reply to ` +
      `this email. Changing the time issues a new code and retires the old one.</li>`,
  ];

  return {
    subject: `Your vehicle pickup — what to bring`,
    html:
      `<p>Hi ${params.buyerFirstName ?? "there"},</p>` +
      `<p>Here is everything you need for your pickup at ${params.dealershipName}.</p>` +
      `<ul>${items.join("")}</ul>` +
      `<p><a href="${APP_URL}/buyer/pickup">Open your pickup page</a></p>`,
  };
}

/**
 * THE SEVEN ITEMS, as keys, so the count is a fact rather than a promise.
 *
 * A trade line is absent on a deal with no trade, which is correct and is also exactly how a
 * seven-item list quietly becomes a six-item one for everybody. The test renders BOTH shapes.
 */
export const REMINDER_ITEM_KEYS = [
  "when_and_where",
  "identification",
  "insurance",
  "funding",
  "trade",
  "release_code",
  "rescheduling",
] as const;

export const STAGE_17_REMINDER_ITEM_COUNT = 7;

type ReminderLeg = "first" | "second";

const TEMPLATE_FOR: Record<ReminderLeg, string> = {
  first: PICKUP_REMINDER_TEMPLATES.APPOINTMENT_24H,
  second: PICKUP_REMINDER_TEMPLATES.APPOINTMENT_2H,
};
const MARKER_FOR: Record<ReminderLeg, "reminder24hSentAt" | "reminder2hSentAt"> = {
  first: "reminder24hSentAt",
  second: "reminder2hSentAt",
};

async function sendLeg(leg: ReminderLeg, now: Date): Promise<{ sent: number; failed: number }> {
  const marker = MARKER_FOR[leg];
  const horizon = new Date(now.getTime() + REMINDER_LEAD_HOURS[leg] * 3600_000);

  const due = await prisma.pickup.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { not: null, lte: horizon, ...(leg === "second" ? { gt: now } : {}) },
      [marker]: null,
      deal: { status: "PICKUP_SCHEDULED" },
    },
    take: BATCH_LIMIT,
    select: {
      dealId: true,
      scheduledAt: true,
      location: true,
      deal: {
        select: {
          id: true,
          buyerId: true,
          coBuyerId: true,
          buyer: { select: { firstName: true, user: { select: { email: true } } } },
          offer: { select: { dealer: { select: { dealershipName: true } } } },
          financing: { select: { downPaymentMethod: true } },
          tradeInSubmissions: { select: { id: true }, take: 1 },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  for (const p of due) {
    const email = p.deal?.buyer?.user?.email ?? null;
    try {
      // STAMP FIRST. A crash after the stamp costs one reminder; a crash after sending but
      // before stamping re-sends on the next run, and on every run after that.
      const swap = await prisma.pickup.updateMany({
        where: { dealId: p.dealId, [marker]: null },
        data: { [marker]: now },
      });
      if (swap.count === 0) continue;

      if (!email) {
        // A scheduled handover the buyer cannot be reminded about is an Operations problem, not
        // a row to skip quietly.
        await raiseException({
          code: "COMMS_NO_DELIVERABLE_CHANNEL",
          dealId: p.dealId,
          buyerId: p.deal?.buyerId ?? null,
          idempotencyKey: `COMMS_NO_DELIVERABLE_CHANNEL:pickup-reminder:${p.dealId}:${leg}`,
          detail: `The ${REMINDER_LEAD_HOURS[leg]}-hour pickup reminder has no buyer email address.`,
        });
        continue;
      }

      const body = renderAppointmentReminder({
        buyerFirstName: p.deal?.buyer?.firstName ?? null,
        scheduledAt: p.scheduledAt,
        location: p.location,
        dealershipName: p.deal?.offer?.dealer?.dealershipName ?? "the dealership",
        hasCoBuyer: Boolean(p.deal?.coBuyerId),
        hasTrade: (p.deal?.tradeInSubmissions.length ?? 0) > 0,
        downPaymentMethod: p.deal?.financing?.downPaymentMethod ?? null,
        dealId: p.dealId,
      });

      await enqueueTransactional({
        triggerEvent: "pickup_appointment_reminder",
        templateKey: TEMPLATE_FOR[leg],
        channel: "email",
        recipientKind: "buyer",
        recipientId: p.deal?.buyerId ?? null,
        to: email,
        dealId: p.dealId,
        // Per LEG and per APPOINTMENT. The marker is cleared on a reschedule, so the key has to
        // change too or the new appointment's reminder is suppressed as a duplicate of the old.
        idempotencyKey: `${TEMPLATE_FOR[leg]}:${p.dealId}:${p.scheduledAt?.toISOString() ?? "unscheduled"}`,
        payload: { email, type: "transactional", subject: body.subject, html: body.html },
      });
      sent += 1;
    } catch (e) {
      failed += 1;
      logger.error(`[pickup-reminders] ${leg} reminder failed deal=${p.dealId}:`, e);
    }
  }
  return { sent, failed };
}

/**
 * §Stage 17's reminders and the missed-pickup suspicion, in one pass.
 *
 * Folded into the hourly `pickup-confirmation-nudge` cron rather than given a job of its own —
 * the same choice `dealer-invitation-reminder` made for its token-expiry sweep, and for the same
 * reason: the subject is identical (a pickup appointment) and a second scheduled entry is a
 * second thing that can silently stop running.
 */
export async function sweepAppointmentReminders(now: Date = new Date()): Promise<ReminderSweepResult> {
  const first = await sendLeg("first", now);
  const second = await sendLeg("second", now);
  const noShow = await flagSuspectedNoShows(now);

  return {
    reminded24h: first.sent,
    reminded2h: second.sent,
    noShowsFlagged: noShow.flagged,
    failed: first.failed + second.failed + noShow.failed,
  };
}

/**
 * §Stage 17: "A missed pickup returns to scheduling with a new proposal round and revoked token."
 *
 * THE SWEEP DOES NOT DECIDE THAT ANYTHING WAS MISSED, and that restraint is the whole design.
 * AutoLenis is not at the dealership. An appointment that has passed with no release recorded is
 * consistent with a no-show by either party, a handover in progress, a dealership that forgot to
 * scan, and a buyer who arrived to find the car gone. Those have different remedies and only one
 * of them registers on a dealership's scorecard — §Stage 17 says "where the dealership is at
 * fault", and fault is not observable from this table. So the sweep raises PICKUP_MISSED for a
 * human and `recordPickupNoShow` does the returning, once somebody knows who did not appear.
 */
export async function flagSuspectedNoShows(now: Date = new Date()): Promise<{ flagged: number; failed: number }> {
  const cutoff = new Date(now.getTime() - NO_SHOW_GRACE_HOURS * 3600_000);

  const stale = await prisma.pickup.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { not: null, lt: cutoff },
      dealerReleasedAt: null,
      noShowAt: null,
      deal: { status: "PICKUP_SCHEDULED" },
    },
    take: BATCH_LIMIT,
    select: {
      dealId: true,
      scheduledAt: true,
      deal: { select: { buyerId: true, dealerId: true, offer: { select: { dealerId: true } } } },
    },
  });

  let flagged = 0;
  let failed = 0;
  for (const p of stale) {
    try {
      await raiseException({
        code: "PICKUP_MISSED",
        dealId: p.dealId,
        buyerId: p.deal?.buyerId ?? null,
        dealerId: p.deal?.dealerId ?? p.deal?.offer?.dealerId ?? null,
        // Per APPOINTMENT. A deal that misses a second, rescheduled pickup is a second exception
        // — which is also what makes "repeated no-shows" countable.
        idempotencyKey: `PICKUP_MISSED:${p.dealId}:${p.scheduledAt?.toISOString() ?? "unscheduled"}`,
        detail:
          `The appointment at ${p.scheduledAt?.toISOString() ?? "an unrecorded time"} passed with no ` +
          `release recorded. Establish which party did not appear before returning the deal to ` +
          `scheduling — fault decides whether this registers on the dealership scorecard.`,
      });
      flagged += 1;
    } catch (e) {
      failed += 1;
      logger.error(`[pickup-reminders] no-show flag failed deal=${p.dealId}:`, e);
    }
  }
  return { flagged, failed };
}

export type NoShowParty = "BUYER" | "DEALERSHIP" | "BOTH" | "UNDETERMINED";

/**
 * Record a missed pickup once fault is known, and return the deal to scheduling.
 *
 * REVOKE RATHER THAN CONSUME, as everywhere else in this phase: the code was never presented, so
 * "consumed" would claim a handover that did not happen. §Stage 17: "revoked token", and a new
 * one is minted when the new appointment is confirmed.
 *
 * THE DEAL'S STATUS IS NOT CHANGED HERE. `PICKUP_SCHEDULED` is where a deal awaiting a pickup
 * lives, and a new proposal round happens on the PICKUP row — `schedulePickup` and the
 * coordination service own that transition, and duplicating it here would make a second writer
 * of the scheduling state machine, which is the defect this phase spent its first half removing.
 *
 * AND THE PICKUP GOES TO `NOT_SCHEDULED`, NOT TO `NO_SHOW`, WHICH IS A CHOICE WORTH DEFENDING.
 * `PickupStatus.NO_SHOW` exists — Phase 1 added it and nothing has ever written it. Using it here
 * would read naturally and be wrong twice over. §Stage 17 says a missed pickup "RETURNS TO
 * SCHEDULING", and `status` is the field that answers "where is this pickup in the scheduling
 * flow?"; the answer after a no-show is "nowhere, it needs a new time", which is exactly
 * NOT_SCHEDULED. A NO_SHOW status would also strand the row outside every branch of
 * `/buyer/pickup`, whose "propose a time" form keys on NOT_SCHEDULED — the buyer would be left
 * on a blank page, unable to rebook the handover the document says they return to.
 *
 * What happened is recorded where what-happened belongs: `no_show_at` and `no_show_party`, which
 * survive the next round and are what a human reads. The unused enum label is REPORTED rather
 * than removed — it is not this phase's to delete.
 */
export async function recordPickupNoShow(
  dealId: string,
  party: NoShowParty,
  actor: { id: string; role: string },
  now: Date = new Date(),
): Promise<{ ok: true; returnedToScheduling: boolean } | { ok: false; reason: "pickup_missing" | "already_released" }> {
  const pickup = await prisma.pickup.findUnique({
    where: { dealId },
    select: { id: true, status: true, dealerReleasedAt: true, scheduledAt: true },
  });
  if (!pickup) return { ok: false, reason: "pickup_missing" };
  if (pickup.dealerReleasedAt) return { ok: false, reason: "already_released" };

  await revokeReleaseToken(dealId, now);

  const swap = await prisma.pickup.updateMany({
    where: { dealId, status: "SCHEDULED" },
    data: {
      status: "NOT_SCHEDULED",
      noShowAt: now,
      noShowParty: party,
      scheduledAt: null,
      // The new round starts clean: both reminder markers and the turn-taking markers are
      // cleared, or the rescheduled appointment inherits "already reminded" from the one nobody
      // attended.
      reminder24hSentAt: null,
      reminder2hSentAt: null,
      proposedReminderSentAt: null,
      counterReminderSentAt: null,
    },
  });

  logger.info(`[pickup-reminders] no-show recorded deal=${dealId} party=${party} by=${actor.role}:${actor.id}`);
  return { ok: true, returnedToScheduling: swap.count === 1 };
}
