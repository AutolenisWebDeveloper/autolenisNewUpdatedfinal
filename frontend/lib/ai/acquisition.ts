// lib/ai/acquisition.ts
// Acquisition-specific Groq helpers — sits on top of groqChat from
// groq-client.ts. Used by the conversational vehicle finder to extract
// structured data from free-text buyer responses and to score lead quality.

import { groqChat, type ChatMessage } from "@/lib/ai/groq-client";

export const GROQ_QUALITY = "llama-3.3-70b-versatile";
export const GROQ_FAST = "llama-3.1-8b-instant";

export interface ExtractedData {
  vehicleType: "new" | "used" | "open" | null;
  make: string | null;
  model: string | null;
  budgetTotal: number | null;
  monthlyPayment: number | null;
  tradeIn: boolean | null;
  timeline: "this_week" | "1_to_3_months" | "researching" | null;
  zip: string | null;
  phone: string | null;
}

const EMPTY: ExtractedData = {
  vehicleType: null,
  make: null,
  model: null,
  budgetTotal: null,
  monthlyPayment: null,
  tradeIn: null,
  timeline: null,
  zip: null,
  phone: null,
};

function safeParseJson(content: string): unknown {
  // Models occasionally wrap JSON in ```json fences or include leading prose.
  // Strip the fence and find the first balanced object.
  const cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function coerceVehicleType(v: unknown): ExtractedData["vehicleType"] {
  if (v === "new" || v === "used" || v === "open") return v;
  return null;
}

function coerceTimeline(v: unknown): ExtractedData["timeline"] {
  if (v === "this_week" || v === "1_to_3_months" || v === "researching") return v;
  return null;
}

function coerceString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["true", "yes", "y"].includes(s)) return true;
    if (["false", "no", "n"].includes(s)) return false;
  }
  return null;
}

export async function extractVehicleData(
  userMessage: string,
  existingData: Partial<ExtractedData>,
): Promise<ExtractedData> {
  const merged: ExtractedData = { ...EMPTY, ...existingData };

  const system = `You extract structured vehicle-shopping facts from a buyer's
message. Merge new information with the existing data — never overwrite a
known value with null. Output JSON only, no prose, no markdown fences.

Schema:
{
  "vehicleType": "new" | "used" | "open" | null,
  "make": string | null,
  "model": string | null,
  "budgetTotal": number | null,
  "monthlyPayment": number | null,
  "tradeIn": boolean | null,
  "timeline": "this_week" | "1_to_3_months" | "researching" | null,
  "zip": string | null,
  "phone": string | null
}

Rules:
- "vehicleType" — "new" if buyer says new only, "used" if used only,
  "open" if they say "either" / "both" / "open".
- "timeline" — map "this week / asap / now / urgent" → "this_week";
  "next month / 1-3 months / soon" → "1_to_3_months";
  "just looking / researching" → "researching".
- "budgetTotal" vs "monthlyPayment" — if the buyer states a total price,
  set budgetTotal. If they state $X/month, set monthlyPayment. Strip $
  and commas; output a raw number.
- "zip" — 5-digit US ZIP only.
- "phone" — keep only digits; require at least 10.
- Echo back unchanged fields from "existing" in your response.`;

  const user = `Existing data:
${JSON.stringify(merged)}

Buyer's latest message:
${userMessage}

Return the merged JSON.`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const result = await groqChat(messages, {
      maxTokens: 400,
      temperature: 0.1,
    });
    const parsed = safeParseJson(result.content);
    if (!parsed || typeof parsed !== "object") return merged;
    const obj = parsed as Record<string, unknown>;

    return {
      vehicleType: coerceVehicleType(obj.vehicleType) ?? merged.vehicleType,
      make: coerceString(obj.make) ?? merged.make,
      model: coerceString(obj.model) ?? merged.model,
      budgetTotal: coerceNumber(obj.budgetTotal) ?? merged.budgetTotal,
      monthlyPayment: coerceNumber(obj.monthlyPayment) ?? merged.monthlyPayment,
      tradeIn: coerceBool(obj.tradeIn) ?? merged.tradeIn,
      timeline: coerceTimeline(obj.timeline) ?? merged.timeline,
      zip: coerceString(obj.zip) ?? merged.zip,
      phone: coerceString(obj.phone) ?? merged.phone,
    };
  } catch (err) {
    console.error("[acquisition.extractVehicleData] groq failed", err);
    return merged;
  }
}

export async function scoreLeadWithGroq(
  data: ExtractedData,
): Promise<{ score: number; temperature: string; reasoning: string }> {
  const fallback = {
    score: 0,
    temperature: "cold",
    reasoning: "AI scoring unavailable",
  };

  const system = `You score automotive lead quality on a 0-100 scale. Buyers
with a clear vehicle target, real budget, and short timeline score high;
vague researchers without a phone number score low. Output JSON only, no
markdown fences.

Schema: { "score": number, "temperature": "hot" | "warm" | "cold", "reasoning": string }

Guidance:
- score 85-100, temperature "hot": specific make+model, budget, this-week
  timeline, phone provided.
- score 50-84, temperature "warm": partial intent, 1-3 month timeline.
- score 0-49, temperature "cold": researching only or missing major fields.
- "reasoning" — one short sentence summarising why.`;

  try {
    const result = await groqChat(
      [
        { role: "system", content: system },
        { role: "user", content: `Score this lead:\n${JSON.stringify(data)}` },
      ],
      { maxTokens: 250, temperature: 0.2 },
    );
    const parsed = safeParseJson(result.content);
    if (!parsed || typeof parsed !== "object") return fallback;
    const obj = parsed as Record<string, unknown>;
    const scoreNum = coerceNumber(obj.score);
    const tempRaw = coerceString(obj.temperature);
    const tempStr = tempRaw ? tempRaw.toLowerCase() : null;
    const reasonStr = coerceString(obj.reasoning);
    if (scoreNum === null || tempStr === null || reasonStr === null) return fallback;
    const clamped = Math.max(0, Math.min(100, Math.round(scoreNum)));
    const temp = ["hot", "warm", "cold"].includes(tempStr) ? tempStr : "cold";
    return { score: clamped, temperature: temp, reasoning: reasonStr };
  } catch (err) {
    console.error("[acquisition.scoreLeadWithGroq] groq failed", err);
    return fallback;
  }
}
