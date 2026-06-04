// AutoLenis Phase 4B-1 — Dealer Email Enrichment
//
// Finds the Internet Sales Manager (or best-available) email address for a
// dealer prospect using Gemini 2.5 Flash with Google Search grounding, then
// stores the result on the dealer_prospects row.
//
// Mirrors the REST + grounding pattern already proven in
// lib/services/acquisition/gemini-maps.service.ts (which uses Maps grounding);
// this service uses Search grounding instead.
//
// Caching: enrichment is 1:1 with a dealer_prospects row, so the row's own
// `emailEnrichedAt` timestamp doubles as the cache key — we skip any prospect
// enriched within the last 30 days unless `force` is passed. This avoids a
// redundant separate cache table keyed on the same natural key.

import { prisma } from "@/lib/prisma"

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

// Skip re-enriching a prospect attempted within this window (unless forced).
const ENRICHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Validate a candidate email before we ever store it. Intentionally permissive
// on the local/domain parts but rejects whitespace and obviously-broken values
// (e.g. "info at dealer dot com").
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EmailConfidence = "high" | "medium" | "low" | "none"

export type EmailSource =
  | "gemini_search_high_confidence"
  | "gemini_search_medium_confidence"
  | "gemini_search_inferred"
  | "fallback_info_email"
  | "manual"

export interface EmailEnrichmentInput {
  dealerProspectId: string
  dealerName: string
  city: string
  state: string
  website?: string | null
  /** Bypass the 30-day recency guard (used by the manual "Re-Enrich" action). */
  force?: boolean
}

export interface EmailEnrichmentResult {
  email: string | null
  contactName: string | null
  contactTitle: string | null
  sourceUrl: string | null
  confidence: EmailConfidence
  source: EmailSource | null
  /** True when the call was short-circuited by the 30-day recency guard. */
  skipped?: boolean
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string }
      }>
    }
  }>
}

// Map Gemini's confidence label onto the persisted emailSource taxonomy.
// "none" maps to null — we never store a fabricated address.
function confidenceToSource(confidence: EmailConfidence): EmailSource | null {
  switch (confidence) {
    case "high":
      return "gemini_search_high_confidence"
    case "medium":
      return "gemini_search_medium_confidence"
    case "low":
      return "gemini_search_inferred"
    case "none":
    default:
      return null
  }
}

function buildPrompt(input: EmailEnrichmentInput): string {
  return `You are finding the Internet Sales Manager email address for a car dealership.

Dealership: ${input.dealerName}
Location: ${input.city}, ${input.state}
Website: ${input.website ?? "unknown"}

Use Google Search to find the email address. Search priority:
1. Internet Sales Manager email (highest priority)
2. Internet Sales Department email
3. Sales Manager email
4. General Manager email (only if above unavailable)
5. Generic sales@ or info@ email (last resort)

DO NOT make up emails. If you cannot find a real email, return null and set confidence to "none".

Return ONLY this JSON, no markdown, no commentary:
{
  "email": "string or null",
  "contactName": "string or null",
  "contactTitle": "string or null",
  "sourceUrl": "string or null",
  "confidence": "high" | "medium" | "low" | "none"
}

confidence levels:
- "high": Found direct named email (firstname.lastname@dealership.com)
- "medium": Found role email (internetsales@dealership.com)
- "low": Inferred from pattern, not verified
- "none": Could not find any email`
}

// ─── Gemini REST call ────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured")
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Google Search grounding — lets Gemini verify a real, current address.
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.1, // deterministic
        maxOutputTokens: 1024,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    // Surface the status code in the message so the retry wrapper can match it.
    throw new Error(`Gemini HTTP ${response.status}: ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as GeminiResponse
}

// ─── Retry wrapper with exponential backoff ──────────────────────────────────
// Gemini returns 429 when rate-limited and 503 when capacity is exhausted.
// Retry only those transient errors; surface everything else immediately.
async function callGeminiWithRetry(prompt: string): Promise<GeminiResponse> {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGemini(prompt)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)

      if (!message.includes("429") && !message.includes("503")) {
        throw err
      }
      if (attempt === maxAttempts - 1) {
        throw err
      }

      // Exponential backoff: 8s, 16s, 32s
      const backoffMs = Math.min(8000 * Math.pow(2, attempt), 32000)
      console.warn(
        `[phase-4b1] Gemini retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.substring(0, 120)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  throw lastError
}

