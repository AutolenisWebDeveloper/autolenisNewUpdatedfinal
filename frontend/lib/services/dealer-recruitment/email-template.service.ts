// AutoLenis Phase 4B-3 — Dealer outreach email template generator.
//
// Uses Groq (gpt-oss-120b) to write a personalized cold-outreach subject + body
// for a dealer prospect, then wraps it with the founder signature and the
// CAN-SPAM-required footer (unsubscribe instruction + physical address).
//
// The signature / footer / unsubscribe text are appended deterministically here
// — the LLM is told NOT to include them — so compliance never depends on model
// behavior.

import { logger } from "@/lib/logger";
import { GROQ_REASONING } from "@/lib/ai/acquisition"
import { complete } from "@/lib/ai/provider"

export interface EmailTemplateInput {
  dealerName: string
  contactName: string | null
  contactTitle: string | null
  city: string
  state: string
  // Optional buyer context for hyper-personalization.
  matchingBuyerCount?: number
  topVehicleRequests?: Array<{
    make: string
    model: string
    budget: number | null
  }>
}

export interface EmailTemplate {
  subject: string
  body: string // HTML
  bodyText: string // plain-text fallback
}

interface GeneratedEmail {
  subject: string
  body: string // plain text, no signature/footer
}

const FOUNDER_NAME = "Markist Athelus"
const FOUNDER_REPLY_TO = process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com"
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").trim()

