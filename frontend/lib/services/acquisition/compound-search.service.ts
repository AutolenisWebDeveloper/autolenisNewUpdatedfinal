import { prisma } from "@/lib/prisma"
import {
  discoverDealersViaGeminiMaps,
  enrichMarketViaGemini,
  type GroundedLocalDealer,
} from "./gemini-maps.service"

// Cache TTLs
const MARKET_ENRICHMENT_TTL_HOURS = 24
const DEALER_DISCOVERY_TTL_HOURS = 24 * 7  // 7 days

// Groq Compound endpoints
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const GROQ_COMPOUND_MODEL = "groq/compound"
const GROQ_COMPOUND_MINI_MODEL = "groq/compound-mini"

// ───────────────────────────────────────────────────
// CACHE HELPERS
// ───────────────────────────────────────────────────

function buildCacheKey(
  searchType: "market_enrichment" | "dealer_discovery",
  parts: {
    zip?: string | null
    make?: string | null
    model?: string | null
    radiusMiles?: number
  }
): string {
  return `${searchType}:${parts.zip ?? "any"}:${parts.make ?? "any"}:${parts.model ?? "any"}:${parts.radiusMiles ?? 25}`
}

async function getCached(cacheKey: string): Promise<unknown | null> {
  try {
    const cached = await prisma.searchCache.findUnique({
      where: { cacheKey },
    })
    if (!cached) return null
    if (cached.expiresAt < new Date()) {
      // Expired — let caller refresh
      return null
    }
    return cached.result
  } catch (err) {
    console.error("[compound-search] Cache lookup failed:", err)
    return null
  }
}

async function setCached(
  cacheKey: string,
  searchType: "market_enrichment" | "dealer_discovery",
  parts: {
    zip?: string | null
    make?: string | null
    model?: string | null
    radiusMiles?: number
  },
  result: unknown,
  ttlHours: number
): Promise<void> {
  try {
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + ttlHours)

    await prisma.searchCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        searchType,
        zip: parts.zip ?? null,
        make: parts.make ?? null,
        model: parts.model ?? null,
        radiusMiles: parts.radiusMiles ?? null,
        result: result as object,
        expiresAt,
      },
      update: {
        result: result as object,
        expiresAt,
      },
    })
  } catch (err) {
    console.error("[compound-search] Cache write failed:", err)
  }
}

// ───────────────────────────────────────────────────
// COMPOUND CALL HELPER
// ───────────────────────────────────────────────────

interface CompoundResult {
  content: string
  searchResults: Array<{
    title: string
    url: string
    content: string
    score?: number
  }>
}

async function callCompound(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: {
    enabledTools?: string[]
    maxTokens?: number
  } = {}
): Promise<CompoundResult | null> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.error("[compound-search] GROQ_API_KEY not configured")
    return null
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: options.maxTokens ?? 3000,
        compound_custom: {
          tools: {
            enabled_tools: options.enabledTools ?? ["web_search"],
          },
        },
        search_settings: {
          country: "united states",
        },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error(`[compound-search] ${model} failed:`, response.status, errBody)
      return null
    }

    const data = await response.json()
    const message = data.choices?.[0]?.message
    const content: string = message?.content ?? ""

    // Extract search results from executed_tools
    const executedTools = message?.executed_tools as Array<{
      search_results?: { results?: Array<{ title: string; url: string; content: string; score?: number }> }
    }> | undefined

    const searchResults = executedTools?.[0]?.search_results?.results ?? []

    return {
      content,
      searchResults,
    }
  } catch (err) {
    console.error("[compound-search] Request failed:", err)
    return null
  }
}

// ───────────────────────────────────────────────────
// MARKET ENRICHMENT
// ───────────────────────────────────────────────────

export interface MarketEnrichment {
  // Legacy fields — consumed by the unified intake service (do-not-touch).
  msrpEstimate: number | null
  avgPaidPrice: number | null
  typicalMarkup: string | null
  goodDealTarget: number | null
  notes: string
  // Change 1 — web-grounded market context. Optional so older cached records
  // (and the Groq fallback path) remain valid without these fields.
  localDealers?: GroundedLocalDealer[]
  regionalPricingInsight?: string | null
  msrpRange?: { low: number | null; high: number | null } | null
  currentIncentives?: string | null
  demandLevel?: "high" | "normal" | "low" | null
  supplyNote?: string | null
  searchGrounded?: boolean
  dataAsOf?: string | null
}

const MARKET_ENRICHMENT_SYSTEM_PROMPT = `You are an automotive market research analyst. Your job is to find real pricing data for specific vehicles in specific regions of the United States.

Output a JSON object with these fields:
  - msrpEstimate: integer USD (manufacturer suggested retail price for this year/make/model/trim)
  - avgPaidPrice: integer USD (what buyers in this area are actually paying)
  - typicalMarkup: short string (e.g., "$0-$2000 over invoice", "MSRP to $3K markup")
  - goodDealTarget: integer USD (a realistic target a savvy buyer should aim for)
  - notes: 1-2 sentence summary with key market context

Use only real, current data. If you cannot find reliable data, return null for that field. Output JSON only — no commentary.`

