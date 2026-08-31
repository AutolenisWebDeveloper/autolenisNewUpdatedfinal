// AutoLenis Phase 4B-3 — Dealer outreach email send service.
//
// Sends a personalized, CAN-SPAM-compliant outreach email to a dealer prospect
// via Resend, recording every attempt in dealer_outreach_log. Enforces:
//   - Suppression: never email a bounced / complained / unsubscribed address
//   - Rate limits: max 50 sends/hour, 200/day (platform-wide for this channel)
//
// Reuses the project's lazy-Resend pattern so `next build` never throws when the
// API key isn't in scope.

import { logger } from "@/lib/logger";
import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import { getServiceSupabase } from "@/lib/supabase-service"
import { SuppressionService } from "@/lib/services/suppression.service"
import { verifyEmailDeliverability } from "@/lib/services/integrations/email-deliverability.service"
import {
  generateEmailTemplate,
  type EmailTemplate,
} from "./email-template.service"
import { issueProspectClaimToken, buildClaimUrl } from "./prospect-claim.service"
import { buildUnsubscribeUrl } from "./unsubscribe-token.service"

export type OutreachType = "initial" | "followup_1" | "followup_2"

export interface SendDealerEmailInput {
  dealerProspectId: string
  outreachType?: OutreachType
  // Optional: override the generated email (founder-edited send).
  customSubject?: string
  customBody?: string
  // Phase 4B-4: a fully-built template (subject + HTML + text, including footer).
  // Takes precedence over customSubject/customBody and the generator. Used by the
  // follow-up service so the CAN-SPAM footer is preserved on every touch.
  prebuiltTemplate?: EmailTemplate
  // Phase 4B-4: which step of the sequence this send represents (1/2/3). When
  // omitted it is inferred from outreachType.
  sequenceStep?: number
}

// Map an outreach type onto its sequence step (initial = 1, followups = 2/3).
function stepForOutreachType(type: OutreachType): number {
  if (type === "followup_1") return 2
  if (type === "followup_2") return 3
  return 1
}

// Machine-readable failure category so callers can act on WHY a send didn't land
// without string-matching the human `error`. Distinguishes a TRANSIENT throttle
// (rate_limited — clears on its own) and PERMANENT per-dealer states (suppressed /
// undeliverable — retrying is futile) from a genuine execution error (send_error /
// not_configured). Used by post-intake-outreach to decide defer vs complete vs fail.
export type SendDealerEmailReason =
  | "not_found"
  | "no_email"
  | "already_contacted"
  | "suppressed"
  | "undeliverable"
  | "rate_limited"
  | "not_configured"
  | "send_error"

export interface SendDealerEmailResult {
  success: boolean
  resendId?: string
  error?: string
  reason?: SendDealerEmailReason
  outreachLogId?: string
}

// What the provider is asked to dispatch. Everything the send path knows about
// the outbound message, so a fake can assert on it without reconstructing state.
export interface DealerEmailDispatchPayload {
  to: string
  from: string
  replyTo: string
  subject: string
  html: string
  text: string
  unsubscribeUrl: string | null
  outreachType: OutreachType
  prospectId: string
}

// A normalized dispatch outcome. `id` is the provider message id on success;
// `error` is a human message on failure. Exactly one is non-null.
//
// `notConfigured` distinguishes "the channel has no usable credential" from "the
// provider rejected this message". post-intake-outreach DEFERS the former and
// counts the latter as a genuine failure against a bounded retry budget, so the
// distinction must be carried structurally. Matching on the error text would make
// a control-flow decision hostage to a vendor's wording.
export interface DealerEmailDispatchResult {
  id: string | null
  error: string | null
  notConfigured?: boolean
}

// The provider seam.
//
// This exists because the `resend` package CANNOT be mocked in this suite: the
// service is transformed to CJS, and `require()` bypasses node:test's ESM module
// mocking. A test that registers mock.module("resend", ...) sees its spy record
// zero calls while the service reaches the LIVE Resend API with a real recipient
// address — the mock fails to apply silently, which is indistinguishable from a
// mock that applied. Injecting the dispatch keeps the suite off the network by
// construction rather than by convention, and follows the same injectable-deps
// pattern as apollo.service (ApolloClient), apollo-reveal (RevealDeps), and
// contact-resolution (ContactResolutionDeps).
export interface SendDealerEmailDeps {
  dispatch: (payload: DealerEmailDispatchPayload) => Promise<DealerEmailDispatchResult>
}