// ─── Groq helper (mirrors phone-script-drafter's REST pattern) ───────────────
async function callGroq(options: {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  // Transport only — model, prompts, token cap, temperature and top_p unchanged.
  const result = await complete({
    purpose: "dealer_recruitment.email_template",
    model: GROQ_REASONING, // openai/gpt-oss-120b
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
    maxTokens: options.maxTokens ?? 900,
    temperature: options.temperature ?? 0.6,
    topP: 1.0,
    // Request-level timeout so a hung upstream can't stall the whole batch
    // send — the generator already has a deterministic fallback on failure.
    signal: AbortSignal.timeout(25_000),
  })
  return result.content
}

async function callGroqWithRetry(
  params: Parameters<typeof callGroq>[0],
): Promise<string> {
  const maxAttempts = 3
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGroq(params)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes("429") && !message.includes("503")) throw err
      if (attempt === maxAttempts - 1) throw err
      const backoffMs = Math.min(8000 * Math.pow(2, attempt), 32000)
      logger.warn(
        `[phase-4b3] Groq retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.substring(0, 120)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

const SYSTEM_PROMPT = `You write professional, personalized B2B cold-outreach emails from Markist Athelus, founder of AutoLenis, to car dealerships.

About AutoLenis:
- A reverse-auction concierge connecting verified buyers with dealers
- Buyers submit a structured vehicle request
- Multiple dealers compete in a 48-hour reverse auction with their best out-the-door price
- The buyer privately compares the top offers and picks one
- Dealers pay nothing upfront — they only earn on a closed deal

Tone: professional, direct, peer-to-peer, dealer-respectful. No marketing fluff, no hype, no emojis.
Length: 150-200 words for the body.
Goal of the email: a 15-minute call this week.

Return ONLY valid JSON in this exact shape, no markdown, no commentary:
{
  "subject": "string — max 60 chars, mentions the dealership OR location, references concrete value (buyers), no spam words like Free/Act Now/Limited Time, no emoji, no clickbait",
  "body": "string — plain-text email body only"
}

The body must NOT include:
- A greeting line is OK (e.g. "Hi <name>,")
- Do NOT include the sign-off/signature (Markist Athelus / Founder / contact info)
- Do NOT include any unsubscribe text
- Do NOT include a physical address or CAN-SPAM footer
Begin your response with { and end with }.`

function buildUserPrompt(input: EmailTemplateInput): string {
  const demand: string[] = []
  if (input.matchingBuyerCount && input.matchingBuyerCount > 0) {
    demand.push(
      `We currently have ${input.matchingBuyerCount} qualified buyer(s) in their area.`,
    )
  }
  if (input.topVehicleRequests && input.topVehicleRequests.length > 0) {
    const list = input.topVehicleRequests
      .map((r) => [r.make, r.model].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ")
    if (list) demand.push(`Top buyer requests right now: ${list}.`)
  }

  return `Write the outreach email for this dealership:

- Dealership: ${input.dealerName}
- Contact: ${input.contactName ?? "Internet Sales Team"}
- Title: ${input.contactTitle ?? "Internet Sales"}
- Location: ${input.city}, ${input.state}
${demand.length ? `\nBuyer demand to reference:\n${demand.join("\n")}` : ""}

Return the JSON object with "subject" and "body".`
}

// ─── Parsing with coercion ───────────────────────────────────────────────────
function parseGenerated(
  raw: string,
  input: EmailTemplateInput,
): GeneratedEmail {
  const greeting = input.contactName
    ? `Hi ${input.contactName.split(" ")[0]},`
    : "Hi Internet Sales Team,"

  // Deterministic fallback if the model misbehaves — still a usable, honest email.
  const fallback: GeneratedEmail = {
    subject: `${input.dealerName} + AutoLenis: buyers in ${input.city}`,
    body: `${greeting}

I'm Markist Athelus, founder of AutoLenis. We connect verified buyers with dealers through a reverse-auction model: a buyer tells us what they want, multiple dealers compete with their best out-the-door price, and the buyer picks the offer they like. There's no upfront cost — dealers only earn on a closed deal.

We have buyers in the ${input.city}, ${input.state} area looking for vehicles you carry, and I'd love to include ${input.dealerName} in the next round.

Would you have 15 minutes this week for a quick call to see how it works?`,
  }

  if (!raw.trim()) return fallback

  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const subject =
      typeof parsed.subject === "string" && parsed.subject.trim()
        ? parsed.subject.trim().slice(0, 120)
        : fallback.subject
    const body =
      typeof parsed.body === "string" && parsed.body.trim()
        ? parsed.body.trim()
        : fallback.body
    return { subject, body }
  } catch (err) {
    logger.warn(
      `[phase-4b3] Email JSON parse failed, using fallback: ${err instanceof Error ? err.message : String(err)}`,
    )
    return fallback
  }
}

// ─── Full-email assembly (signature + CAN-SPAM footer) ───────────────────────
function buildFullEmail(
  generated: GeneratedEmail,
  dealerEmail: string,
  unsubscribeUrl: string | null,
): EmailTemplate {
  const physicalAddress =
    process.env.AUTOLENIS_PHYSICAL_ADDRESS ?? "AutoLenis, Inc."

  const unsubLine = unsubscribeUrl
    ? `If you'd prefer not to receive future emails, unsubscribe here: ${unsubscribeUrl} — or reply with "UNSUBSCRIBE" and we'll remove you immediately.`
    : `If you'd prefer not to receive future emails, reply with "UNSUBSCRIBE" and we'll remove you immediately.`

  const bodyText = `${generated.body}

Best,
${FOUNDER_NAME}
Founder, AutoLenis
${FOUNDER_REPLY_TO}
${APP_URL}

---
This email was sent to ${dealerEmail} because your dealership is listed as an automotive retailer matching buyer demand in your area. ${unsubLine}

${physicalAddress}`

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

  const bodyHtml = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;font-size:14px;line-height:1.7">${bodyText
    .split("\n\n")
    .map((para) => {
      // Render the trailing footer block (after the --- divider) in muted type.
      if (para.startsWith("---")) {
        return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>`
      }
      return `<p style="margin:0 0 16px">${esc(para).replace(/\n/g, "<br/>")}</p>`
    })
    .join("\n")}</div>`

  return {
    subject: generated.subject,
    body: bodyHtml,
    bodyText,
  }
}

// ─── Phase 4B-4 — follow-up templates ────────────────────────────────────────
//
// Deterministic (non-LLM) follow-up bodies. We keep these copy-controlled and
// reliable rather than re-prompting Groq for every nudge — the cadence is about
// gentle persistence, not novelty. Both reuse buildFullEmail so the signature
// and CAN-SPAM footer stay identical to the initial outreach.

export interface FollowUpTemplateInput {
  dealerName: string
  contactName: string | null
  city: string
  state: string
  // Number of verified buyers we can reference in the dealer's area (0 = unknown).
  buyerCount?: number
  // Days since the initial outreach email was sent.
  daysAgo?: number
}

function followUpGreeting(contactName: string | null): string {
  return contactName
    ? `Hi ${contactName.split(" ")[0]},`
    : "Hi Internet Sales Team,"
}

/**
 * Follow-up 1 (Day 3) — value-add angle. Leads with buyer demand, references the
 * prior note, and invites a short call without a hard pitch.
 */
export function generateFollowUp1Template(
  input: FollowUpTemplateInput,
  opts: { dealerEmail: string; unsubscribeUrl?: string | null },
): EmailTemplate {
  const greeting = followUpGreeting(input.contactName)
  const daysAgo = input.daysAgo && input.daysAgo > 0 ? input.daysAgo : "a few"
  const area = [input.city, input.state].filter(Boolean).join(", ") || "your area"
  const buyerPhrase =
    input.buyerCount && input.buyerCount > 0
      ? `we currently have ${input.buyerCount} verified buyer${input.buyerCount === 1 ? "" : "s"} in the ${area} area with approved budgets`
      : `we have verified buyers in the ${area} area with approved budgets`

  const body = `${greeting}

