// lib/ai/acquisition.ts
// Acquisition-specific AI helpers. The existing groqChat() in groq-client.ts
// hardcodes its model, so the per-function model assignments below (gpt-oss
// reasoning / messaging / safeguard) are called against the Groq REST
// endpoint directly. groqChat() itself is untouched and continues to drive
// the voice + general-purpose flows.

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
    console.error("[acquisition.extractVehicleData] failed", err);
    return merged;
  }
}

// ─── scoreLeadWithGroq — GROQ_REASONING (gpt-oss-120b, medium effort) ────────
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
      model: GROQ_REASONING,
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
    const scoreNum = coerceNumber(obj.score);
    const tempRaw = coerceString(obj.temperature);
    const tempStr = tempRaw ? tempRaw.toLowerCase() : null;
    const reasonStr = coerceString(obj.reasoning);
    if (scoreNum === null || tempStr === null || reasonStr === null) return fallback;
    const clamped = Math.max(0, Math.min(100, Math.round(scoreNum)));
    const temp = ["hot", "warm", "cold"].includes(tempStr) ? tempStr : "cold";
    return { score: clamped, temperature: temp, reasoning: reasonStr };
  } catch (err) {
    console.error("[acquisition.scoreLeadWithGroq] failed", err);
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
    console.error("[acquisition.detectOptOutIntent] failed", err);
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

  const systemPrompt = `You are a data extraction system. Read the conversation between an AutoLenis car-buying concierge and a buyer. Extract ONLY explicitly stated facts about what the buyer wants. Return JSON only.

Rules:
- Return null for any field not mentioned
- Never invent or assume data
- Merge with existing values — never overwrite a non-null existing value with null
- Phone numbers: extract digits only, format as E.164 (+1XXXXXXXXXX for US)
- Budget: extract dollar amount as integer (no commas, no dollar sign)
- Years: 4-digit integers
- Timeline: "this_week" if buying immediately, "1_to_3_months" if soon, "researching" if just looking`;

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
    const parsed = JSON.parse(text);

    const merged: BuyerProfile = { ...defaultProfile(), ...existing };
    for (const key of Object.keys(parsed) as Array<keyof BuyerProfile>) {
      const newVal = parsed[key];
      if (newVal !== null && newVal !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = newVal;
      }
    }
    return merged;
  } catch (err) {
    console.error("[extractStructuredData] Failed:", err);
    return { ...defaultProfile(), ...existing } as BuyerProfile;
  }
}
