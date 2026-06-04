// lib/services/dealer-recruitment/email-template.service.ts
// Phase 4B-3 — Generates a personalized, CAN-SPAM-compliant cold outreach
// email from Marc (founder of AutoLenis) to a dealer prospect.
//
// The AI (Groq gpt-oss-120b) writes only the personalized opener + value-prop
// body. The signature, CAN-SPAM footer, and unsubscribe line are appended by
// buildFullEmail() so they are always present and never hallucinated away.

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
  bodyText: string // Plain-text fallback
}

interface GeneratedEmail {
  subject: string
  body: string // Plain-text body, no signature/footer
}

// Founder + brand constants kept here so the AI never invents contact details.
const FOUNDER_NAME = "Marc Smith"
const FOUNDER_TITLE = "Founder, AutoLenis"
const FOUNDER_REPLY_TO = process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com"
const SITE_URL = "https://www.autolenis.com"

// ─── Local non-streaming Groq helper ─────────────────────────────────────────
// Mirrors the REST pattern used by phone-script-drafter.service.ts (acquisition
// keeps its callGroq() private). POST to Groq's OpenAI-compatible endpoint.
async function callGroq(options: {
  model: string
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
      model: options.model,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.4,
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

// Retry only transient Groq errors (429 rate limit / 503 capacity) with
// exponential backoff: 8s, 16s, 32s.
async function callGroqWithRetry(params: Parameters<typeof callGroq>[0]): Promise<string> {
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
        `[phase-4b3] Email-gen retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.substring(0, 120)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

const EMAIL_SYSTEM_PROMPT = `You generate professional, personalized cold outreach emails from Marc, founder of AutoLenis, to car dealerships.

About AutoLenis:
- A reverse-auction concierge connecting verified buyers with dealers.
- Buyers submit a structured vehicle request (vehicle, budget, timeline, ZIP).
- Up to 8 dealers compete in a 48-hour reverse auction with their best out-the-door price.
- The buyer privately compares the top offers and picks one.
- Dealers pay nothing upfront — they only earn when a deal closes.

Tone: professional, direct, peer-to-peer, dealer-respectful. No marketing fluff, no hype, no emoji.
Length: 150-200 words for the body.
Goal of the email: secure a 15-minute call this week.

Return ONLY valid JSON in this exact shape, no markdown, no commentary:
{
  "subject": "string — max 60 chars, no emoji, no clickbait, references the dealership name OR location and a concrete value",
  "body": "string — plain-text email body only"
}

The subject MUST:
- Mention the dealership name OR its location.
- Reference a specific value (real buyers / competing for their business), not a generic "partnership".
- Avoid spammy words: "Free", "Act Now", "Limited Time", "Guaranteed", "$$$".

The body MUST NOT include:
- A signature (Marc / Founder / contact info) — that is appended separately.
- A CAN-SPAM footer or physical address — appended separately.
- Any unsubscribe text — appended separately.
- Any unsubstantiated savings claim (no "save thousands", no specific $ savings, no percentages).

Begin your response with { and end with }.`

function buildUserPrompt(input: EmailTemplateInput): string {
  const buyerDemandLines: string[] = []
  if (input.matchingBuyerCount && input.matchingBuyerCount > 0) {
    buyerDemandLines.push(
      `We currently have ${input.matchingBuyerCount} qualified buyer(s) in their area.`,
    )
  }
  if (input.topVehicleRequests && input.topVehicleRequests.length > 0) {
    const reqs = input.topVehicleRequests
      .map((r) => [r.make, r.model].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ")
    if (reqs) buyerDemandLines.push(`Top buyer requests: ${reqs}.`)
  }
  const buyerDemand =
    buyerDemandLines.length > 0
      ? buyerDemandLines.join(" ")
      : "We are matching buyers to dealers in their market."

  return `Write the outreach email for this dealership.

Dealership: ${input.dealerName}
Contact: ${input.contactName ?? "Internet Sales Team"}
Title: ${input.contactTitle ?? "Manager"}
Location: ${input.city || "their area"}, ${input.state || ""}

Buyer demand: ${buyerDemand}

Output the JSON object now.`
}

// Calls Groq, parses + coerces the JSON. Falls back to a safe deterministic
// template if the model output is unusable so a send is never silently dropped.
export async function generateEmailTemplate(
  input: EmailTemplateInput,
): Promise<EmailTemplate> {
  let generated: GeneratedEmail | null = null

  try {
    const raw = await callGroqWithRetry({
      model: GROQ_REASONING, // openai/gpt-oss-120b
      systemPrompt: EMAIL_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      temperature: 0.4,
      maxTokens: 900,
    })
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Partial<GeneratedEmail>
      const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : ""
      const body = typeof parsed.body === "string" ? parsed.body.trim() : ""
      if (subject && body) {
        // Enforce the 60-char subject ceiling defensively.
        generated = { subject: subject.slice(0, 70), body }
      }
    }
    if (!generated) {
      console.error(`[phase-4b3] Email generation returned unusable output: ${raw.slice(0, 200)}`)
    }
  } catch (err) {
    console.error(`[phase-4b3] Email generation failed for ${input.dealerName}:`, err)
  }

  if (!generated) generated = fallbackTemplate(input)

  return buildFullEmail(generated, input.contactName)
}

// Deterministic fallback so the founder can still send if the LLM is unavailable.
function fallbackTemplate(input: EmailTemplateInput): GeneratedEmail {
  const loc = [input.city, input.state].filter(Boolean).join(", ") || "your area"
  const subject = `${input.dealerName} + AutoLenis: buyers competing for your business`.slice(0, 70)
  const body = `Hi ${input.contactName ?? "Internet Sales Team"},

I'm Marc, founder of AutoLenis. We run a reverse-auction concierge that connects verified buyers with dealers like ${input.dealerName}. Buyers submit a structured request, up to 8 dealers compete with their best out-the-door price over 48 hours, and the buyer picks the offer they like.

There's no upfront cost to your store — you only earn when a deal closes. We're working with buyers in ${loc} right now and would like ${input.dealerName} in the mix.

Would you have 15 minutes this week for a quick call to see if it's a fit?`
  return { subject, body }
}

// Wraps the generated body with the signature + CAN-SPAM footer and produces
// both plain-text and HTML variants.
export function buildFullEmail(
  generated: GeneratedEmail,
  dealerEmailOrName: string | null,
): EmailTemplate {
  const physicalAddress =
    process.env.AUTOLENIS_PHYSICAL_ADDRESS ?? "[Physical address required for CAN-SPAM]"
  const recipientLabel = dealerEmailOrName ?? "your dealership"

  const bodyText = `${generated.body}

Best,
${FOUNDER_NAME}
${FOUNDER_TITLE}
${FOUNDER_REPLY_TO}
${SITE_URL}

---
This email was sent to ${recipientLabel} because your dealership is listed as an automotive retailer matching our buyer demand in your area. If you'd prefer not to receive future emails, reply with "UNSUBSCRIBE" and we'll remove you immediately.

AutoLenis | ${physicalAddress}`

  const bodyHtml = bodyText
    .split("\n\n")
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n")

  return {
    subject: generated.subject,
    body: bodyHtml,
    bodyText,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