export async function enrichMarketData(params: {
  vehicleType: string | null
  make: string
  model: string
  trim: string | null
  yearMin: number | null
  yearMax: number | null
  zip: string
}): Promise<MarketEnrichment | null> {
  const cacheKey = buildCacheKey("market_enrichment", {
    zip: params.zip,
    make: params.make,
    model: params.model,
  })

  // Check cache
  const cached = await getCached(cacheKey)
  if (cached) {
    console.log("[compound-search] Market enrichment cache hit:", cacheKey)
    return cached as MarketEnrichment
  }

  console.log("[compound-search] Market enrichment cache MISS:", cacheKey)

  // Change 1 — try Gemini 2.5 Flash + Google Search grounding first. It returns
  // a superset of the legacy fields plus richer web-grounded market context.
  try {
    const grounded = await enrichMarketViaGemini(params)
    if (grounded) {
      await setCached(
        cacheKey,
        "market_enrichment",
        { zip: params.zip, make: params.make, model: params.model },
        grounded,
        MARKET_ENRICHMENT_TTL_HOURS
      )
      return grounded
    }
    console.warn(
      "[change-1] Gemini grounding unavailable — falling back to Groq Compound"
    )
  } catch (err) {
    console.error(
      "[change-1] Gemini grounding threw — falling back to Groq Compound:",
      err
    )
  }

  // Fallback — Groq Compound web_search (the pre-Change-1 path).
  console.log("[compound-search] Calling Groq Compound fallback:", cacheKey)

  const yearRange = params.yearMin && params.yearMax
    ? `${params.yearMin}-${params.yearMax}`
    : params.yearMin
      ? `${params.yearMin}`
      : "current model year"

  const trimText = params.trim ? ` ${params.trim}` : ""
  const conditionText = params.vehicleType === "used" ? "used" : params.vehicleType === "new" ? "new" : ""

  const userPrompt = `Find current US market pricing for a ${conditionText} ${yearRange} ${params.make} ${params.model}${trimText} in or near ZIP code ${params.zip}.

Return JSON with msrpEstimate, avgPaidPrice, typicalMarkup, goodDealTarget, and notes.`

  const result = await callCompound(
    GROQ_COMPOUND_MINI_MODEL,
    MARKET_ENRICHMENT_SYSTEM_PROMPT,
    userPrompt,
    {
      enabledTools: ["web_search"],
      maxTokens: 1500,
    }
  )

  if (!result) return null

  // Parse JSON from content
  let parsed: MarketEnrichment | null = null
  try {
    // Extract JSON from content (compound sometimes wraps in markdown)
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error("[compound-search] No JSON in market enrichment response:", result.content.substring(0, 200))
      return null
    }
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error("[compound-search] Market enrichment JSON parse failed:", err)
    return null
  }

  if (parsed) {
    await setCached(
      cacheKey,
      "market_enrichment",
      { zip: params.zip, make: params.make, model: params.model },
      parsed,
      MARKET_ENRICHMENT_TTL_HOURS
    )
  }

  return parsed
}

/**
 * Change 1 — read-only lookup of the cached market enrichment for a buyer
 * request. Used by the admin UI to surface grounded market context without
 * re-running the (paid) enrichment. Ignores TTL expiry so the admin always
 * sees the last known data; returns null if nothing was ever cached.
 */
export async function getCachedMarketEnrichment(params: {
  zip: string | null
  make: string | null
  model: string | null
}): Promise<MarketEnrichment | null> {
  if (!params.zip || !params.make || !params.model) return null
  const cacheKey = buildCacheKey("market_enrichment", {
    zip: params.zip,
    make: params.make,
    model: params.model,
  })
  try {
    const row = await prisma.searchCache.findUnique({ where: { cacheKey } })
    if (!row) return null
    return row.result as unknown as MarketEnrichment
  } catch (err) {
    console.error("[change-1] getCachedMarketEnrichment failed:", err)
    return null
  }
}

// ───────────────────────────────────────────────────
// DEALER DISCOVERY
// ───────────────────────────────────────────────────

export interface DiscoveredDealer {
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  website: string | null
  brand: string | null
  sourceUrl: string | null
  searchScore: number | null
}

export async function discoverDealers(params: {
  make: string
  zip: string
  radiusMiles?: number
}): Promise<DiscoveredDealer[]> {
  const radiusMiles = params.radiusMiles ?? 25

  const cacheKey = buildCacheKey("dealer_discovery", {
    zip: params.zip,
    make: params.make,
    radiusMiles,
  })

  const cached = await getCached(cacheKey)
  if (cached) {
    console.log("[compound-search] Dealer discovery cache hit:", cacheKey)
    return cached as DiscoveredDealer[]
  }

  console.log("[compound-search] Dealer discovery cache MISS, delegating to Gemini Maps:", cacheKey)

  const dealers = await discoverDealersViaGeminiMaps({
    make: params.make,
    zip: params.zip,
    radiusMiles,
  })

  if (dealers.length > 0) {
    await setCached(
      cacheKey,
      "dealer_discovery",
      { zip: params.zip, make: params.make, radiusMiles },
      dealers,
      DEALER_DISCOVERY_TTL_HOURS
    )
  }

  return dealers
}
