// AutoLenis Phase 4B-3 — Dealer outreach email template generator.
//
// Uses Groq (gpt-oss-120b) to write a personalized cold-outreach subject + body
// for a dealer prospect, then wraps it with the founder signature and the
// CAN-SPAM-required footer (unsubscribe instruction + physical address).
//
// The signature / footer / unsubscribe text are appended deterministically here
// — the LLM is told NOT to include them — so compliance never depends on model
// behavior.

import { GROQ_REASONING } from "@/lib/ai/acquisition"

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

const FOUNDER_NAME = "Marc Smith"
const FOUNDER_REPLY_TO = process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com"
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").trim()

// ─── Groq helper (mirrors phone-script-drafter's REST pattern) ───────────────
async function callGroq(options: {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured")
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_REASONING, // openai/gpt-oss-120b
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      max_tokens: options.maxTokens ?? 900,
      temperature: options.temperature ?? 0.6,
      top_p: 1.0,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ""
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
      console.warn(
        `[phase-4b3] Groq retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.substring(0, 120)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

const SYSTEM_PROMPT = `You write professional, personalized B2B cold-outreach emails from Marc, founder of AutoLenis, to car dealerships.

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
- Do NOT include the sign-off/signature (Marc / Founder / contact info)
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

I'm Marc, founder of AutoLenis. We connect verified buyers with dealers through a reverse-auction model: a buyer tells us what they want, multiple dealers compete with their best out-the-door price, and the buyer picks the offer they like. There's no upfront cost — dealers only earn on a closed deal.

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
    console.warn(
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
    console.error(
      `[phase-4b3] Groq email generation failed for ${input.dealerName}, using fallback:`,
      err,
    )
  }

  const generated = parseGenerated(raw, input)
  return buildFullEmail(generated, opts.dealerEmail, opts.unsubscribeUrl ?? null)
}