Just following up on my note from ${daysAgo} days ago about AutoLenis and qualified buyers in your market.

A quick update: ${buyerPhrase} looking for vehicles your dealership stocks. There's no cost to join — we only earn on a closed deal.

Would a 15-minute call this week work to walk through how it fits ${input.dealerName}?`

  return buildFullEmail(
    {
      subject: `Re: ${input.dealerName} + AutoLenis — buyer update`.slice(0, 120),
      body,
    },
    opts.dealerEmail,
    opts.unsubscribeUrl ?? null,
  )
}

/**
 * Follow-up 2 (Day 8) — low-pressure final check-in. Easy to say yes or no.
 */
export function generateFollowUp2Template(
  input: FollowUpTemplateInput,
  opts: { dealerEmail: string; unsubscribeUrl?: string | null },
): EmailTemplate {
  const greeting = followUpGreeting(input.contactName)

  const body = `${greeting}

I'll keep this brief — didn't want to leave things hanging.

AutoLenis is building a network of dealerships who want first access to verified buyer auctions in their area. No commitment, no upfront cost.

If timing isn't right, totally understand. If you'd like to learn more, I'm happy to send a one-page overview.

Either way — no pressure.`

  return buildFullEmail(
    {
      subject: "Last note — AutoLenis dealer network",
      body,
    },
    opts.dealerEmail,
    opts.unsubscribeUrl ?? null,
  )
}

// ─── Vehicle-specific buyer-opportunity outreach ─────────────────────────────
//
// Deterministic (non-LLM) template used by the post-intake auto-outreach flow.
// Unlike the generic cold-outreach generator above, this email is grounded in a
// specific BuyerOpportunity. PRIVACY: it carries ONLY non-identifying buyer
// signal — vehicle interest, a rounded budget RANGE, city + state (never zip),
// timeline, condition. No buyer name / email / phone / address is ever included.

export interface BuyerOpportunityEmailParams {
  dealerName: string
  dealerContactName: string | null
  vehicleMake: string
  vehicleModel: string
  yearRange: string // e.g., "2023-2024" or "2024"
  budgetRange: string // e.g., "$30,000-$35,000"
  buyerCity: string // city only — NO zip, NO address
  buyerState: string // state abbreviation
  timeline: string // e.g., "within 30 days"
  condition: string // "New", "Used", or "Either"
  offerSubmitUrl: string // link for the dealer to submit an offer
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Build a vehicle-specific, CAN-SPAM-compliant dealer outreach email for a
 * single BuyerOpportunity. Returns subject + HTML body + plain-text fallback.
 */
export function generateBuyerOpportunityEmail(
  params: BuyerOpportunityEmailParams,
): EmailTemplate {
  const greetingName = params.dealerContactName?.trim()
    ? params.dealerContactName.trim().split(/\s+/)[0]
    : "Internet Sales Team"

  const vehicle = [params.vehicleMake, params.vehicleModel]
    .filter(Boolean)
    .join(" ")
    .trim()
  const yearVehicle = [params.yearRange, vehicle].filter(Boolean).join(" ").trim()
  const location = [params.buyerCity, params.buyerState]
    .filter(Boolean)
    .join(", ")

  const subject =
    `Qualified buyer in ${location} seeking ${vehicle}`.slice(0, 160)

  const bodyText = `Hi ${greetingName},

