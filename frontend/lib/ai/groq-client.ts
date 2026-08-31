// lib/ai/groq-client.ts
//
// The legacy Groq helper, now a THIN FACADE over the provider chokepoint
// (`lib/ai/provider.ts`). It keeps its exported signatures so its fourteen
// existing call sites are unchanged, and it keeps its model pair and fallback
// chain — but the transport, the SDK construction and the kill-switch assertion
// all moved to the one place that owns them.
//
// Primary: openai/gpt-oss-120b | Fallback: openai/gpt-oss-20b
//
// New code should call `complete()` from `lib/ai/provider.ts` directly with an
// explicit `purpose` and an explicit model, rather than inheriting this
// module's defaults.

import { complete, completeStream, type ChatMessage as ProviderChatMessage } from "@/lib/ai/provider";

const PRIMARY_MODEL = "openai/gpt-oss-120b" as const;
const FALLBACK_MODEL = "openai/gpt-oss-20b" as const;

export type ChatMessage = ProviderChatMessage;

export interface CompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
}

export interface GroqChatOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * Stable, non-PII label for why this call is being made, carried into the AI
   * audit trail and logs. Defaults to a generic label so existing call sites
   * keep compiling; prefer passing a real one.
   */
  purpose?: string;
}

/** Chat completion with automatic fallback to the secondary model on rate limit. */
export async function groqChat(
  messages: ChatMessage[],
  options: GroqChatOptions = {},
): Promise<CompletionResult> {
  const result = await complete({
    purpose: options.purpose ?? "legacy.groq_chat",
    model: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    messages,
    maxTokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    topP: 1.0,
  });
  return { content: result.content, model: result.model, tokensUsed: result.tokensUsed };
}

/** Streaming completion (returns async iterable). No fallback, as before. */
export async function* groqChatStream(
  messages: ChatMessage[],
  options: GroqChatOptions = {},
): AsyncGenerator<string, void, unknown> {
  yield* completeStream({
    purpose: options.purpose ?? "legacy.groq_chat_stream",
    model: PRIMARY_MODEL,
    messages,
    maxTokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
  });
}
