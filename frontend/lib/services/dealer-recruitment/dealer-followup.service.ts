// AutoLenis Phase 4B-4 — Dealer follow-up sequencing service.
//
// Drives the multi-touch outreach cadence after the Phase 4B-3 initial email:
//   Day 0  — initial outreach           (step 1, sent elsewhere)
//   Day 3  — follow-up 1 (value-add)    (step 2)
//   Day 8  — follow-up 2 (final check)  (step 3)
//   Day 9+ — sequence ends
//
// A sequence stops early the moment a dealer replies, bounces, or opts out
// (see pauseSequence + the Resend webhook). Sends reuse the Phase 4B-3
// dealer-email-send service so suppression, rate limiting, and logging are
// shared with the initial touch.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma"
import { sendDealerEmail } from "./dealer-email-send.service"
import {
  generateFollowUp1Template,
  generateFollowUp2Template,
} from "./email-template.service"
import { buildUnsubscribeUrl } from "./unsubscribe-token.service"

// Cadence (days). FOLLOWUP_1 fires 3 days after the initial; FOLLOWUP_2 fires
// 5 days after follow-up 1 (≈ day 8 overall).
const FOLLOWUP_1_DELAY_DAYS = 3
const FOLLOWUP_2_DELAY_DAYS = 5
const MAX_SEQUENCE_STEP = 3

// Log statuses that count as a successful prior send for sequencing purposes.
const SENT_STATUSES = ["sent", "delivered", "replied"] as const

export type SequencePauseReason = "bounced" | "opted_out" | "replied" | "manual"

export interface DueDealer {
  id: string
  name: string
  nextStep: number // 2 or 3
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Find dealer prospects due for their next follow-up touch.
 *
 * A prospect is due when:
 *   - status is CONTACTED (initial email already sent)
 *   - no reply detected and the sequence is not paused
 *   - their latest successful send is old enough for the next step
 *   - they have not already received follow-up 2 (step 3)
 */
export async function findDealersDueForFollowup(): Promise<DueDealer[]> {
  const prospects = await prisma.dealerProspect.findMany({
    where: {
      status: "CONTACTED",
      replyDetectedAt: null,
      sequencePausedAt: null,
      email: { not: null },
    },
    select: {
      id: true,
      name: true,
      outreachLog: {
        where: { channel: "email", status: { in: [...SENT_STATUSES] } },
        orderBy: { sentAt: "desc" },
        select: { outreachSequenceStep: true, sentAt: true },
      },
    },
  })

  const due: DueDealer[] = []
  const now = Date.now()

  for (const p of prospects) {
    const logs = p.outreachLog
    if (logs.length === 0) continue // no initial send recorded

    const lastStep = logs.reduce(
      (max, l) => Math.max(max, l.outreachSequenceStep ?? 1),
      1,
    )
    if (lastStep >= MAX_SEQUENCE_STEP) continue // follow-up 2 already sent

    // logs are ordered newest-first, so logs[0] is the most recent send.
    const lastSentAt = logs[0].sentAt
    const ageDays = (now - lastSentAt.getTime()) / MS_PER_DAY

    const thresholdDays =
      lastStep === 1 ? FOLLOWUP_1_DELAY_DAYS : FOLLOWUP_2_DELAY_DAYS
    if (ageDays < thresholdDays) continue

    due.push({ id: p.id, name: p.name, nextStep: lastStep + 1 })
  }

  return due
}

// Best-effort count of verified buyers near the dealer to reference in the
// value-add follow-up. Returns 0 when unknown (template phrases gracefully).
async function countAreaBuyers(zip: string | null): Promise<number> {
  if (!zip) return 0
  const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY)
  try {
    return await prisma.buyerOpportunity.count({
      where: { zip, createdAt: { gte: thirtyDaysAgo } },
    })
  } catch {
    return 0
  }
}

/**
 * Send the next follow-up email for a prospect. Determines the step from prior
 * sends, builds the appropriate template, and dispatches via the shared send
 * service (which enforces suppression + rate limits). No-op-safe: if the
 * prospect is already past the sequence it simply does nothing.
 */
export async function sendFollowUp(dealerProspectId: string): Promise<void> {
  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: dealerProspectId },
    select: {
      id: true,
      name: true,
      contactName: true,
      city: true,
      state: true,
      zip: true,
      email: true,
      replyDetectedAt: true,
      sequencePausedAt: true,
      outreachLog: {
        where: { channel: "email", status: { in: [...SENT_STATUSES] } },
        orderBy: { sentAt: "asc" },
        select: { outreachSequenceStep: true, sentAt: true },
      },
    },
  })

  if (!prospect) {
    logger.warn(`[phase-4b4] sendFollowUp: prospect ${dealerProspectId} not found`)
    return
  }
  if (!prospect.email) return
  if (prospect.replyDetectedAt || prospect.sequencePausedAt) {
    logger.info(`[phase-4b4] Skipping ${prospect.name} — sequence paused/replied`)
    return
  }
  if (prospect.outreachLog.length === 0) {
    logger.warn(`[phase-4b4] sendFollowUp: ${prospect.name} has no prior send`)
    return
  }

  const lastStep = prospect.outreachLog.reduce(
    (max, l) => Math.max(max, l.outreachSequenceStep ?? 1),
    1,
  )
  if (lastStep >= MAX_SEQUENCE_STEP) {
    logger.info(`[phase-4b4] ${prospect.name} already at step ${lastStep} — done`)
    return
  }

  const nextStep = lastStep + 1
  const initialSentAt = prospect.outreachLog[0].sentAt // oldest (asc)
  const daysAgo = Math.max(
    1,
    Math.round((Date.now() - initialSentAt.getTime()) / MS_PER_DAY),
  )
  const buyerCount = await countAreaBuyers(prospect.zip)

  const templateInput = {
    dealerName: prospect.name,
    contactName: prospect.contactName,
    city: prospect.city ?? "",
    state: prospect.state ?? "",
    buyerCount,
    daysAgo,
  }
  const opts = { dealerEmail: prospect.email, unsubscribeUrl: buildUnsubscribeUrl(prospect.email) }

  const template =
    nextStep === 2
      ? generateFollowUp1Template(templateInput, opts)
      : generateFollowUp2Template(templateInput, opts)

  const outreachType = nextStep === 2 ? "followup_1" : "followup_2"

  const result = await sendDealerEmail({
    dealerProspectId: prospect.id,
    outreachType,
    prebuiltTemplate: template,
    sequenceStep: nextStep,
  })

  if (result.success) {
    logger.info(
      `[phase-4b4] Follow-up sent to ${prospect.name} (step ${nextStep}, resend ${result.resendId})`,
    )
  } else {
    logger.warn(
      `[phase-4b4] Follow-up send failed for ${prospect.name} (step ${nextStep}): ${result.error}`,
    )
    // Re-throw so the cron counts it as a failure for observability.
    throw new Error(result.error ?? "Follow-up send failed")
  }
}

/**
 * Stop the follow-up cadence for a prospect. Idempotent — re-pausing keeps the
 * original pause unless a stronger reason ('replied') is supplied.
 */
export async function pauseSequence(
  dealerProspectId: string,
  reason: SequencePauseReason,
): Promise<void> {
  const now = new Date()
  await prisma.dealerProspect.update({
    where: { id: dealerProspectId },
    data: {
      sequencePausedAt: now,
      sequencePauseReason: reason,
      // A reply both pauses the sequence and records the reply timestamp.
      ...(reason === "replied" ? { replyDetectedAt: now } : {}),
    },
  })
  logger.info(`[phase-4b4] Sequence paused for ${dealerProspectId} (${reason})`)
}
