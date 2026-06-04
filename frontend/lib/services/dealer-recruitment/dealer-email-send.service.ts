// lib/services/dealer-recruitment/dealer-email-send.service.ts
// Phase 4B-3 — Sends a personalized, CAN-SPAM-compliant outreach email to a
// dealer prospect via Resend, logging every attempt in dealer_outreach_log.
//
// Rate limited to 50 sends/hour and 200 sends/day across all dealer email
// outreach to protect sender reputation.

import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import {
  generateEmailTemplate,
  buildFullEmail,
} from "./email-template.service"

export interface SendDealerEmailInput {
  dealerProspectId: string
  outreachType: "initial" | "followup_1" | "followup_2"
  // Optional: override the AI-generated email (founder edited in the UI).
  customSubject?: string
  customBody?: string
}

export interface SendDealerEmailResult {
  success: boolean
  resendId?: string
  error?: string
  outreachLogId?: string
}

const HOURLY_LIMIT = 50
const DAILY_LIMIT = 200

// Lazy Resend client — constructed on first use so `next build` page-data
// collection doesn't throw when RESEND_API_KEY is absent. Mirrors
// resend.service.ts.
let resendInstance: Resend | null = null
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || apiKey.includes("placeholder")) return null
  if (!resendInstance) resendInstance = new Resend(apiKey)
  return resendInstance
}

function fromAddress(): string {
  return process.env.DEALER_OUTREACH_FROM_EMAIL ?? "dealers@autolenis.com"
}
function replyToAddress(): string {
  return process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com"
}

// Counts successful email sends in the trailing hour and day. Sends still
// in-flight ('queued') are excluded; only committed ('sent'/'delivered')
// attempts count against the budget.
export async function checkRateLimit(): Promise<{ ok: boolean; reason?: string }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [hourCount, dayCount] = await Promise.all([
    prisma.dealerOutreachLog.count({
      where: { channel: "email", status: { in: ["sent", "delivered"] }, sentAt: { gte: oneHourAgo } },
    }),
    prisma.dealerOutreachLog.count({
      where: { channel: "email", status: { in: ["sent", "delivered"] }, sentAt: { gte: oneDayAgo } },
    }),
  ])

  if (hourCount >= HOURLY_LIMIT) {
    console.warn(`[phase-4b3] Hourly rate limit hit: ${hourCount}/${HOURLY_LIMIT}`)
    return { ok: false, reason: `Hourly rate limit reached (${HOURLY_LIMIT}/hr)` }
  }
  if (dayCount >= DAILY_LIMIT) {
    console.warn(`[phase-4b3] Daily rate limit hit: ${dayCount}/${DAILY_LIMIT}`)
    return { ok: false, reason: `Daily rate limit reached (${DAILY_LIMIT}/day)` }
  }
  return { ok: true }
}

export async function sendDealerEmail(
  input: SendDealerEmailInput,
): Promise<SendDealerEmailResult> {
  // 1. Load the prospect (+ buyer context for personalization).
  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: input.dealerProspectId },
    include: { buyerOpp: true },
  })
  if (!prospect) return { success: false, error: "Dealer not found" }
  if (!prospect.email) return { success: false, error: "Dealer has no email on file" }

  // 2. Rate limit guard.
  const rate = await checkRateLimit()
  if (!rate.ok) return { success: false, error: rate.reason ?? "Rate limit exceeded" }

  // 3. Build the email — founder override or AI-generated.
  let template
  try {
    if (input.customSubject && input.customBody) {
      template = buildFullEmail(
        { subject: input.customSubject, body: input.customBody },
        prospect.email,
      )
    } else {
      const opp = prospect.buyerOpp
      template = await generateEmailTemplate({
        dealerName: prospect.name,
        contactName: null,
        contactTitle: null,
        city: prospect.city ?? "",
        state: prospect.state ?? "",
        topVehicleRequests:
          opp?.make || opp?.model
            ? [{ make: opp.make ?? "", model: opp.model ?? "", budget: opp.budgetAmount ?? null }]
            : undefined,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[phase-4b3] Template build failed for ${input.dealerProspectId}: ${msg}`)
    return { success: false, error: `Email generation failed: ${msg}` }
  }

  // 4. Create the log row (queued) before dispatch so failures are auditable.
  const fromEmail = fromAddress()
  const log = await prisma.dealerOutreachLog.create({
    data: {
      dealerProspectId: input.dealerProspectId,
      outreachType: input.outreachType,
      channel: "email",
      subject: template.subject,
      body: template.bodyText,
      toEmail: prospect.email,
      fromEmail,
      status: "queued",
    },
  })

  // 5. Dispatch via Resend.
  const resend = getResend()
  if (!resend) {
    // No API key (dev / build) — record DEV skip without failing hard.
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: "RESEND_API_KEY not configured" },
    })
    console.warn(`[phase-4b3] RESEND_API_KEY not set — email to ${prospect.email} skipped`)
    return { success: false, error: "RESEND_API_KEY not configured", outreachLogId: log.id }
  }

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to: prospect.email,
      replyTo: replyToAddress(),
      subject: template.subject,
      html: template.body,
      text: template.bodyText,
      tags: [
        { name: "outreach_type", value: input.outreachType },
        { name: "dealer_id", value: input.dealerProspectId },
      ],
    })

    // Resend surfaces HTTP errors via result.error rather than throwing.
    if (result.error || !result.data?.id) {
      const msg = result.error?.message ?? "Resend returned no message id"
      await prisma.dealerOutreachLog.update({
        where: { id: log.id },
        data: { status: "failed", errorMessage: msg },
      })
      console.error(`[phase-4b3] Email send failed for ${prospect.email}: ${msg}`)
      return { success: false, error: msg, outreachLogId: log.id }
    }

    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "sent", resendId: result.data.id },
    })

    // Stamp the prospect so the pipeline reflects the touch. Only advance an
    // earlier-stage prospect to CONTACTED on the initial send; never regress a
    // REPLIED/ONBOARDED dealer.
    const advanceableStatuses = ["DISCOVERED", "SCRIPTED", "DRAFTED"]
    await prisma.dealerProspect.update({
      where: { id: input.dealerProspectId },
      data: {
        contactedAt: prospect.contactedAt ?? new Date(),
        ...(input.outreachType === "initial" && advanceableStatuses.includes(prospect.status)
          ? { status: "CONTACTED" }
          : {}),
      },
    })

    console.log(`[phase-4b3] Email sent to ${prospect.email} (resend ${result.data.id})`)
    return { success: true, resendId: result.data.id, outreachLogId: log.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: msg },
    })
    console.error(`[phase-4b3] Email send threw for ${prospect.email}: ${msg}`)
    return { success: false, error: msg, outreachLogId: log.id }
  }
}
