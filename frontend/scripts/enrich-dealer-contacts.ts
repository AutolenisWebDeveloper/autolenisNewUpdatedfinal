#!/usr/bin/env tsx
// AutoLenis — Dealer Contact Enrichment
//
// Finds the Internet Sales Manager (or best-available contact: BDC Manager,
// Fleet Manager, etc.) for every DealerProspect that is missing a contactName
// OR contactTitle OR email, using Gemini 2.5 Flash with Google Search grounding.
//
// Mirrors the REST + Search-grounding pattern proven in
// lib/services/dealer-recruitment/email-enrichment.service.ts. Unlike that
// service (which is keyed on email), this script's focus is the *person*:
// it backfills contactName / contactTitle and, when a real public address is
// found, the email too.
//
// Write-back is conservative: it never overwrites a contactName / contactTitle
// / email that is already set, and it never stores a fabricated email.
//
// Usage:
//   pnpm enrich:contacts                 # all prospects missing contact info
//   pnpm enrich:contacts --limit 50      # only the first 50
//   pnpm enrich:contacts --brand Toyota  # only Toyota dealers
//   pnpm enrich:contacts --state TX      # only Texas dealers
//   pnpm enrich:contacts --force         # re-enrich even if contactName set
//   pnpm enrich:contacts --dry-run       # print, do not write to the DB

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

// Gemini rate-limit spacing between calls.
const CALL_DELAY_MS = 1500

// Validate a candidate email before we ever store it. Permissive on the
// local/domain parts but rejects whitespace and obviously-broken values.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Confidence = "high" | "medium" | "low"

interface ContactResult {
  contactName: string | null
  contactTitle: string | null
  contactEmail: string | null
  confidence: Confidence
  source: string | null
  notes: string | null
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

interface Dealer {
  id: string
  name: string
  city: string | null
  state: string | null
  website: string | null
  contactName: string | null
  contactTitle: string | null
  email: string | null
  brand: string | null
  status: string
}

// ─── CLI args ─────────────────────────────────────────────────────────────────
interface CliArgs {
  limit: number | null
  dryRun: boolean
  force: boolean
  brand: string | null
  state: string | null
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: null,
    dryRun: false,
    force: false,
    brand: null,
    state: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // Support both "--flag value" and "--flag=value" forms.
    const eq = (flag: string): string | null => {
      if (a === flag) return argv[++i] ?? null
      if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1)
      return null
    }

    if (a === "--dry-run") {
      args.dryRun = true
    } else if (a === "--force") {
      args.force = true
    } else {
      const limit = eq("--limit")
      if (limit !== null) {
        const n = parseInt(limit, 10)
        if (Number.isFinite(n) && n > 0) args.limit = n
        continue
      }
      const brand = eq("--brand")
      if (brand !== null) {
        args.brand = brand
        continue
      }
      const state = eq("--state")
      if (state !== null) {
        args.state = state.toUpperCase()
        continue
      }
    }
  }

  return args
}

// ─── Gemini prompt ──────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are a research assistant helping find publicly listed
contact information for automotive dealerships.
You have access to Google Search. Use it to find the
Internet Sales Manager, BDC Manager, or Fleet Manager
at the specified dealership.
Return ONLY a JSON object with no markdown, no explanation.
All fields must be present. Use null for any field not found.`

function buildUserPrompt(dealer: Dealer): string {
  return `Search Google for the Internet Sales Manager or BDC Manager
at this dealership:

Dealership: ${dealer.name}
City: ${dealer.city ?? "unknown"}
State: ${dealer.state ?? "unknown"}
Website: ${dealer.website ?? "unknown"}

Find their:
1. Full name
2. Exact job title
3. Direct email address (only if publicly listed on their
   website, Google Business, LinkedIn, Cars.com, or
   similar public directory — do NOT guess or generate email)
4. Where you found this information

Return this exact JSON structure:
{
  "contactName": "First Last or null",
  "contactTitle": "Internet Sales Manager or null",
  "contactEmail": "email@dealer.com or null",
  "confidence": "high or medium or low",
  "source": "where found or null",
  "notes": "any relevant context or null"
}

Rules:
- contactEmail must be a real publicly listed address.
  Set to null if you cannot find one with certainty.
