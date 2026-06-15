// lib/ai/acquisition.ts
// Acquisition-specific AI helpers. The existing groqChat() in groq-client.ts
// hardcodes its model, so the per-function model assignments below (gpt-oss
// reasoning / messaging / safeguard) are called against the Groq REST
// endpoint directly. groqChat() itself is untouched and continues to drive
// the voice + general-purpose flows.

import { logger } from "@/lib/logger";
import type { ChatMessage } from "@/lib/ai/groq-client";

// ─── Model lineup ────────────────────────────────────────────────────────────
export const GROQ_FAST = "llama-3.1-8b-instant";
// High-volume extraction, simple tasks

export const GROQ_REASONING = "openai/gpt-oss-120b";
// Lead scoring, content drafting, dealer outreach

export const GROQ_MESSAGING = "openai/gpt-oss-20b";
// SMS/email personalization, follow-up copy

export const GROQ_SAFETY = "openai/gpt-oss-safeguard-20b";
// Opt-out detection, compliance classification

export const GROQ_SUMMARY = "llama-3.3-70b-versatile";
// Morning briefing, general summarization

// ─── Public types ────────────────────────────────────────────────────────────
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

// ─── Low-level: call Groq's OpenAI-compatible chat completions endpoint ──────
// We bypass the local groqChat() helper because the gpt-oss family accepts a
// `reasoning_effort` knob that the helper does not pass through, and because
// the helper hardcodes its model.

interface GroqCallOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
  responseFormatJson?: boolean;
}

interface GroqRawResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

async function callGroq(options: GroqCallOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.2,
    top_p: 1.0,
  };
  if (options.reasoningEffort) {
    // gpt-oss family knob — Groq accepts this on the openai/gpt-oss-* models.
    body.reasoning_effort = options.reasoningEffort;
  }
  if (options.responseFormatJson) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as GroqRawResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── JSON parsing helpers ────────────────────────────────────────────────────
function safeParseJson(content: string): unknown {
  // Models occasionally wrap JSON in ```json fences or leading prose.
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
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
function coerceTrimmedString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function coerceNumeric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function coerceBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["true", "yes", "y"].includes(s)) return true;
    if (["false", "no", "n"].includes(s)) return false;
  }
  return null;
}

// ─── extractVehicleData — GROQ_FAST (llama-3.1-8b-instant) ───────────────────
export async function extractVehicleData(
  userMessage: string,
  existingData: Partial<ExtractedData>,
): Promise<ExtractedData> {
  const merged: ExtractedData = { ...EMPTY, ...existingData };

  const system = `You extract structured vehicle-shopping facts from a buyer's
message. Merge new information with the existing data — never overwrite a
known value with null. Return ONLY valid JSON matching this schema:

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
- vehicleType: "new" / "used" / "open" (when buyer says "either" / "both").
- timeline: "this week / asap / now / urgent" → "this_week";
  "next month / 1-3 months / soon" → "1_to_3_months";
  "just looking / researching" → "researching".
- budgetTotal vs monthlyPayment: total price → budgetTotal, $X/month → monthlyPayment.
- zip: 5-digit US ZIP only.
- phone: digits only, ≥ 10.
- Return null for any field not mentioned. Echo unchanged fields from the existing data.`;

  const user = `Existing data:
${JSON.stringify(merged)}

Buyer's latest message:
${userMessage}

Return the merged JSON.`;

  try {
    const content = await callGroq({
      model: GROQ_FAST,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 400,
      temperature: 0.1,
      responseFormatJson: true,
    });
    const parsed = safeParseJson(content);
    if (!parsed || typeof parsed !== "object") return merged;
    const obj = parsed as Record<string, unknown>;
    return {
      vehicleType: coerceVehicleType(obj.vehicleType) ?? merged.vehicleType,
      make: coerceTrimmedString(obj.make) ?? merged.make,
      model: coerceTrimmedString(obj.model) ?? merged.model,
      budgetTotal: coerceNumeric(obj.budgetTotal) ?? merged.budgetTotal,
      monthlyPayment: coerceNumeric(obj.monthlyPayment) ?? merged.monthlyPayment,
      tradeIn: coerceBoolean(obj.tradeIn) ?? merged.tradeIn,
      timeline: coerceTimeline(obj.timeline) ?? merged.timeline,
      zip: coerceTrimmedString(obj.zip) ?? merged.zip,
      phone: coerceTrimmedString(obj.phone) ?? merged.phone,
    };
  } catch (err) {
    logger.error("[acquisition.extractVehicleData] failed", err);
    return merged;
  }
}