const MAX_PER_HOUR = 50
const MAX_PER_DAY = 200
const FROM_NAME = process.env.FROM_NAME ?? "Markist Athelus"

// Phase 4B-2 — the required-env checks now live in a server-only-free module so
// coverage.service (and tests) can read them without pulling in this file's
// Supabase/`server-only` imports. Re-exported here for existing importers.
export {
  REQUIRED_EMAIL_ENV_VARS,
  missingEmailEnvVars,
  assertEmailEnvVars,
} from "./email-channel-config"
import { missingEmailEnvVars } from "./email-channel-config"

let resendInstance: Resend | null = null
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || apiKey.includes("placeholder")) return null
  if (!resendInstance) resendInstance = new Resend(apiKey)
  return resendInstance
}

// The address used when DEALER_OUTREACH_FROM_EMAIL is unset. Named so the log row
// and the envelope From can never drift apart.
const DEFAULT_FROM_EMAIL = "dealers@autolenis.com"

function fromAddress(): string {
  const email = process.env.DEALER_OUTREACH_FROM_EMAIL ?? DEFAULT_FROM_EMAIL
  return `${FROM_NAME} <${email}>`
}

// Platform-wide rate limit for the dealer email channel. Returns true if a send
// is allowed right now.
async function checkRateLimit(): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [hourCount, dayCount] = await Promise.all([
    prisma.dealerOutreachLog.count({
      where: {
        channel: "email",
        status: { in: ["sent", "delivered"] },
        sentAt: { gte: oneHourAgo },
      },
    }),
    prisma.dealerOutreachLog.count({
      where: {
        channel: "email",
        status: { in: ["sent", "delivered"] },
        sentAt: { gte: oneDayAgo },
      },
    }),
  ])

  if (hourCount >= MAX_PER_HOUR) {
    logger.warn(`[phase-4b3] Hourly rate limit hit: ${hourCount}/${MAX_PER_HOUR}`)
    return false
  }
  if (dayCount >= MAX_PER_DAY) {
    logger.warn(`[phase-4b3] Daily rate limit hit: ${dayCount}/${MAX_PER_DAY}`)
    return false
  }
  return true
}

// Suppression check. Fails CLOSED: if the check cannot run (Supabase client
// can't be constructed, lookup error), treat the address as suppressed and skip
// the send rather than risk emailing a bounced/complained/unsubscribed address
// during an outage. This mirrors the SMS/TCPA path (twilio.service) and keeps
// cold sending CAN-SPAM-safe — availability yields to compliance.
async function isSuppressed(email: string): Promise<boolean> {
  try {
    const supabase = getServiceSupabase()
    return await SuppressionService.isEmailSuppressed(supabase, email)
  } catch (err) {
    logger.warn(
      `[phase-4b3] Suppression check failed (failing closed — skipping send): ${err instanceof Error ? err.message : String(err)}`,
    )
    return true
  }
}

/**
 * Build (but do not send) the outreach email for a prospect. Used by the
 * preview route and by sendDealerEmail.
 */
export async function previewDealerEmail(
  dealerProspectId: string,
): Promise<{ subject: string; body: string; bodyText: string; toEmail: string | null } | null> {
  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: dealerProspectId },
    select: {
      name: true,
      contactName: true,
      contactTitle: true,
      city: true,
      state: true,
      email: true,
    },
  })
  if (!prospect) return null

  const template = await generateEmailTemplate(
    {
      dealerName: prospect.name,
      contactName: prospect.contactName,
      contactTitle: prospect.contactTitle,
      city: prospect.city ?? "",
      state: prospect.state ?? "",
    },
    { dealerEmail: prospect.email ?? "this dealership" },
  )

  return { ...template, toEmail: prospect.email }
}

/**
 * Default dispatch — the live Resend call. Returns a normalized result instead of
 * throwing, so the caller treats a transport failure and a provider-reported
 * failure identically (both must land as ONE failed log row).
 */
