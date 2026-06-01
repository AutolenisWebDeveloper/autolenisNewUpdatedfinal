import type { DiscoveredDealer } from "./compound-search.service"

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

interface GeminiGroundingChunk {
  maps?: {
    placeId?: string
    uri?: string
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
    console.error("[gemini-maps] GEMINI_API_KEY not configured")
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
          maxOutputTokens: 3000,
        },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error(
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

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.error("[gemini-maps] No JSON found in response:", content.substring(0, 200))
        return []
      }
      const parsed = JSON.parse(jsonMatch[0])
      dealers = Array.isArray(parsed.dealers) ? parsed.dealers : []
    } catch (err) {
      console.error("[gemini-maps] JSON parse failed:", err)
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
      placeIdToScore.set(placeId, maxScore)
    }

    const placeIdToUrl = new Map<string, string>()
    for (const chunk of groundingChunks) {
      if (chunk.maps?.placeId && chunk.maps?.uri) {
        placeIdToUrl.set(chunk.maps.placeId, chunk.maps.uri)
      }
    }

    const validatedDealers: DiscoveredDealer[] = []
    for (const d of dealers) {
      if (!d.placeId || typeof d.placeId !== "string" || d.placeId.length < 10) {
        console.warn(`[gemini-maps] Dropped dealer without valid placeId: ${d.name ?? "unknown"}`)
        continue
      }
      if (!d.name || d.name.length < 3) {
        console.warn(`[gemini-maps] Dropped dealer with invalid name: ${d.placeId}`)
        continue
      }

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
        sourceUrl: placeIdToUrl.get(d.placeId) ?? null,
        searchScore: placeIdToScore.get(d.placeId) ?? null,
      })
    }

    console.log(`[gemini-maps] Returned ${validatedDealers.length} validated dealers (${dealers.length - validatedDealers.length} dropped for missing placeId)`)
    return validatedDealers

  } catch (err) {
    console.error("[gemini-maps] Request failed:", err)
    return []
  }
}
