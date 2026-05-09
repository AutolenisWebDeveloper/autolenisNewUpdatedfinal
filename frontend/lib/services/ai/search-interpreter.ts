// System 2 ENH — Natural language search interpretation via Groq
// Buyer types plain English → Groq converts to structured filters
// Groq ONLY — no other LLM providers
// Kill switch checked before every call

import { groqChat } from "@/lib/ai/groq-client";
import { assertAiEnabled } from "@/lib/ai/kill-switch";

export interface StructuredSearchFilters {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  maxPriceDollars?: number;
  mileageMax?: number;
  bodyStyle?: string;
  features?: string[];
  interpretation: string; // Human-readable explanation for the chip
  confidence: "high" | "medium" | "low";
}

const SEARCH_INTERPRETER_PROMPT = `You are a vehicle search filter extractor for AutoLenis, a US car-buying platform.

Extract structured search filters from a buyer's plain-English query.

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "make": "Toyota" or null,
  "model": "Camry" or null,
  "yearMin": 2020 or null,
  "yearMax": 2024 or null,
  "maxPriceDollars": 35000 or null,
  "mileageMax": 50000 or null,
  "bodyStyle": "SUV" or null,
  "features": ["awd", "bluetooth"] or [],
  "interpretation": "Honda under $25k with low mileage",
  "confidence": "high"
}

Rules:
- Extract only what the buyer explicitly mentioned — never assume
- "cheap" or "affordable" → maxPriceDollars: 20000
- "low mileage" → mileageMax: 30000
- "recent" or "new" → yearMin: current_year - 3
- interpretation: concise phrase (max 10 words) for display chip
- confidence: "high" if 3+ filters, "medium" if 1-2, "low" if vague`;

export async function interpretSearchQuery(query: string): Promise<StructuredSearchFilters | null> {
  assertAiEnabled(); // Kill switch check

  if (!query.trim() || query.trim().length < 3) return null;

  try {
    const result = await groqChat([
      { role: "system", content: SEARCH_INTERPRETER_PROMPT },
      { role: "user", content: query },
    ], { maxTokens: 200, temperature: 0.1 });

    const parsed = JSON.parse(result.content.trim()) as StructuredSearchFilters;

    // Validate required field
    if (!parsed.interpretation) return null;

    return parsed;
  } catch {
    // Graceful fallback — return null if parse fails or AI unavailable
    return null;
  }
}

// Convert structured filters to URL search params for the inventory API
export function filtersToSearchParams(filters: StructuredSearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.make) params.set("make", filters.make);
  if (filters.model) params.set("model", filters.model);
  if (filters.yearMin) params.set("yearMin", filters.yearMin.toString());
  if (filters.yearMax) params.set("yearMax", filters.yearMax.toString());
  if (filters.maxPriceDollars) params.set("maxPrice", Math.round(filters.maxPriceDollars * 100).toString());
  if (filters.mileageMax) params.set("mileageMax", filters.mileageMax.toString());
  return params;
}
