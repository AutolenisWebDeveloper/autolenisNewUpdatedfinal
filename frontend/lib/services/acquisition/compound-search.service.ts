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

const DEALER_DISCOVERY_SYSTEM_PROMPT = `You are a precise automotive dealership researcher. Your job is to find real, currently-operating dealerships near a specific ZIP code that sell a specific make of vehicle.

For each dealer you find, extract:
  - name: official dealership name
  - address: full street address
  - city, state, zip: location components
  - phone: main phone number with formatting
  - website: official website URL
  - brand: the make they primarily sell (Toyota, Honda, etc.)
  - sourceUrl: the URL where you found this dealer

Output a JSON array of dealers. Return 8-12 dealers if possible. Use only real, verified information. If you cannot verify a field, omit it from that dealer's object (do not invent data). Output JSON only — no commentary.

Format:
{
  "dealers": [
    { "name": "...", "address": "...", "city": "...", "state": "...", "zip": "...", "phone": "...", "website": "...", "brand": "...", "sourceUrl": "..." },
    ...
  ]
}`

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

  const userPrompt = `Find all ${params.make} dealerships within ${radiusMiles} miles of ZIP code ${params.zip} in the United States.

Search the web to find their current contact info — name, full address, phone, website. Return as JSON.`

  const result = await callCompound(
    GROQ_COMPOUND_MODEL,
    DEALER_DISCOVERY_SYSTEM_PROMPT,
    userPrompt,
    {
      enabledTools: ["web_search"],
      maxTokens: 4000,
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
