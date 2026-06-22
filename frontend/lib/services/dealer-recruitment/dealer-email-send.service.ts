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
import {
  generateEmailTemplate,
  type EmailTemplate,
} from "./email-template.service"
import { issueProspectClaimToken, buildClaimUrl } from "./prospect-claim.service"

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

export interface SendDealerEmailResult {
  success: boolean
  resendId?: string
  error?: string
  outreachLogId?: string
}

const MAX_PER_HOUR = 50
const MAX_PER_DAY = 200
const FROM_NAME = process.env.FROM_NAME ?? "Markist Athelus"

// Phase 4B-2 — env vars that MUST be present before any dealer outreach send.
// A cold/misconfigured sending domain torches deliverability, so we refuse to
// dispatch until the founder has wired these up in Vercel (and verified the
// domain in Resend). AUTOLENIS_PHYSICAL_ADDRESS is a CAN-SPAM requirement.
export const REQUIRED_EMAIL_ENV_VARS = [
  "DEALER_OUTREACH_FROM_EMAIL",
  "DEALER_OUTREACH_REPLY_TO",
  "AUTOLENIS_PHYSICAL_ADDRESS",
  "RESEND_API_KEY",
] as const

// Returns the subset of required email env vars that are unset/empty. Empty
// array means the channel is configured.
export function missingEmailEnvVars(): string[] {
  return REQUIRED_EMAIL_ENV_VARS.filter((k) => {
    const v = process.env[k]
    return !v || v.trim().length === 0
  })
}

// Throws when the sending domain isn't fully configured. Exported for callers
// that prefer fail-fast semantics (e.g. scripts / tests); the send path below
// uses missingEmailEnvVars() directly to return a structured result instead.
export function assertEmailEnvVars(): void {
  const missing = missingEmailEnvVars()
  if (missing.length > 0) {
    throw new Error(
      `[phase-4b2] Missing required email env vars: ${missing.join(", ")}. ` +
        "Domain warming not configured. Set in Vercel before sending.",
    )
  }
}

let resendInstance: Resend | null = null
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || apiKey.includes("placeholder")) return null
  if (!resendInstance) resendInstance = new Resend(apiKey)
  return resendInstance
}

function fromAddress(): string {
  const email = process.env.DEALER_OUTREACH_FROM_EMAIL ?? "dealers@autolenis.com"
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

// Best-effort suppression check. Fails open only when the Supabase client can't
// be constructed (missing env) — never silently emails a known-suppressed
// address.
async function isSuppressed(email: string): Promise<boolean> {
  try {
    const supabase = getServiceSupabase()
    return await SuppressionService.isEmailSuppressed(supabase, email)
  } catch (err) {
    logger.warn(
      `[phase-4b3] Suppression check failed (allowing send): ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
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

export async function sendDealerEmail(
  input: SendDealerEmailInput,
): Promise<SendDealerEmailResult> {
  const outreachType: OutreachType = input.outreachType ?? "initial"

  // 0. Deliverability guard (Phase 4B-2). Refuse to send from an unconfigured
  // sending domain — protects the domain reputation during DNS warming and
  // keeps every outbound email CAN-SPAM compliant. Returned as a structured
  // result (not thrown) so one misconfig never cascades through callers.
  const missingEnv = missingEmailEnvVars()
  if (missingEnv.length > 0) {
    logger.warn(
      `[phase-4b2] Send blocked — missing required email env vars: ${missingEnv.join(", ")}`,
    )
    return {
      success: false,
      error: `Email domain not configured — set in Vercel before sending: ${missingEnv.join(", ")}`,
    }
  }

  // 1. Load prospect.
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
  if (!prospect) return { success: false, error: "Dealer not found" }
  if (!prospect.email) return { success: false, error: "Dealer has no email" }

  // 2. Suppression gate (CAN-SPAM / deliverability).
  if (await isSuppressed(prospect.email)) {
    logger.warn(`[phase-4b3] Skipping suppressed address ${prospect.email}`)
    return { success: false, error: "Recipient is suppressed (bounced/unsubscribed)" }
  }

  // 3. Rate limit.
  if (!(await checkRateLimit())) {
    return {
      success: false,
      error: `Rate limit exceeded (${MAX_PER_HOUR}/hr, ${MAX_PER_DAY}/day)`,
    }
  }

  // 4. Build the email (prebuilt > custom override > AI-generated).
  let template: EmailTemplate
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
      { dealerEmail: prospect.email },
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

  // 5. Create the log row (queued) before dispatch.
  const fromEmail = process.env.DEALER_OUTREACH_FROM_EMAIL ?? "dealers@autolenis.com"
  const log = await prisma.dealerOutreachLog.create({
    data: {
      dealerProspectId: prospect.id,
      outreachType,
      channel: "email",
      subject: template.subject,
      body: template.bodyText,
      toEmail: prospect.email,
      fromEmail,
      status: "queued",
      outreachSequenceStep: input.sequenceStep ?? stepForOutreachType(outreachType),
    },
  })

  // 6. Send via Resend.
  const resend = getResend()
  if (!resend) {
    // No API key configured (or placeholder) — record as failed, don't throw.
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: "RESEND_API_KEY not configured" },
    })
    logger.warn("[phase-4b3] RESEND_API_KEY not configured — send skipped")
    return { success: false, error: "Email sending not configured", outreachLogId: log.id }
  }

  try {
    const result = await resend.emails.send({
      from: fromAddress(),
      to: prospect.email,
      replyTo: process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com",
      subject: template.subject,
      html: template.body,
      text: template.bodyText,
      tags: [
        { name: "outreach_type", value: outreachType },
        { name: "dealer_id", value: prospect.id },
      ],
    })

    // The Resend SDK surfaces HTTP errors via result.error rather than throwing.
    if (result.error || !result.data?.id) {
      const msg =
        result.error?.message ?? "Resend returned no message id"
      await prisma.dealerOutreachLog.update({
        where: { id: log.id },
        data: { status: "failed", errorMessage: msg },
      })
      logger.error(`[phase-4b3] Resend dispatch failed for ${prospect.email}: ${msg}`)
      return { success: false, error: msg, outreachLogId: log.id }
    }

    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "sent", resendId: result.data.id },
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

    logger.info(`[phase-4b3] Email sent to ${prospect.email} (resend ${result.data.id})`)
    return { success: true, resendId: result.data.id, outreachLogId: log.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: msg },
    })
    logger.error(`[phase-4b3] Email send threw for ${prospect.email}: ${msg}`)
    return { success: false, error: msg, outreachLogId: log.id }
  }
}
