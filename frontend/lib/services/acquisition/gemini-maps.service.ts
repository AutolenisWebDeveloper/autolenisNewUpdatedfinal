import { logger } from "@/lib/logger";
import type { DiscoveredDealer } from "./compound-search.service"

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

interface GeminiGroundingChunk {
  maps?: {
    placeId?: string
    uri?: string
    googleMapsUri?: string
    url?: string
    title?: string
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[]
      groundingSupports?: Array<{
        groundingChunkIndices?: number[]
        confidenceScores?: number[]
      }>
    }
  }>
}

const GEMINI_MAPS_SYSTEM_PROMPT = `You are an automotive dealership researcher. Use Google Maps grounding to find real, currently-operating \${make} dealerships near a US ZIP code.

For each dealer you find, return a JSON object with:
  - name (official dealership name from Google Maps)
  - address (full street address)
  - city, state, zip
  - phone (in (XXX) XXX-XXXX format)
  - website (official dealer website if listed in Maps)
  - brand (the make they primarily sell)
  - placeId (Google Place ID from your search result — MANDATORY)

Output ONLY a JSON object in this exact format:
{"dealers": [{"name": "...", "address": "...", "city": "...", "state": "...", "zip": "...", "phone": "...", "website": "...", "brand": "...", "placeId": "..."}]}

CRITICAL: Every dealer MUST include a placeId from Google Maps. Do not invent dealers. Do not include results without a verified Place ID. Return up to 12 dealers. IMPORTANT: Return ONLY the JSON object. No markdown code fences, no commentary, no explanation. Begin your response with { and end with }.`

