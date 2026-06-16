import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma"
import { GROQ_REASONING } from "@/lib/ai/acquisition"

// Drafts a phone-call script for the founder to use when
// calling a dealer prospect. References the specific buyer
// opportunity to make the call relevant.

export interface PhoneScript {
  opening: string
  pitch: string
  buyer_details: string
  close: string
  full_script: string
}

// ─── Local non-streaming Groq helper ─────────────────────────────────────────
// acquisition.ts keeps its callGroq() private and is read-only for Phase 4A,
// so we mirror the exact REST pattern here (POST to Groq's OpenAI-compatible
// chat completions endpoint with bearer auth).
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
      temperature: options.temperature ?? 0.2,
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

// ─── Retry wrapper with exponential backoff ──────────────────────────────────
// Groq free tier rate-limits aggressively (429) and occasionally returns 503
// when capacity is exhausted. Retry only those transient errors; surface
// everything else immediately so genuine failures aren't masked.
async function callGroqWithRetry(params: Parameters<typeof callGroq>[0]): Promise<string> {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGroq(params)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)

      // Only retry on 429 (rate limit) or 503 (capacity)
      if (!message.includes("429") && !message.includes("503")) {
        throw err
      }

      if (attempt === maxAttempts - 1) {
        throw err
      }

      // Exponential backoff: 8s, 16s, 32s
      const backoffMs = Math.min(8000 * Math.pow(2, attempt), 32000)
      logger.warn(`[phone-script-drafter] Retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms due to: ${message.substring(0, 100)}`)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  throw lastError
}

const SCRIPT_SYSTEM_PROMPT = `You are an outbound dealer recruitment coach for AutoLenis. The founder is personally calling dealerships to recruit them onto the platform. Your job is to draft a confident, conversational phone-call script.

About AutoLenis:
- A reverse-auction platform connecting motivated buyers with verified dealers
- Buyers complete structured intake (vehicle, budget, timeline, ZIP, phone)
- Dealers compete for the buyer's business with private out-the-door price quotes
- Buyer compares top 3 offers privately, picks one
- Dealers pay only when they win — no upfront cost
- Currently recruiting founding dealers (early access tier)

The call:
- 45-60 seconds for the opening pitch
- Confident peer tone, not salesy
- Lead with the specific buyer (they have a real buyer in their backyard)
- Acknowledge the dealer's time is limited
- One clear ask: try it with this one buyer, see how it goes

Output ONLY valid JSON in this exact format:
{
  "opening": "What to say in the first 10 seconds — introduce self and reason for call",
  "pitch": "30-second value prop — what AutoLenis is and why this dealer specifically",
  "buyer_details": "The specific buyer details they should hear (use natural language, not bullet points)",
  "close": "The ask — what action you want them to take",
  "full_script": "The complete script as one continuous block of text the founder can read top to bottom"
}

Begin response with { and end with }. No markdown, no commentary.`

export async function draftPhoneScriptForProspect(
  prospectId: string
): Promise<PhoneScript | null> {
  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    include: { buyerOpp: true },
  })

  if (!prospect) {
    logger.error(`[phone-script-drafter] Prospect ${prospectId} not found`)
    return null
  }

  const opp = prospect.buyerOpp
  if (!opp) {
    logger.error(`[phone-script-drafter] Buyer opp missing for ${prospectId}`)
    return null
  }

  // Build buyer context
  const vehicle =
    [opp.make, opp.model].filter(Boolean).join(" ") ||
    opp.bodyStyle ||
    "vehicle"

  const yearRange =
    opp.yearMin && opp.yearMax
      ? `${opp.yearMin}-${opp.yearMax}`
      : opp.yearMin
        ? `${opp.yearMin}`
        : "current model year"

  const trim = opp.trim ? ` ${opp.trim}` : ""

  const budget = opp.budgetAmount
    ? `$${opp.budgetAmount.toLocaleString()}`
    : opp.monthlyPayment
      ? `$${opp.monthlyPayment}/mo`
      : "flexible"

  const timelineDisplay =
    opp.timeline === "this_week"
      ? "this week"
      : opp.timeline === "1_to_3_months"
        ? "in the next 1-3 months"
        : opp.timeline === "researching"
          ? "still researching"
          : opp.timeline ?? "soon"

  const buyerArea = opp.zip ? `ZIP ${opp.zip}` : "the area"

  const userPrompt = `Draft a phone call script for the founder to call this dealer:

DEALER:
- Name: ${prospect.name}
- Location: ${prospect.city ?? "unknown"}, ${prospect.state ?? "unknown"}
- Phone: ${prospect.phone ?? "unknown"}
- Brand they sell: ${prospect.brand ?? "unknown"}

BUYER THEY WOULD COMPETE FOR:
- Looking for: ${yearRange} ${vehicle}${trim}
- Budget: ${budget}
- Timeline: buying ${timelineDisplay}
- Located near: ${buyerArea}

Output the JSON script structure.`

  let response: string
  try {
    response = await callGroqWithRetry({
      model: GROQ_REASONING, // openai/gpt-oss-120b
      systemPrompt: SCRIPT_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.7,
      maxTokens: 1500,
    })
  } catch (err) {
    logger.error(`[phone-script-drafter] Groq call failed for ${prospectId}:`, err)
    return null
  }

  // Parse JSON
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.error(
        `[phone-script-drafter] No JSON in response: ${response.substring(0, 200)}`
      )
      return null
    }
    const parsed = JSON.parse(jsonMatch[0])

    if (!parsed.full_script || typeof parsed.full_script !== "string") {
      logger.error(`[phone-script-drafter] Missing full_script:`, parsed)
      return null
    }

    return {
      opening: typeof parsed.opening === "string" ? parsed.opening : "",
      pitch: typeof parsed.pitch === "string" ? parsed.pitch : "",
      buyer_details: typeof parsed.buyer_details === "string" ? parsed.buyer_details : "",
      close: typeof parsed.close === "string" ? parsed.close : "",
      full_script: parsed.full_script,
    }
  } catch (err) {
    logger.error(`[phone-script-drafter] JSON parse failed:`, err)
    return null
  }
}

export async function draftAndSaveScript(prospectId: string): Promise<boolean> {
  const script = await draftPhoneScriptForProspect(prospectId)

  if (!script) {
    await prisma.dealerProspect.update({
      where: { id: prospectId },
      data: {
        scriptAttempts: { increment: 1 },
      },
    })
    return false
  }

  await prisma.dealerProspect.update({
    where: { id: prospectId },
    data: {
      outreachScript: script.full_script,
      scriptDraftedAt: new Date(),
      scriptedAt: new Date(),
      scriptAttempts: { increment: 1 },
      status: "SCRIPTED",
    },
  })

  return true
}