- confidence = high: found name + title on official source
- confidence = medium: found name or title, not both
- confidence = low: could not find a specific person`
}

// ─── Gemini REST call ───────────────────────────────────────────────────────
async function callGemini(dealer: Dealer): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured")
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      contents: [{ role: "user", parts: [{ text: buildUserPrompt(dealer) }] }],
      // Google Search grounding — lets Gemini find real, current contacts.
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.1, // deterministic
        maxOutputTokens: 1024,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Gemini HTTP ${response.status}: ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as GeminiResponse
}

// ─── Retry wrapper with exponential backoff ─────────────────────────────────
// Retry only transient 429 (rate-limited) / 503 (capacity) errors.
async function callGeminiWithRetry(dealer: Dealer): Promise<GeminiResponse> {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGemini(dealer)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes("429") && !message.includes("503")) throw err
      if (attempt === maxAttempts - 1) throw err

      // Exponential backoff: 8s, 16s, 32s
      const backoffMs = Math.min(8000 * Math.pow(2, attempt), 32000)
      console.warn(
        `[enrich-contacts] Gemini retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.substring(0, 120)}`,
      )
      await sleep(backoffMs)
    }
  }

  throw lastError
}

// ─── Response parsing with coercion at the LLM boundary ─────────────────────
function parseContact(data: GeminiResponse): ContactResult {
  const empty: ContactResult = {
    contactName: null,
    contactTitle: null,
    contactEmail: null,
    confidence: "low",
    source: null,
    notes: null,
  }

  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""

  if (!content.trim()) {
    console.warn("[enrich-contacts] Gemini returned empty content")
    return empty
  }

  let parsed: Record<string, unknown>
  try {
    // Strip markdown fences if present, then extract the JSON object.
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(
        `[enrich-contacts] No JSON in Gemini response: ${content.substring(0, 160)}`,
      )
      return empty
    }
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch (err) {
    console.warn(
      `[enrich-contacts] JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
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
  const confidence: Confidence =
    rawConfidence === "high" || rawConfidence === "medium" ? rawConfidence : "low"

  // Validate the email: must look like an address. Never trust a fabricated one.
  const rawEmail = str(parsed.contactEmail)
  const contactEmail =
    rawEmail && EMAIL_REGEX.test(rawEmail) ? rawEmail.toLowerCase() : null
  if (rawEmail && !contactEmail) {
    console.warn(`[enrich-contacts] Dropped invalid email "${rawEmail}"`)
  }

  // Prefer the model's stated source, else fall back to the first grounding URI.
  const groundingUri =
    data.candidates?.[0]?.groundingMetadata?.groundingChunks?.find(
      (c) => c.web?.uri,
    )?.web?.uri ?? null

  return {
    contactName: str(parsed.contactName),
    contactTitle: str(parsed.contactTitle),
    contactEmail,
    confidence,
    source: str(parsed.source) ?? groundingUri,
    notes: str(parsed.notes),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function locationLabel(dealer: Dealer): string {
  return [dealer.city, dealer.state].filter(Boolean).join(" ")
}

// ─── Mock data — used only when DATABASE_URL is unavailable for a dry-run ────
const MOCK_DEALERS: Dealer[] = [
  {
    id: "mock-1",
    name: "Sunshine Toyota",
    city: "Austin",
    state: "TX",
    website: "https://sunshinetoyota.example.com",
    contactName: null,
    contactTitle: null,
    email: null,
    brand: "Toyota",
    status: "DISCOVERED",
  },
  {
    id: "mock-2",
    name: "Bay Area Honda",
    city: "San Jose",
    state: "CA",
    website: null,
    contactName: null,
    contactTitle: null,
    email: null,
    brand: "Honda",
    status: "DISCOVERED",
  },
  {
    id: "mock-3",
    name: "Mountain Ford",
    city: "Denver",
    state: "CO",
    website: "https://mountainford.example.com",
    contactName: null,
    contactTitle: null,
    email: null,
    brand: "Ford",
    status: "DISCOVERED",
  },
]

// ─── Dealer query ────────────────────────────────────────────────────────────
async function loadDealers(args: CliArgs): Promise<Dealer[]> {
  const where: Prisma.DealerProspectWhereInput = {
    // Never re-engage dead prospects.
    status: { not: "DEAD" },
  }

  // Default: only prospects missing some contact info. --force: everyone.
  if (!args.force) {
    where.OR = [{ contactName: null }, { contactTitle: null }, { email: null }]
  }
  if (args.brand) {
    where.brand = { equals: args.brand, mode: "insensitive" }
  }
  if (args.state) {
    where.state = { equals: args.state, mode: "insensitive" }
  }

  return prisma.dealerProspect.findMany({
    where,
    orderBy: { createdAt: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      website: true,
      contactName: true,
      contactTitle: true,
      email: true,
      brand: true,
      status: true,
    },
  })
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(
    `[enrich-contacts] starting (limit=${args.limit ?? "all"}, dryRun=${args.dryRun}, force=${args.force}, brand=${args.brand ?? "any"}, state=${args.state ?? "any"})`,
  )

  // Load dealers. If the DB is unavailable during a dry-run, fall back to mocks.
  let dealers: Dealer[]
  let usingMocks = false
  try {
    dealers = await loadDealers(args)
  } catch (err) {
    if (args.dryRun) {
      console.warn(
        `[enrich-contacts] DB unavailable (${err instanceof Error ? err.message : String(err)}) — using mock dealers for dry-run`,
      )
      usingMocks = true
      dealers = args.limit ? MOCK_DEALERS.slice(0, args.limit) : MOCK_DEALERS
    } else {
      throw err
    }
  }

  console.log(`[enrich-contacts] found ${dealers.length} dealers to process`)

  const stats = {
    processed: 0,
    high: 0,
    medium: 0,
    low: 0,
    errors: 0,
    emails: 0,
  }

  for (let i = 0; i < dealers.length; i++) {
    const dealer = dealers[i]
    stats.processed++

    console.log(
      `[enrich-contacts] Processing [${i + 1}/${dealers.length}]: ${dealer.name}, ${locationLabel(dealer)}`,
    )

    try {
      const data = await callGeminiWithRetry(dealer)
      const result = parseContact(data)

      // ── Write-back logic ──────────────────────────────────────────────────
      if (result.confidence === "low") {
        stats.low++
        console.log(
          `[enrich-contacts] LOW CONFIDENCE: ${dealer.name} — skipping`,
        )
        console.log(`⏭️  LOW: ${dealer.name} — no confident match found`)
      } else {
        // high or medium → build a conditional update that never overwrites
        // an already-set value, and never stores a null email.
        const update: Prisma.DealerProspectUpdateInput = {}

        if (!dealer.contactName && result.contactName) {
          update.contactName = result.contactName
        }
        if (!dealer.contactTitle && result.contactTitle) {
          update.contactTitle = result.contactTitle
        }
        if (!dealer.email && result.contactEmail) {
          update.email = result.contactEmail
        }

        const wroteEmail = update.email != null
        // Only stamp source/timestamp when we actually have something to write.
        const hasContactWrite =
          update.contactName != null || update.contactTitle != null || wroteEmail
        if (hasContactWrite) {
          update.emailSource = "gemini_contact_search"
          update.emailEnrichedAt = new Date()
        }

        if (wroteEmail) stats.emails++
        if (result.confidence === "high") stats.high++
        else stats.medium++

        if (args.dryRun) {
          console.log(
            `[enrich-contacts] DRY-RUN would update ${dealer.id}: ${JSON.stringify(update)}`,
          )
        } else if (usingMocks) {
          console.log(
            `[enrich-contacts] (mock) would update ${dealer.id}: ${JSON.stringify(update)}`,
          )
        } else if (hasContactWrite) {
          await prisma.dealerProspect.update({
            where: { id: dealer.id },
            data: update,
          })
        }

        const emailLabel = result.contactEmail ?? "no email"
        if (result.confidence === "high") {
          console.log(
            `✅ HIGH: ${dealer.name} — ${result.contactName ?? "?"} (${result.contactTitle ?? "?"}) ${emailLabel}`,
          )
        } else {
          console.log(
            `⚠️  MED: ${dealer.name} — ${result.contactName ?? "?"} (${result.contactTitle ?? "?"})`,
          )
        }
      }
    } catch (err) {
      stats.errors++
      const message = err instanceof Error ? err.message : String(err)
      console.log(`❌ ERR: ${dealer.name} — ${message}`)
    }

    // Space out calls to respect Gemini rate limits.
    if (i < dealers.length - 1) {
      await sleep(CALL_DELAY_MS)
    }
  }

  // ── Final summary ───────────────────────────────────────────────────────
  console.log("[enrich-contacts] ━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("[enrich-contacts] Complete")
  console.log(`[enrich-contacts] Processed:  ${stats.processed} dealers`)
  console.log(`[enrich-contacts] High confidence: ${stats.high} (updated)`)
  console.log(`[enrich-contacts] Medium confidence: ${stats.medium} (updated)`)
  console.log(`[enrich-contacts] Low confidence: ${stats.low} (skipped)`)
  console.log(`[enrich-contacts] Errors: ${stats.errors}`)
  console.log(`[enrich-contacts] Emails found: ${stats.emails}`)
  console.log("[enrich-contacts] ━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("[enrich-contacts] Run pnpm amips:sync-dealers to sync")
  console.log("[enrich-contacts] to dealer_intelligence")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
