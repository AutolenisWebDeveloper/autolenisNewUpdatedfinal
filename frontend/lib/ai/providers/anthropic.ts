// lib/ai/providers/anthropic.ts
//
// Anthropic Messages transport. The ONLY module permitted to name
// `api.anthropic.com`.
//
// One caller today (`lib/services/acquisition/twilio.service.ts` — the hot-lead
// buyer SMS drafter). Its request shape is preserved exactly: the system prompt
// travels in the top-level `system` field, user turns in `messages`, and the
// reply is read from the first `text` content block.
//
// The kill switch is asserted upstream in `lib/ai/provider.ts`, never here.

import { ProviderHttpError } from "@/lib/ai/provider-errors";
import type { CompletionRequest, CompletionResult } from "@/lib/ai/provider";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicRawResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  return key;
}

export async function messages(req: CompletionRequest): Promise<CompletionResult> {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const payload: Record<string, unknown> = {
    model: req.model,
    // Anthropic requires max_tokens; the sole caller sets it explicitly.
    max_tokens: req.maxTokens ?? 1024,
    messages: turns,
  };
  if (system) payload.system = system;
  if (req.temperature !== undefined) payload.temperature = req.temperature;
  if (req.topP !== undefined) payload.top_p = req.topP;

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderHttpError("Anthropic", res.status, detail);
  }

  const data = (await res.json()) as AnthropicRawResponse;
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  return {
    content: text,
    model: req.model as string,
    provider: "anthropic",
    tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    raw: data,
  };
}
