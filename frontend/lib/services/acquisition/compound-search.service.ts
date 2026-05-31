import { prisma } from "@/lib/prisma"

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
  msrpEstimate: number | null
  avgPaidPrice: number | null
  typicalMarkup: string | null
  goodDealTarget: number | null
  notes: string
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

  console.log("[compound-search] Market enrichment cache MISS, calling compound:", cacheKey)

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

const DEALER_DISCOVERY_SYSTEM_PROMPT = `You are a verified-source automotive dealership researcher. Find REAL operating car dealerships near a US ZIP code using web search.

CRITICAL VERIFICATION RULES — your output is used to contact real businesses:

1. Each dealer MUST come from a real web search result. Use the search tools to find dealer listings, Google Maps results, manufacturer dealer locators (toyota.com/dealers, honda.com/find-a-dealer, etc.), or industry directories.

2. Set sourceUrl to the SPECIFIC web page where you confirmed each dealer (e.g., "https://www.toyota.com/dealers/dealer.07064.html"). NEVER use the dealer's own website as the sourceUrl — sourceUrl is where you VERIFIED the dealer exists.

3. NEVER invent any field. If you cannot confirm a phone, address, or website from a real search result, OMIT that field. An incomplete record is acceptable; a fabricated record is not.

4. If your search returns fewer than 5 dealers, return what you found. Quality over quantity. Do not pad with guesses.

5. For each dealer extract: name (exact name from search), full street address, city, state, ZIP, phone, the dealer's own website, brand, and your sourceUrl.

6. Phone numbers must look like real numbers — not patterns like (XXX) XXX-5000 repeated. If unsure, omit.

Output JSON only (no markdown, no commentary):
{"dealers": [{"name": "...", "address": "...", "city": "...", "state": "...", "zip": "...", "phone": "...", "website": "...", "brand": "...", "sourceUrl": "..."}]}`

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

  // Check cache
  const cached = await getCached(cacheKey)
  if (cached) {
    console.log("[compound-search] Dealer discovery cache hit:", cacheKey)
    return cached as DiscoveredDealer[]
  }

  console.log("[compound-search] Dealer discovery cache MISS, calling compound:", cacheKey)

  const userPrompt = `Use web_search to find ${params.make} dealerships within ${radiusMiles} miles of US ZIP code ${params.zip}.

Search queries to consider:
- "${params.make} dealers near ${params.zip}"
- "${params.make} dealership ${params.zip} site:${params.make.toLowerCase()}.com"

Return up to 12 verified dealers as JSON. Each dealer must have a real sourceUrl from your search results — not the dealer's own website. If you cannot verify a dealer, do not include it.`

  const result = await callCompound(
    GROQ_COMPOUND_MINI_MODEL,
    DEALER_DISCOVERY_SYSTEM_PROMPT,
    userPrompt,
    {
      enabledTools: ["web_search"],
      maxTokens: 3000,
    }
  )

  if (!result) return []

  // Parse JSON from content
  let dealers: DiscoveredDealer[] = []
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error("[compound-search] No JSON in dealer discovery response:", result.content.substring(0, 200))
      return []
    }
    const parsed = JSON.parse(jsonMatch[0])
    dealers = Array.isArray(parsed.dealers) ? parsed.dealers : []
  } catch (err) {
    console.error("[compound-search] Dealer discovery JSON parse failed:", err)
    return []
  }

  // Validation filter — drop entries that look hallucinated
  const validatedDealers = dealers.filter((d) => {
    // Must have name and at least one of (sourceUrl, website, phone)
    if (!d.name || typeof d.name !== "string" || d.name.length < 3) return false
    if (!d.sourceUrl && !d.website && !d.phone) return false

    // Reject suspiciously patterned phone numbers
    if (d.phone && typeof d.phone === "string") {
      const digits = d.phone.replace(/[^0-9]/g, "")
      // Phones ending in -X000 or -X5000 four times in a row are pattern fakes
      if (/(0000|5000|3000)$/.test(digits) && digits.length >= 10) {
        // Suspicious — log and drop
        console.warn(`[compound-search] Dropped suspected hallucinated dealer: ${d.name} phone=${d.phone}`)
        return false
      }
    }

    return true
  })

  dealers = validatedDealers

  // Attach search scores from executed_tools
  const scoreMap = new Map<string, number>()
  for (const sr of result.searchResults) {
    if (sr.url && sr.score !== undefined) {
      scoreMap.set(sr.url, sr.score)
    }
  }

  const enrichedDealers = dealers.map((d) => ({
    ...d,
    searchScore: d.sourceUrl ? scoreMap.get(d.sourceUrl) ?? null : null,
  }))

  if (enrichedDealers.length > 0) {
    await setCached(
      cacheKey,
      "dealer_discovery",
      { zip: params.zip, make: params.make, radiusMiles },
      enrichedDealers,
      DEALER_DISCOVERY_TTL_HOURS
    )
  }

  return enrichedDealers
}