export async function discoverDealersViaGeminiMaps(params: {
  make: string
  zip: string
  radiusMiles?: number
}): Promise<DiscoveredDealer[]> {
  const radiusMiles = params.radiusMiles ?? 25

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    logger.error("[gemini-maps] GEMINI_API_KEY not configured")
    return []
  }

  const systemPrompt = GEMINI_MAPS_SYSTEM_PROMPT.replace(
    "${make}",
    params.make
  )

  const userPrompt = `Find ${params.make} dealerships within ${radiusMiles} miles of US ZIP code ${params.zip}. Use Google Maps to verify each dealer. Return up to 12 verified dealers as JSON with placeId for each.`

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        tools: [
          {
            googleMaps: {},
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 5000,
        },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      logger.error(
        `[gemini-maps] Gemini API failed: ${response.status}`,
        errBody.substring(0, 500)
      )
      return []
    }

    const data: GeminiResponse = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    const groundingChunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    const groundingSupports = data.candidates?.[0]?.groundingMetadata?.groundingSupports ?? []

    let dealers: Array<{
      name?: string
      address?: string
      city?: string
      state?: string
      zip?: string
      phone?: string
      website?: string
      brand?: string
      placeId?: string
    }> = []

    // Strategy 1: Try standard JSON parse on the largest brace block
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed.dealers)) {
          dealers = parsed.dealers
        }
      }
    } catch (err) {
      logger.warn(
        "[gemini-maps] Standard JSON parse failed, attempting salvage:",
        err instanceof Error ? err.message : String(err)
      )
    }

    // Strategy 2: If standard parse failed or returned no dealers,
    // salvage complete dealer objects from the (possibly truncated) text.
    if (dealers.length === 0) {
      try {
        // Match every {...} object that looks like a dealer record.
        // A complete dealer object has at least name and placeId.
        const dealerObjectRegex = /\{(?:[^{}]|"(?:[^"\\]|\\.)*")*\}/g
        const matches = content.match(dealerObjectRegex) ?? []

        const salvaged: typeof dealers = []
        for (const m of matches) {
          try {
            const obj = JSON.parse(m)
            // Only accept objects that look like dealer records
            if (obj && typeof obj === "object" && obj.name && obj.placeId) {
              salvaged.push(obj)
            }
          } catch {
            // Skip malformed individual objects
          }
        }

        if (salvaged.length > 0) {
          logger.info(
            `[gemini-maps] Salvaged ${salvaged.length} complete dealer objects from truncated response`
          )
          dealers = salvaged
        }
      } catch (err) {
        logger.error(
          "[gemini-maps] Salvage parse failed:",
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    if (dealers.length === 0) {
      logger.error(
        "[gemini-maps] No dealers parsed from response. First 300 chars:",
        content.substring(0, 300)
      )
      return []
    }

    const placeIdToScore = new Map<string, number>()
    for (let i = 0; i < groundingChunks.length; i++) {
      const chunk = groundingChunks[i]
      const placeId = chunk.maps?.placeId
      if (!placeId) continue

      let maxScore = 0
      for (const support of groundingSupports) {
        if (support.groundingChunkIndices?.includes(i)) {
          const score = Math.max(...(support.confidenceScores ?? [0]))
          if (score > maxScore) maxScore = score
        }
      }
      // Normalize placeId so map lookups against dealer placeIds always match.
      placeIdToScore.set(String(placeId).trim(), maxScore)
    }

    const placeIdToUrl = new Map<string, string>()
    for (const chunk of groundingChunks) {
      const placeId = chunk.maps?.placeId
      if (!placeId) continue

      // Try multiple field names for the URL across Gemini API versions.
      const uri =
        chunk.maps?.uri ??
        chunk.maps?.googleMapsUri ??
        (chunk as { maps?: { url?: string } }).maps?.url ??
        null

      if (uri) {
        placeIdToUrl.set(String(placeId).trim(), uri)
      }
    }

    // Diagnostic logging — keep in production for now so we can observe the
    // actual shape of Gemini's grounding metadata in real traffic.
    logger.info(
      "[gemini-maps] groundingChunks sample:",
      JSON.stringify(groundingChunks.slice(0, 2), null, 2)
    )
    logger.info(
      "[gemini-maps] groundingSupports sample:",
      JSON.stringify(groundingSupports.slice(0, 2), null, 2)
    )
    logger.info("[gemini-maps] placeIdToUrl size:", placeIdToUrl.size)
    logger.info("[gemini-maps] placeIdToScore size:", placeIdToScore.size)
    logger.info("[gemini-maps] First dealer placeId:", dealers[0]?.placeId)

    const validatedDealers: DiscoveredDealer[] = []

    for (const d of dealers) {
      if (!d.name || d.name.length < 3) {
        logger.warn(`[gemini-maps] Dropped dealer with invalid name`)
        continue
      }

      const hasPlaceId = !!(d.placeId && String(d.placeId).trim().length >= 5)
      const hasPhone = !!(d.phone && typeof d.phone === "string" && d.phone.length >= 7)
      const hasAddress = !!(d.address && typeof d.address === "string" && d.address.length >= 5)

      // Drop dealers with no verifiable data at all
      if (!hasPlaceId && !hasPhone && !hasAddress) {
        logger.warn(`[gemini-maps] Dropped dealer with no verifiable fields: ${d.name}`)
        continue
      }

      let sourceUrl: string | null = null
      let searchScore: number | null = null

      if (hasPlaceId) {
        // Tier 1 — Maps-verified: derive CID-based URL
        const dealerCid = String(d.placeId).replace(/[^0-9]/g, "")
        sourceUrl = dealerCid
          ? `https://maps.google.com/?cid=${dealerCid}`
          : null

        // Match searchScore by CID comparison
        for (const [chunkPlaceId, score] of placeIdToScore) {
          const chunkCid = String(chunkPlaceId).replace(/[^0-9]/g, "")
          if (chunkCid && chunkCid === dealerCid) {
            searchScore = score
            break
          }
        }
        if (searchScore === null) {
          searchScore = placeIdToScore.get(String(d.placeId).trim()) ?? null
        }
      }
      // Tier 2 — no placeId: sourceUrl and searchScore stay null
      // The dealer has name + phone or address — acceptable for
      // founder-driven phone outreach

      validatedDealers.push({
        name: d.name,
        address: d.address ?? null,
        city: d.city ?? null,
        state: d.state ?? null,
        zip: d.zip ?? null,
        phone: d.phone ?? null,
        email: null,
        website: d.website ?? null,
        brand: d.brand ?? null,
        sourceUrl,
        searchScore,
      })
    }

    // Update the log to show tier breakdown
    const tier1Count = validatedDealers.filter(d => d.sourceUrl !== null).length
    const tier2Count = validatedDealers.filter(d => d.sourceUrl === null).length
    logger.info(
      `[gemini-maps] Returned ${validatedDealers.length} dealers: ` +
      `${tier1Count} Maps-verified, ${tier2Count} structurally valid`
    )
    return validatedDealers

  } catch (err) {
    logger.error("[gemini-maps] Request failed:", err)
    return []
  }
}

// ───────────────────────────────────────────────────
// CHANGE 1 — MARKET ENRICHMENT VIA GEMINI SEARCH GROUNDING
// ───────────────────────────────────────────────────

export interface GroundedLocalDealer {
  name: string
  city: string | null
  distanceMiles: number | null
  hasInventory: boolean | null
  inventoryNote: string | null
}

// Superset of the legacy MarketEnrichment shape. The first five fields are kept
// for backward compatibility with the unified intake consumer (do-not-touch
// perimeter); the remaining fields are the new web-grounded market context.
export interface GroundedMarketEnrichment {
  msrpEstimate: number | null
  avgPaidPrice: number | null
  typicalMarkup: string | null
  goodDealTarget: number | null
  notes: string
  localDealers: GroundedLocalDealer[]
  regionalPricingInsight: string | null
  msrpRange: { low: number | null; high: number | null } | null
  currentIncentives: string | null
  demandLevel: "high" | "normal" | "low" | null
  supplyNote: string | null
  searchGrounded: boolean
  dataAsOf: string | null
}

// Coerce an unknown LLM value to a finite number or null. Strips currency
// symbols and commas so "$31,500" parses cleanly.
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.-]/g, "")
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim()
  return null
}

function toBoolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    const t = v.trim().toLowerCase()
    if (t === "true" || t === "yes") return true
    if (t === "false" || t === "no") return false
  }
  return null
}

const GEMINI_MARKET_SYSTEM_PROMPT = `You are researching the automotive market for a specific vehicle buyer. Use Google Search to gather real-time data. Return ONLY a single JSON object — no markdown code fences, no commentary. Begin with { and end with }.`

/**
 * Change 1: web-grounded market enrichment via Gemini 2.5 Flash + Google Search.
 * Returns a superset of the legacy MarketEnrichment fields plus richer grounded
 * context. Returns null on any failure so callers can fall back gracefully.
 */
export async function enrichMarketViaGemini(params: {
  vehicleType: string | null
  make: string
  model: string
  trim: string | null
  yearMin: number | null
  yearMax: number | null
  zip: string
}): Promise<GroundedMarketEnrichment | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    logger.error("[change-1] GEMINI_API_KEY not configured — cannot ground")
    return null
  }

  const yearRange =
    params.yearMin && params.yearMax
      ? `${params.yearMin}-${params.yearMax}`
      : params.yearMin
        ? `${params.yearMin}`
        : "current model year"
  const trimText = params.trim ? ` ${params.trim}` : ""
  const conditionText =
    params.vehicleType === "used"
      ? "used"
      : params.vehicleType === "new"
        ? "new"
        : ""

  const userPrompt = `Buyer Request:
- Vehicle: ${conditionText} ${yearRange} ${params.make} ${params.model}${trimText}
- Buyer ZIP: ${params.zip}

Search the live web and return ONLY this JSON structure, no markdown:
{
  "msrpEstimate": number | null,
  "avgPaidPrice": number | null,
  "typicalMarkup": "string or null (e.g. \\"$0-$2000 over invoice\\")",
  "goodDealTarget": number | null,
  "notes": "1-2 sentence summary with key market context",
  "localDealers": [
    { "name": "string", "city": "string", "distanceMiles": number | null, "hasInventory": boolean | null, "inventoryNote": "string or null" }
  ],
  "regionalPricingInsight": "string (2-3 sentences on current market price for this vehicle in this region)",
  "msrpRange": { "low": number | null, "high": number | null },
  "currentIncentives": "string or null (any manufacturer or dealer incentives active right now)",
  "demandLevel": "high" | "normal" | "low" | null,
  "supplyNote": "string or null (any known inventory shortage or surplus for this model)",
  "searchGrounded": true,
  "dataAsOf": "ISO date string"
}

localDealers: return up to 8 dealers within 50 miles. If no grounded data found, return best estimates with searchGrounded: false.`

  try {
    // Note: Gemini does not allow responseMimeType=application/json together
    // with the googleSearch tool, so we instruct JSON in the prompt and parse
    // the brace block from the text response instead.
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: GEMINI_MARKET_SYSTEM_PROMPT }] },
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      logger.error(
        `[change-1] Gemini market enrichment failed: ${response.status}`,
        errBody.substring(0, 400)
      )
      return null
    }

    const data: GeminiResponse = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    const groundingChunks =
      data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.error(
        "[change-1] No JSON in Gemini response. First 300 chars:",
        content.substring(0, 300)
      )
      return null
    }

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    } catch (err) {
      logger.error("[change-1] Gemini JSON parse failed:", err)
      return null
    }

    // Coerce every field at the LLM boundary.
    const rawDealers = Array.isArray(raw.localDealers) ? raw.localDealers : []
    const localDealers: GroundedLocalDealer[] = rawDealers
      .slice(0, 8)
      .map((d) => {
        const obj = (d ?? {}) as Record<string, unknown>
        return {
          name: toStr(obj.name) ?? "",
          city: toStr(obj.city),
          distanceMiles: toNum(obj.distanceMiles),
          hasInventory: toBoolOrNull(obj.hasInventory),
          inventoryNote: toStr(obj.inventoryNote),
        }
      })
      .filter((d) => d.name.length > 0)

    const rawRange = (raw.msrpRange ?? null) as Record<string, unknown> | null
    const msrpRange = rawRange
      ? { low: toNum(rawRange.low), high: toNum(rawRange.high) }
      : null

    const demandRaw = toStr(raw.demandLevel)?.toLowerCase()
    const demandLevel =
      demandRaw === "high" || demandRaw === "normal" || demandRaw === "low"
        ? (demandRaw as "high" | "normal" | "low")
        : null

    // searchGrounded: trust the model's claim, but only if Gemini actually
    // returned grounding metadata. If the model says true but no grounding
    // chunks came back, downgrade to false to avoid a misleading badge.
    const claimedGrounded = toBoolOrNull(raw.searchGrounded) ?? false
    const searchGrounded = claimedGrounded && groundingChunks.length > 0

    const msrpEstimate = toNum(raw.msrpEstimate) ?? msrpRange?.low ?? null

    const enrichment: GroundedMarketEnrichment = {
      msrpEstimate,
      avgPaidPrice: toNum(raw.avgPaidPrice),
      typicalMarkup: toStr(raw.typicalMarkup),
      goodDealTarget: toNum(raw.goodDealTarget),
      notes: toStr(raw.notes) ?? toStr(raw.regionalPricingInsight) ?? "",
      localDealers,
      regionalPricingInsight: toStr(raw.regionalPricingInsight),
      msrpRange,
      currentIncentives: toStr(raw.currentIncentives),
      demandLevel,
      supplyNote: toStr(raw.supplyNote),
      searchGrounded,
      dataAsOf: toStr(raw.dataAsOf) ?? new Date().toISOString(),
    }

    const dealersWithInventory = localDealers.filter(
      (d) => d.hasInventory === true
    ).length
    logger.info(
      `[change-1] Gemini Search grounding fired for ${params.make} ${params.model} in ${params.zip}`
    )
    logger.info(
      `[change-1] searchGrounded: ${searchGrounded}, localDealers: ${localDealers.length} (${dealersWithInventory} w/ inventory), ` +
        `msrpRange: ${msrpRange?.low ?? "?"}-${msrpRange?.high ?? "?"}, demand: ${demandLevel ?? "n/a"}`
    )

    return enrichment
  } catch (err) {
    logger.error("[change-1] Gemini market enrichment request failed:", err)
    return null
  }
}