My name is Markist Athelus, founder of AutoLenis. We connect verified car buyers with local dealerships through a competitive offer model.

We have a qualified buyer in ${location} looking for:

Vehicle: ${yearVehicle}
Condition: ${params.condition}
Budget: ${params.budgetRange}
Timeline: ${params.timeline}

This buyer has been pre-screened and is ready to make a purchase decision. There is no cost to participate — dealers only pay when they win a deal.

To submit your best out-the-door offer:
${params.offerSubmitUrl}

Your contact information will be shared with the buyer ONLY if they select your offer. All offers are submitted through our platform.

Best,
Markist Athelus
Founder, AutoLenis
info@autolenis.com
https://www.autolenis.com

---
This email was sent because your dealership matches buyer demand in your area. Reply UNSUBSCRIBE to opt out.
AutoLenis | 4500 Spring Creek Pkwy, Suite 200, Plano, TX 75024`

  const body = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;font-size:14px;line-height:1.7">
  <p style="margin:0 0 16px">Hi ${escapeHtml(greetingName)},</p>
  <p style="margin:0 0 16px">My name is Markist Athelus, founder of AutoLenis. We connect verified car buyers with local dealerships through a competitive offer model.</p>
  <p style="margin:0 0 8px">We have a qualified buyer in <strong>${escapeHtml(location)}</strong> looking for:</p>
  <table style="margin:0 0 16px;border-collapse:collapse">
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Vehicle:</td><td style="padding:2px 0;font-weight:600">${escapeHtml(yearVehicle)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Condition:</td><td style="padding:2px 0;font-weight:600">${escapeHtml(params.condition)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Budget:</td><td style="padding:2px 0;font-weight:600">${escapeHtml(params.budgetRange)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Timeline:</td><td style="padding:2px 0;font-weight:600">${escapeHtml(params.timeline)}</td></tr>
  </table>
  <p style="margin:0 0 20px">This buyer has been pre-screened and is ready to make a purchase decision. There is no cost to participate — dealers only pay when they win a deal.</p>
  <div style="text-align:center;margin:24px 0">
    <a href="${escapeHtml(params.offerSubmitUrl)}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">SUBMIT MY OFFER →</a>
  </div>
  <p style="margin:0 0 16px">Your contact information will be shared with the buyer ONLY if they select your offer. All offers are submitted through our platform.</p>
  <p style="margin:0 0 16px">Best,<br/>Markist Athelus<br/>Founder, AutoLenis<br/><a href="mailto:info@autolenis.com" style="color:#0B5FD1">info@autolenis.com</a><br/><a href="https://www.autolenis.com" style="color:#0B5FD1">https://www.autolenis.com</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="margin:0;color:#94a3b8;font-size:12px">This email was sent because your dealership matches buyer demand in your area. Reply UNSUBSCRIBE to opt out.<br/>AutoLenis | 4500 Spring Creek Pkwy, Suite 200, Plano, TX 75024</p>
</div>`

  return { subject, body, bodyText }
}

/**
 * Generate the full personalized outreach email (subject + HTML + plain text)
 * for a dealer prospect, including signature and CAN-SPAM footer.
 */
export async function generateEmailTemplate(
  input: EmailTemplateInput,
  opts: { dealerEmail: string; unsubscribeUrl?: string | null },
): Promise<EmailTemplate> {
  let raw = ""
  try {
    raw = await callGroqWithRetry({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      temperature: 0.6,
      maxTokens: 900,
    })
  } catch (err) {
    logger.error(
      `[phase-4b3] Groq email generation failed for ${input.dealerName}, using fallback:`,
      err,
    )
  }

  const generated = parseGenerated(raw, input)
  return buildFullEmail(generated, opts.dealerEmail, opts.unsubscribeUrl ?? null)
}