// ─── scoreLeadWithGroq — GROQ_MESSAGING (gpt-oss-20b, medium effort) ─────────
export async function scoreLeadWithGroq(
  data: ExtractedData,
): Promise<{ score: number; temperature: string; reasoning: string }> {
  const fallback = {
    score: 0,
    temperature: "cold",
    reasoning: "AI scoring unavailable",
  };

  const system = `You score automotive lead quality on a 0-100 scale based on
vehicle specificity, budget clarity, purchase timeline, and overall data
completeness. Return ONLY valid JSON:

{ "score": number, "temperature": "hot" | "warm" | "cold", "reasoning": string }

Guidance:
- 85-100 "hot": specific make+model, real budget, this-week timeline, phone provided.
- 50-84 "warm": partial intent or 1-3 month timeline.
- 0-49 "cold": researching only, missing major fields, or no phone.
- reasoning: one concise sentence.`;

  try {
    const content = await callGroq({
      model: GROQ_MESSAGING,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Score this lead:\n${JSON.stringify(data)}` },
      ],
      maxTokens: 400,
      temperature: 0.2,
      reasoningEffort: "medium",
      responseFormatJson: true,
    });
    const parsed = safeParseJson(content);
    if (!parsed || typeof parsed !== "object") return fallback;
    const obj = parsed as Record<string, unknown>;
    const scoreNum = coerceNumeric(obj.score);
    const tempRaw = coerceTrimmedString(obj.temperature);
    const tempStr = tempRaw ? tempRaw.toLowerCase() : null;
    const reasonStr = coerceTrimmedString(obj.reasoning);
    if (scoreNum === null || tempStr === null || reasonStr === null) return fallback;
    const clamped = Math.max(0, Math.min(100, Math.round(scoreNum)));
    const temp = ["hot", "warm", "cold"].includes(tempStr) ? tempStr : "cold";
    return { score: clamped, temperature: temp, reasoning: reasonStr };
  } catch (err) {
    logger.error("[acquisition.scoreLeadWithGroq] failed", err);
    return fallback;
  }
}

// ─── detectOptOutIntent — GROQ_SAFETY (gpt-oss-safeguard-20b, low effort) ────
export async function detectOptOutIntent(message: string): Promise<boolean> {
  const trimmed = message?.trim();
  if (!trimmed) return false;

  const system = `Policy: Classify whether the following message is a request
to stop receiving text messages. Include direct keywords (STOP, UNSUBSCRIBE,
CANCEL, QUIT, END) and natural language requests such as "take me off your
list", "don't text me anymore", "remove me", "I don't want these messages".
Output ONLY valid JSON: { "isOptOut": boolean }`;

  try {
    const content = await callGroq({
      model: GROQ_SAFETY,
      messages: [
        { role: "system", content: system },
        { role: "user", content: trimmed },
      ],
      maxTokens: 80,
      temperature: 0.0,
      reasoningEffort: "low",
      responseFormatJson: true,
    });
    const parsed = safeParseJson(content);
    if (!parsed || typeof parsed !== "object") return false;
    return (parsed as { isOptOut?: unknown }).isOptOut === true;
  } catch (err) {
    logger.error("[acquisition.detectOptOutIntent] failed", err);
    return false;
  }
}

// ─── streamConcierge — GROQ_REASONING (gpt-oss-120b, medium effort) ──────────
// Streams a conversation reply token-by-token via Server-Sent Events. The
// streaming API and the response_format JSON schema feature cannot be combined
// in a single Groq call, so structured extraction runs as a separate call.

export interface ConciergeMessage {
  role: "user" | "assistant";
  content: string;
}

export async function* streamConcierge(
  systemPrompt: string,
  messages: ConciergeMessage[],
): AsyncGenerator<string, void, unknown> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    yield "I am temporarily unavailable. Please try again in a moment.";
    return;
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_REASONING,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      reasoning_effort: "medium",
      stream: true,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!response.ok || !response.body) {
    yield "I am having trouble responding right now. Please try again.";
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── extractStructuredData — GROQ_MESSAGING (gpt-oss-20b, low effort) ────────
// Non-streamed strict-JSON extraction call that runs in parallel with the
// streaming reply. Never overwrites a non-null existing value with null.

export interface BuyerProfile {
  vehicleType: "new" | "used" | "open" | null;
  make: string | null;
  model: string | null;
  bodyStyle: string | null;
  yearMin: number | null;
  yearMax: number | null;
  trim: string | null;
  budgetType: "cash" | "monthly" | null;
  budgetAmount: number | null;
  monthlyPayment: number | null;
  timeline: "this_week" | "1_to_3_months" | "researching" | null;
  zip: string | null;
  phone: string | null;
  hasTradeIn: boolean | null;
  financingNeeded: boolean | null;
  firstName: string | null;
}

function defaultProfile(): BuyerProfile {
  return {
    vehicleType: null,
    make: null,
    model: null,
    bodyStyle: null,
    yearMin: null,
    yearMax: null,
    trim: null,
    budgetType: null,
    budgetAmount: null,
    monthlyPayment: null,
    timeline: null,
    zip: null,
    phone: null,
    hasTradeIn: null,
    financingNeeded: null,
    firstName: null,
  };
}

export async function extractStructuredData(
  messages: ConciergeMessage[],
  existing: Partial<BuyerProfile>,
): Promise<BuyerProfile> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ...defaultProfile(), ...existing } as BuyerProfile;

  const systemPrompt = `You are a precise data extraction
system. Read the conversation between an AutoLenis
car-buying concierge and a buyer. Extract ONLY explicitly
stated facts about what the buyer wants. Return JSON only,
matching the BuyerProfile schema.

CRITICAL RULES:
- Return null for any field NOT explicitly stated by the buyer
- Never invent or assume data
- Never overwrite an existing non-null value with null in the
  output — copy the existing value forward
- The "existing" object passed in IS the source of truth for
  fields the buyer has not changed in the latest turn

FIELD-SPECIFIC EXTRACTION:

ZIP code:
- A 5-digit number provided as a location
- Examples: "75024", "my zip is 33101", "zip 90210"
- If the buyer says a 5-digit number AFTER being asked for
  ZIP/location, it IS the zip — NOT a budget

Budget (budgetAmount):
- A dollar amount the buyer states as their price ceiling
- Must be EXPLICITLY about money: "$45,000", "45k", "45 thousand",
  "budget of forty five thousand"
- A bare 5-digit number is NEVER a budget unless preceded by $
  or the words "budget", "price", "dollars", or "k"
- Examples that ARE budgets: "$45,000", "around 45k", "budget 50000"
- Examples that are NOT budgets: "75024" (this is ZIP)

Monthly payment:
- Only set if buyer explicitly says "per month", "/mo", "monthly"
- Example: "$600/month", "500 a month"

Phone:
- Format as E.164: +1XXXXXXXXXX for US numbers
- Strip all spaces, dashes, parentheses
- Example: "954-756-2509" → "+19547562509"

Timeline — NORMALIZE these natural phrases:
- "this_week" matches: "this week", "asap", "right away",
  "immediately", "today", "tomorrow", "in the next few days",
  "ready now", "ready to buy", "now"
- "1_to_3_months" matches: "next month", "in a few weeks",
  "within 30 days", "next couple months", "1-3 months",
  "soon", "in the next month or two"
- "researching" matches: "just looking", "researching",
  "browsing", "not sure yet", "gathering info", "no rush"

VehicleType:
- "new" if buyer says new, brand new, current year model
- "used" if buyer says used, pre-owned, certified pre-owned
- "open" if buyer says open to both or has no preference
- null otherwise

Make and model:
- Extract proper noun vehicle makes (Toyota, Honda, Ford,
  Chevrolet, BMW, etc.) and models (Highlander, Camry,
  F-150, etc.) exactly as the buyer states them

Output ONLY valid JSON matching the BuyerProfile interface.
No commentary. No explanation.`;

  const userPrompt = `Existing extracted data:\n${JSON.stringify(existing, null, 2)}\n\nConversation:\n${messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n")}\n\nReturn updated JSON.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MESSAGING,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        reasoning_effort: "low",
        max_tokens: 512,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return { ...defaultProfile(), ...existing } as BuyerProfile;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "{}";
    const rawParsed = JSON.parse(text);

    // Coerce LLM output to correct types before merging.
    // LLMs sometimes return numbers as strings — never trust the JSON.
    const parsed = coerceBuyerProfile(rawParsed);

    const merged: BuyerProfile = { ...defaultProfile(), ...existing };
    for (const key of Object.keys(parsed) as Array<keyof BuyerProfile>) {
      const newVal = parsed[key];
      if (newVal !== null && newVal !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = newVal;
      }
    }
    return merged;
  } catch (err) {
    logger.error("[extractStructuredData] Failed:", err);
    return { ...defaultProfile(), ...existing } as BuyerProfile;
  }
}

// ───────────────────────────────────────────────────
// TYPE COERCION
// ───────────────────────────────────────────────────
// LLMs do not reliably return correct JSON types.
// Coerce every field at the boundary before trusting it.

function coerceInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const parsed = parseInt(cleaned, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function coerceBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (["true", "yes", "y", "1"].includes(lower)) return true;
    if (["false", "no", "n", "0"].includes(lower)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return null;
}

function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  const match = allowed.find((a) => a.toLowerCase() === trimmed);
  return match ?? null;
}

function coercePhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && value.startsWith("+")) return `+${digits}`;
  return null;
}

function coerceZip(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = typeof value === "number" ? String(value) : value;
  if (typeof str !== "string") return null;
  const digits = str.replace(/[^0-9]/g, "");
  if (digits.length === 5) return digits;
  if (digits.length === 9) return digits.substring(0, 5);
  return null;
}

function coerceBuyerProfile(raw: unknown): Partial<BuyerProfile> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;

  return {
    vehicleType: coerceEnum(r.vehicleType, ["new", "used", "open"] as const),
    make: coerceString(r.make),
    model: coerceString(r.model),
    bodyStyle: coerceString(r.bodyStyle),
    yearMin: coerceInt(r.yearMin),
    yearMax: coerceInt(r.yearMax),
    trim: coerceString(r.trim),
    budgetType: coerceEnum(r.budgetType, ["cash", "monthly"] as const),
    budgetAmount: coerceInt(r.budgetAmount),
    monthlyPayment: coerceInt(r.monthlyPayment),
    timeline: coerceEnum(r.timeline, ["this_week", "1_to_3_months", "researching"] as const),
    zip: coerceZip(r.zip),
    phone: coercePhone(r.phone),
    hasTradeIn: coerceBool(r.hasTradeIn),
    financingNeeded: coerceBool(r.financingNeeded),
    firstName: coerceString(r.firstName),
  };
}