// ─── Response parsing with coercion at the LLM boundary ──────────────────────
function parseEnrichment(
  data: GeminiResponse,
): Omit<EmailEnrichmentResult, "source" | "skipped"> {
  const content = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("") ?? ""

  const empty: Omit<EmailEnrichmentResult, "source" | "skipped"> = {
    email: null,
    contactName: null,
    contactTitle: null,
    sourceUrl: null,
    confidence: "none",
  }

  if (!content.trim()) {
    console.warn("[phase-4b1] Gemini returned empty content")
    return empty
  }

  let parsed: Record<string, unknown>
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(
        `[phase-4b1] No JSON in Gemini response: ${content.substring(0, 160)}`,
      )
      return empty
    }
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch (err) {
    console.warn(
      `[phase-4b1] JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return empty
  }

  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null
    const trimmed = v.trim()
    if (!trimmed || trimmed.toLowerCase() === "null") return null
    return trimmed
  }

  const rawConfidence = str(parsed.confidence)?.toLowerCase()
  const confidence: EmailConfidence =
    rawConfidence === "high" ||
    rawConfidence === "medium" ||
    rawConfidence === "low"
      ? rawConfidence
      : "none"

  const rawEmail = str(parsed.email)
  // Two-tier validation: a real email AND a non-"none" confidence. If the model
  // says "none" but still emits an address, we distrust it and drop the email.
  const email =
    rawEmail && confidence !== "none" && EMAIL_REGEX.test(rawEmail)
      ? rawEmail.toLowerCase()
      : null

  if (rawEmail && !email) {
    console.warn(
      `[phase-4b1] Dropped invalid/low-trust email "${rawEmail}" (confidence=${confidence})`,
    )
  }

  // Prefer the model's stated sourceUrl, else fall back to the first grounding
  // chunk's web URI.
  const groundingUri =
    data.candidates?.[0]?.groundingMetadata?.groundingChunks?.find(
      (c) => c.web?.uri,
    )?.web?.uri ?? null

  return {
    email,
    contactName: str(parsed.contactName),
    contactTitle: str(parsed.contactTitle),
    sourceUrl: str(parsed.sourceUrl) ?? groundingUri,
    // If the email got dropped during validation, downgrade confidence to none.
    confidence: email ? confidence : "none",
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Enrich a single dealer prospect with an email address and persist the result.
 *
 * Always stamps `emailEnrichedAt` (so the 30-day guard advances on every
 * attempt, success or not). Only writes `email`/`emailSource` when a real
 * address is found — a "none" result never overwrites an existing email.
 */
export async function enrichDealerEmail(
  input: EmailEnrichmentInput,
): Promise<EmailEnrichmentResult> {
  // Recency guard — skip if we already tried within the TTL window.
  if (!input.force) {
    const existing = await prisma.dealerProspect.findUnique({
      where: { id: input.dealerProspectId },
      select: { emailEnrichedAt: true },
    })
    if (
      existing?.emailEnrichedAt &&
      Date.now() - existing.emailEnrichedAt.getTime() < ENRICHMENT_TTL_MS
    ) {
      console.log(
        `[phase-4b1] Skipping ${input.dealerProspectId} — enriched ${existing.emailEnrichedAt.toISOString()} (<30d)`,
      )
      return {
        email: null,
        contactName: null,
        contactTitle: null,
        sourceUrl: null,
        confidence: "none",
        source: null,
        skipped: true,
      }
    }
  }

  const now = new Date()
  let parsed: Omit<EmailEnrichmentResult, "source" | "skipped">

  try {
    const data = await callGeminiWithRetry(buildPrompt(input))
    parsed = parseEnrichment(data)
  } catch (err) {
    // Stamp the attempt timestamp even on hard failure so we don't hammer a
    // persistently-failing dealer on every backfill run.
    console.error(
      `[phase-4b1] Gemini enrichment failed for ${input.dealerProspectId}: ${err instanceof Error ? err.message : String(err)}`,
    )
    await prisma.dealerProspect
      .update({
        where: { id: input.dealerProspectId },
        data: { emailEnrichedAt: now },
      })
      .catch((updateErr) => {
        console.error(
          `[phase-4b1] Failed to stamp emailEnrichedAt for ${input.dealerProspectId}:`,
          updateErr,
        )
      })
    return {
      email: null,
      contactName: null,
      contactTitle: null,
      sourceUrl: null,
      confidence: "none",
      source: null,
    }
  }

  const source = confidenceToSource(parsed.confidence)

  // Persist. Always advance emailEnrichedAt; only set email/source when we have
  // a validated address.
  const data: {
    emailEnrichedAt: Date
    email?: string
    emailSource?: string
  } = { emailEnrichedAt: now }
  if (parsed.email && source) {
    data.email = parsed.email
    data.emailSource = source
  }

  try {
    await prisma.dealerProspect.update({
      where: { id: input.dealerProspectId },
      data,
    })
  } catch (err) {
    console.error(
      `[phase-4b1] Failed to persist enrichment for ${input.dealerProspectId}:`,
      err,
    )
  }

  if (parsed.email) {
    console.log(
      `[phase-4b1] Enriched ${input.dealerName} (${input.dealerProspectId}) → ${parsed.email} [${source}]`,
    )
  } else {
    console.log(
      `[phase-4b1] No email found for ${input.dealerName} (${input.dealerProspectId})`,
    )
  }

  return { ...parsed, source }
}
