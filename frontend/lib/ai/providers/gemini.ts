// lib/ai/providers/gemini.ts
//
// Google Gemini transport. The ONLY module permitted to name
// `generativelanguage.googleapis.com`.
//
// Gemini's request and response shapes are genuinely different from the
// OpenAI-compatible ones: `contents`/`parts` in, `candidates[].content.parts[]`
// plus `groundingMetadata` out, and grounding `tools` (googleMaps / googleSearch)
// that have no cross-provider equivalent. The callers migrated onto this adapter
// read that grounding metadata, so the adapter returns the parsed body on
// `raw` — flattening it to a content string would have changed their behaviour,
// and this migration changes transport only.
//
// The kill switch is asserted upstream in `lib/ai/provider.ts`, never here.

import { ProviderHttpError } from "@/lib/ai/provider-errors";
import type { CompletionRequest, CompletionResult } from "@/lib/ai/provider";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiRawResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: unknown;
  }>;
  usageMetadata?: { totalTokenCount?: number };
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return key;
}

export async function generate(req: CompletionRequest): Promise<CompletionResult> {
  // Gemini carries the system prompt out-of-band. Every `system` message is
  // concatenated into `systemInstruction`; the rest becomes `contents`.
  const systemText = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
  if (req.topP !== undefined) generationConfig.topP = req.topP;
  if (req.responseFormatJson) generationConfig.responseMimeType = "application/json";

  const payload: Record<string, unknown> = { contents };
  if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
  if (req.providerOptions?.geminiTools) payload.tools = req.providerOptions.geminiTools;
  if (Object.keys(generationConfig).length > 0) payload.generationConfig = generationConfig;

  const url = `${GEMINI_BASE}/${req.model}:generateContent?key=${apiKey()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderHttpError("Gemini", res.status, detail);
  }

  const data = (await res.json()) as GeminiRawResponse;
  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  return {
    content,
    model: req.model as string,
    provider: "gemini",
    tokensUsed: data.usageMetadata?.totalTokenCount ?? 0,
    raw: data,
  };
}
