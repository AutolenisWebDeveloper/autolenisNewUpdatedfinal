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

import { logger } from "@/lib/logger";
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

// Provenance for the contact identity (Internet Sales Manager). Mirrors the email
// taxonomy but tracked separately so a found-contact-without-email is still stored.
export type ContactConfidence = "high" | "medium" | "low" | "none"

export type ContactSource =
  | "gemini_search_high_confidence"
  | "gemini_search_medium_confidence"
  | "gemini_search_inferred"
  | "gemini_maps_discovery"
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
  /** Direct phone for the contact, when surfaced. */
  contactPhone: string | null
  sourceUrl: string | null
  confidence: EmailConfidence
  source: EmailSource | null
  /** Contact-identity provenance — tracked separately from the email. */
  contactConfidence: ContactConfidence
  contactSource: ContactSource | null
  /** Source URL the contact identity was found on (staff page / LinkedIn). */
  contactSourceUrl: string | null
  /** True when the call was short-circuited by the 30-day recency guard. */
  skipped?: boolean
}

export interface GeminiResponse {
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

// Same mapping for the contact identity. "none" → null (no real contact found).
function contactConfidenceToSource(
  confidence: ContactConfidence,
): ContactSource | null {
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
  return `Your PRIMARY objective is to identify the Internet Sales Manager (ISM) at a
car dealership — their real name, exact title, direct phone, and the page you
found them on. Their email is a secondary field: capture it if you can verify it,
but a found ISM with NO email is still a valuable, valid result.

Dealership: ${input.dealerName}
Location: ${input.city}, ${input.state}
Website: ${input.website ?? "unknown"}

Use Google Search. Look at the dealership's staff/team/meet-our-team page,
LinkedIn, and other public sources. Contact priority (capture whoever you find,
highest available first):
1. Internet Sales Manager / Internet Director (highest priority)
2. Internet Sales Department contact
3. Sales Manager
4. General Manager (only if none of the above)
5. Generic sales@ / info@ (email only, last resort — no named person)

DO NOT fabricate. If you cannot find a real person, return null for the contact
fields. If you cannot verify a real email, return null email — never invent one.
Returning a real NAME with a null EMAIL is correct and expected.

Return ONLY this JSON, no markdown, no commentary:
{
  "contactName": "string or null",
  "contactTitle": "string or null",
  "contactPhone": "string or null",
  "contactSourceUrl": "string or null",
  "contactConfidence": "high" | "medium" | "low" | "none",
  "email": "string or null",
  "sourceUrl": "string or null",
  "confidence": "high" | "medium" | "low" | "none"
}

contactConfidence levels (for the PERSON):
- "high": Named person with a verified ISM/Internet/Sales title from a primary source (staff page, LinkedIn)
- "medium": Named person but title or source is less certain
- "low": Name inferred from a secondary mention
- "none": No real named person found

confidence levels (for the EMAIL):
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
      logger.warn(
        `[phase-4b1] Gemini retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.substring(0, 120)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  throw lastError
}

// ─── Response parsing with coercion at the LLM boundary ──────────────────────
export type ParsedEnrichment = Omit<
  EmailEnrichmentResult,
  "source" | "contactSource" | "skipped"
>

export function parseEnrichment(data: GeminiResponse): ParsedEnrichment {
  const content = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("") ?? ""

  const empty: ParsedEnrichment = {
    email: null,
    contactName: null,
    contactTitle: null,
    contactPhone: null,
    sourceUrl: null,
    confidence: "none",
    contactConfidence: "none",
    contactSourceUrl: null,
  }

  if (!content.trim()) {
    logger.warn("[phase-4b1] Gemini returned empty content")
    return empty
  }

  let parsed: Record<string, unknown>
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.warn(
        `[phase-4b1] No JSON in Gemini response: ${content.substring(0, 160)}`,
      )
      return empty
    }
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch (err) {
    logger.warn(
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

  const toLevel = (v: unknown): "high" | "medium" | "low" | "none" => {
    const raw = str(v)?.toLowerCase()
    return raw === "high" || raw === "medium" || raw === "low" ? raw : "none"
  }

  const confidence: EmailConfidence = toLevel(parsed.confidence)

  const rawEmail = str(parsed.email)
  // Two-tier validation: a real email AND a non-"none" confidence. If the model
  // says "none" but still emits an address, we distrust it and drop the email.
  const email =
    rawEmail && confidence !== "none" && EMAIL_REGEX.test(rawEmail)
      ? rawEmail.toLowerCase()
      : null

  if (rawEmail && !email) {
    logger.warn(
      `[phase-4b1] Dropped invalid/low-trust email "${rawEmail}" (confidence=${confidence})`,
    )
  }

  // Prefer the model's stated sourceUrl, else fall back to the first grounding
  // chunk's web URI.
  const groundingUri =
    data.candidates?.[0]?.groundingMetadata?.groundingChunks?.find(
      (c) => c.web?.uri,
    )?.web?.uri ?? null

  // ── Contact identity — parsed INDEPENDENTLY of the email. A named person with
  // a non-"none" contactConfidence is a valid result even with no email. ──
  const contactName = str(parsed.contactName)
  // Only trust the contact if a real name is present; never let a stray
  // confidence label conjure a contact out of nothing.
  const contactConfidence: ContactConfidence = contactName
    ? toLevel(parsed.contactConfidence)
    : "none"
  const contactSourceUrl =
    str(parsed.contactSourceUrl) ?? str(parsed.sourceUrl) ?? groundingUri

  return {
    email,
    contactName: contactConfidence === "none" ? null : contactName,
    contactTitle: contactConfidence === "none" ? null : str(parsed.contactTitle),
    contactPhone: contactConfidence === "none" ? null : str(parsed.contactPhone),
    sourceUrl: str(parsed.sourceUrl) ?? groundingUri,
    // If the email got dropped during validation, downgrade confidence to none.
    confidence: email ? confidence : "none",
    contactConfidence,
    contactSourceUrl: contactConfidence === "none" ? null : contactSourceUrl,
  }
}

// Fields written to dealer_prospects after an enrichment pass.
export interface EnrichmentPersistData {
  emailEnrichedAt: Date
  contactEnrichedAt: Date
  email?: string
  emailSource?: string
  contactName?: string | null
  contactTitle?: string | null
  contactPhone?: string | null
  contactSource?: string
  contactConfidence?: string
  contactSourceUrl?: string | null
}

/**
 * Pure builder for the persisted update payload. This is where the WO-3
 * decoupling lives: the email block and the contact block are independent, so a
 * found ISM with NO verifiable email still writes the contact fields. Always
 * advances both *EnrichedAt timestamps (recency guard). Exported for unit tests.
 */
export function buildPersistData(
  parsed: ParsedEnrichment,
  now: Date,
): EnrichmentPersistData {
  const source = confidenceToSource(parsed.confidence)
  const contactSource = contactConfidenceToSource(parsed.contactConfidence)

  const data: EnrichmentPersistData = {
    emailEnrichedAt: now,
    contactEnrichedAt: now,
  }

  // Email block — only when a validated address exists.
  if (parsed.email && source) {
    data.email = parsed.email
    data.emailSource = source
  }

  // Contact block — INDEPENDENT of the email. A named ISM with no email persists.
  if (parsed.contactName && contactSource) {
    data.contactName = parsed.contactName
    data.contactTitle = parsed.contactTitle
    data.contactPhone = parsed.contactPhone
    data.contactSource = contactSource
    data.contactConfidence = parsed.contactConfidence
    data.contactSourceUrl = parsed.contactSourceUrl
  }

  return data
}

// Shared empty result — no email AND no contact found.
function emptyResult(
  extra: Partial<EmailEnrichmentResult> = {},
): EmailEnrichmentResult {
  return {
    email: null,
    contactName: null,
    contactTitle: null,
    contactPhone: null,
    sourceUrl: null,
    confidence: "none",
    source: null,
    contactConfidence: "none",
    contactSource: null,
    contactSourceUrl: null,
    ...extra,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Enrich a single dealer prospect with the Internet Sales Manager contact and,
 * when verifiable, their email — then persist the result.
 *
 * Always stamps `emailEnrichedAt` and `contactEnrichedAt` (so the 30-day guard
 * advances on every attempt, success or not). The contact identity is persisted
 * INDEPENDENTLY of the email: a found ISM with no verifiable email is still
 * imported. A "none" result never overwrites an existing value.
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
      logger.info(
        `[phase-4b1] Skipping ${input.dealerProspectId} — enriched ${existing.emailEnrichedAt.toISOString()} (<30d)`,
      )
      return emptyResult({ skipped: true })
    }
  }

  const now = new Date()
  let parsed: ParsedEnrichment

  try {
    const data = await callGeminiWithRetry(buildPrompt(input))
    parsed = parseEnrichment(data)
  } catch (err) {
    // Stamp the attempt timestamp even on hard failure so we don't hammer a
    // persistently-failing dealer on every backfill run.
    logger.error(
      `[phase-4b1] Gemini enrichment failed for ${input.dealerProspectId}: ${err instanceof Error ? err.message : String(err)}`,
    )
    await prisma.dealerProspect
      .update({
        where: { id: input.dealerProspectId },
        data: { emailEnrichedAt: now, contactEnrichedAt: now },
      })
      .catch((updateErr) => {
        logger.error(
          `[phase-4b1] Failed to stamp enrichment timestamps for ${input.dealerProspectId}:`,
          updateErr,
        )
      })
    return emptyResult()
  }

  const source = confidenceToSource(parsed.confidence)
  const contactSource = contactConfidenceToSource(parsed.contactConfidence)

  // Persist via the pure builder so the decoupling is unit-tested in isolation.
  const data = buildPersistData(parsed, now)

  try {
    await prisma.dealerProspect.update({
      where: { id: input.dealerProspectId },
      data,
    })
  } catch (err) {
    logger.error(
      `[phase-4b1] Failed to persist enrichment for ${input.dealerProspectId}:`,
      err,
    )
  }

  logger.info(
    `[phase-4b1] Enriched ${input.dealerName} (${input.dealerProspectId}) → ` +
      `email=${parsed.email ?? "none"} [${source ?? "—"}], ` +
      `contact=${parsed.contactName ?? "none"} [${contactSource ?? "—"}]`,
  )

  return { ...parsed, source, contactSource }
}