async function defaultDispatch(
  payload: DealerEmailDispatchPayload,
): Promise<DealerEmailDispatchResult> {
  const resend = getResend()
  if (!resend) return { id: null, error: "RESEND_API_KEY not configured", notConfigured: true }
  try {
    const result = await resend.emails.send({
      from: payload.from,
      to: payload.to,
      replyTo: payload.replyTo,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      // RFC 8058 one-click unsubscribe headers so Gmail/Yahoo render a native
      // "Unsubscribe" control and a reply-mailto fallback is always present.
      headers: payload.unsubscribeUrl
        ? {
            "List-Unsubscribe": `<mailto:${payload.replyTo}?subject=unsubscribe>, <${payload.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : { "List-Unsubscribe": `<mailto:${payload.replyTo}?subject=unsubscribe>` },
      tags: [
        { name: "outreach_type", value: payload.outreachType },
        { name: "dealer_id", value: payload.prospectId },
      ],
    })
    // The Resend SDK surfaces HTTP errors via result.error rather than throwing.
    if (result.error || !result.data?.id) {
      return { id: null, error: result.error?.message ?? "Resend returned no message id" }
    }
    return { id: result.data.id, error: null }
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Send one dealer outreach email.
 *
 * PHASE 2 INVARIANT — every ATTEMPT leaves exactly one dealer_outreach_log row.
 *
 * Previously the log row was created at the END of this function, after seven
 * early returns. Six of those are real attempts rejected by a gate, and they
 * left no row at all: the only trace was a `logger.warn` and a structured result
 * handed back to the caller. The observable consequence was an empty
 * dealer_outreach_log, which reads as "outreach was never attempted" when the
 * truth is "outreach was attempted and blocked" — the two states were
 * indistinguishable, which is precisely why a configuration gap could sit
 * unnoticed. Every rejection now records the gate that produced it.
 *
 * Two outcomes deliberately write no NEW row, and both are load-bearing:
 *   - `not_found`         — dealer_prospect_id is a required FK to
 *                           dealer_prospects; a row for a nonexistent prospect
 *                           cannot be written at all.
 *   - `already_contacted` — a second row would break the one-row-per
 *                           (prospect, step, channel) idempotency guarantee, so
 *                           the EXISTING row's id is returned instead.
 *
 * Gate rejections are written in their terminal state by a single INSERT rather
 * than queued-then-updated. A queued-then-updated rejection would leave a
 * permanently `queued` row if the process died between the two statements, and
 * because the idempotency check treats `queued` as a live send, that row would
 * block every future retry of the step. The queued state is kept only for the
 * real dispatch, where "queued" is true while the request is in flight.
 */
export async function sendDealerEmail(
  input: SendDealerEmailInput,
  deps?: Partial<SendDealerEmailDeps>,
): Promise<SendDealerEmailResult> {
  const dispatch = deps?.dispatch ?? defaultDispatch
  const outreachType: OutreachType = input.outreachType ?? "initial"
  const sequenceStep = input.sequenceStep ?? stepForOutreachType(outreachType)
  // Read WITHOUT the send-time fallback. A rejection row must not claim a from
  // address that was never configured — on a not_configured rejection nothing was
  // sent, and recording a plausible-looking default would obscure the exact gap
  // the row exists to expose. The fallback still applies to real dispatch, via
  // fromAddress().
  const configuredFrom = process.env.DEALER_OUTREACH_FROM_EMAIL?.trim() || null

  // 1. Load the prospect FIRST. Everything after this point is recorded against
  // it, so a rejection is observable. This is the one gate that must precede the
  // write, because the write needs a valid dealer_prospect_id.
  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: input.dealerProspectId },
    select: {
      id: true,
      name: true,
      contactName: true,
      contactTitle: true,
      city: true,
      state: true,
      email: true,
    },
  })
  if (!prospect) {
    logger.warn(`[phase-4b3] Send blocked — prospect ${input.dealerProspectId} not found`)
    return { success: false, reason: "not_found", error: "Dealer not found" }
  }

  // 2. Idempotency — never send the same outreach step to the same prospect
  // twice. The automatic post-intake path guards externally, but the admin
  // send / send-batch paths and the follow-up cron+manual overlap do not, so a
  // double-click, a prospect appearing in two batches, or the cron and the
  // manual "run follow-ups" firing in the same window would dispatch duplicate
  // cold emails. Short-circuit when a non-failed log for this outreach type
  // already exists. (outreachType maps 1:1 to sequence step, so this also
  // dedupes follow-ups.) A `failed` row does NOT block a retry.
  const priorSend = await prisma.dealerOutreachLog.findFirst({
    where: {
      dealerProspectId: prospect.id,
      outreachType,
      status: { in: ["queued", "sent", "delivered"] },
    },
    select: { id: true },
  })
  if (priorSend) {
    logger.info(
      `[phase-4b3] Skipping duplicate ${outreachType} send for prospect ${prospect.id} (log ${priorSend.id})`,
    )
    return {
      success: false,
      reason: "already_contacted",
      error: "Already contacted for this outreach step",
      outreachLogId: priorSend.id,
    }
  }

  // Record a rejected attempt as one terminal row and return the caller's result.
  const reject = async (
    reason: SendDealerEmailReason,
    error: string,
  ): Promise<SendDealerEmailResult> => {
    logger.warn(`[phase-4b3] Send blocked for prospect ${prospect.id} (${reason}): ${error}`)
    const row = await prisma.dealerOutreachLog.create({
      data: {
        dealerProspectId: prospect.id,
        outreachType,
        channel: "email",
        toEmail: prospect.email,
        fromEmail: configuredFrom,
        status: "failed",
        errorMessage: error,
        outreachSequenceStep: sequenceStep,
      },
    })
    return { success: false, reason, error, outreachLogId: row.id }
  }

  // 3. Gates. Evaluated together so that a gate which THROWS is itself a
  // rejection: an infrastructure error escaping here would return no row and
  // recreate the invisible-failure bug this function exists to prevent.
  let rejection: { reason: SendDealerEmailReason; error: string } | null = null
  try {
    // 3a. Channel configuration (Phase 4B-2). A cold or misconfigured sending
    // domain torches deliverability, and AUTOLENIS_PHYSICAL_ADDRESS is a CAN-SPAM
    // requirement. Classified `not_configured` — the same state as a missing
    // RESEND_API_KEY — so post-intake-outreach DEFERS the outreach stage and
    // retries once the owner wires the channel, instead of burning its bounded
    // retry budget and dead-lettering a fully recoverable intake.
    const missingEnv = missingEmailEnvVars()
    if (missingEnv.length > 0) {
      rejection = {
        reason: "not_configured",
        error: `Email domain not configured — set in Vercel before sending: ${missingEnv.join(", ")}`,
      }
    } else if (!prospect.email) {
      rejection = { reason: "no_email", error: "Dealer has no email" }
    } else if (await isSuppressed(prospect.email)) {
      // 3b. Suppression gate (CAN-SPAM / deliverability).
      rejection = {
        reason: "suppressed",
        error: "Recipient is suppressed (bounced/unsubscribed)",
      }
    } else {
      // 3c. Deliverability gate (Y1) — system-wide "never cold-email an
      // unverified address". Verifies a live MX record regardless of how `email`
      // was populated (Y1 enrichment, admin backfill/re-enrich, manual entry).
      // This is the single send chokepoint, so it also covers pre-existing paths
      // that write emails without an MX check. Fail-closed.
      const deliverability = await verifyEmailDeliverability(prospect.email)
      if (!deliverability.deliverable) {
        rejection = {
          reason: "undeliverable",
          error: `Recipient address is not deliverable (${deliverability.reason})`,
        }
      } else if (!(await checkRateLimit())) {
        // 3d. Platform-wide channel rate limit.
        rejection = {
          reason: "rate_limited",
          error: `Rate limit exceeded (${MAX_PER_HOUR}/hr, ${MAX_PER_DAY}/day)`,
        }
      }
    }
  } catch (err) {
    // A gate could not be evaluated. Fail closed AND leave a row — an unlogged
    // throw here is exactly the invisible failure this rewrite removes.
    rejection = {
      reason: "send_error",
      error: `Send gate evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (rejection) return reject(rejection.reason, rejection.error)

  // Past every gate, so the address is present and send-safe.
  const toEmail = prospect.email as string

  // One-click unsubscribe URL (CAN-SPAM + Gmail/Yahoo bulk one-click). Null when
  // no signing secret is configured — the footer then degrades to reply-only.
  const unsubscribeUrl = buildUnsubscribeUrl(toEmail)

  // 4. Build the email (prebuilt > custom override > AI-generated).
  let template: EmailTemplate
  try {
    if (input.prebuiltTemplate) {
      template = input.prebuiltTemplate
    } else if (input.customSubject && input.customBody) {
      const text = input.customBody
      template = {
        subject: input.customSubject,
        bodyText: text,
        body: `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;font-size:14px;line-height:1.7">${text
          .split("\n\n")
          .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br/>")}</p>`)
          .join("")}</div>`,
      }
    } else {
      template = await generateEmailTemplate(
        {
          dealerName: prospect.name,
          contactName: prospect.contactName,
          contactTitle: prospect.contactTitle,
          city: prospect.city ?? "",
          state: prospect.state ?? "",
        },
        { dealerEmail: toEmail, unsubscribeUrl },
      )
    }
  } catch (err) {
    // Composition failed — still an attempt, so it still gets a row.
    return reject(
      "send_error",
      `Email composition failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 4b. F-010 — append a one-click claim CTA so a responding prospect converts
  // into a pre-filled application instead of re-entering everything on the
  // public form. Best-effort: a token-mint failure must never block the send.
  try {
    const claimToken = await issueProspectClaimToken(prospect.id)
    if (claimToken) {
      const claimUrl = buildClaimUrl(claimToken)
      template = {
        ...template,
        bodyText: `${template.bodyText}\n\nReady to compete for ready-to-buy local buyers? Claim your dealership in under a minute — we've pre-filled your details:\n${claimUrl}`,
        body: `${template.body}<p style="margin:16px 0"><a href="${claimUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Claim your dealership →</a></p>`,
      }
    }
  } catch (err) {
    logger.error("[phase-4b3] claim CTA injection failed (non-fatal):", err)
  }

  // 5. Create the log row (queued) before dispatch. Here the queued state is
  // meaningful: it is true for exactly as long as the request is in flight.
  const log = await prisma.dealerOutreachLog.create({
    data: {
      dealerProspectId: prospect.id,
      outreachType,
      channel: "email",
      subject: template.subject,
      body: template.bodyText,
      toEmail,
      fromEmail: configuredFrom ?? DEFAULT_FROM_EMAIL,
      status: "queued",
      outreachSequenceStep: sequenceStep,
    },
  })

  // 6. Dispatch through the injected provider seam.
  //
  // defaultDispatch never throws, but the seam is injectable and a caller's
  // implementation may. A throw escaping here would leave the row permanently
  // `queued` — and because the idempotency check treats `queued` as a live send,
  // that row would block every future retry of this step. So a throw is
  // normalized into the same failed outcome as a provider-reported error.
  const replyTo = process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com"
  let outcome: DealerEmailDispatchResult
  try {
    outcome = await dispatch({
      to: toEmail,
      from: fromAddress(),
      replyTo,
      subject: template.subject,
      html: template.body,
      text: template.bodyText,
      unsubscribeUrl,
      outreachType,
      prospectId: prospect.id,
    })
  } catch (err) {
    outcome = { id: null, error: err instanceof Error ? err.message : String(err) }
  }

  if (outcome.error || !outcome.id) {
    const msg = outcome.error ?? "Provider returned no message id"
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: msg },
    })
    logger.error(`[phase-4b3] Dispatch failed for ${toEmail}: ${msg}`)
    // A missing/placeholder API key is a channel-config gap, not an execution
    // error — the distinction post-intake-outreach uses to defer instead of fail.
    const reason: SendDealerEmailReason = outcome.notConfigured ? "not_configured" : "send_error"
    return { success: false, reason, error: msg, outreachLogId: log.id }
  }

  await prisma.dealerOutreachLog.update({
    where: { id: log.id },
    data: { status: "sent", resendId: outcome.id },
  })

  // Reflect the outreach on the prospect status (DISCOVERED/SCRIPTED → CONTACTED).
  // updateMany so the status filter is allowed; no-op when already advanced.
  await prisma.dealerProspect
    .updateMany({
      where: { id: prospect.id, status: { in: ["DISCOVERED", "SCRIPTED"] } },
      data: { status: "CONTACTED", contactedAt: new Date() },
    })
    .catch(() => {
      // Non-blocking — the send already succeeded.
    })

  logger.info(`[phase-4b3] Email sent to ${toEmail} (provider id ${outcome.id})`)
  return { success: true, resendId: outcome.id, outreachLogId: log.id }
}
