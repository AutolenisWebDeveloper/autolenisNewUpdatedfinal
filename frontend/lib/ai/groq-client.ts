// lib/ai/groq-client.ts
// Groq API client singleton — ONLY approved AI provider
// Primary: llama-3.3-70b-versatile | Fallback: mixtral-8x7b-32768

import Groq from "groq-sdk";
import { assertAiEnabled } from "@/lib/ai/kill-switch";

const PRIMARY_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "mixtral-8x7b-32768";

// Singleton Groq client
let _client: Groq | null = null;

function getGroqClient(): Groq {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
      throw new Error("GROQ_API_KEY is not configured");
    }
    _client = new Groq({ apiKey });
  }
  return _client;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
}

// Chat completion with automatic fallback to mixtral on rate limit
export async function groqChat(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<CompletionResult> {
  assertAiEnabled();
  const client = getGroqClient();

  const params = {
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    top_p: 1.0,
  };

  // Try primary model first
  try {
    const response = await client.chat.completions.create({
      ...params,
      model: PRIMARY_MODEL,
    });
    return {
      content: response.choices[0]?.message?.content ?? "",
      model: PRIMARY_MODEL,
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    const errMsg = String(err);
    // Fallback to mixtral on rate limit or primary unavailable
    if (errMsg.includes("429") || errMsg.includes("rate_limit") || errMsg.includes("overloaded")) {
      const fallback = await client.chat.completions.create({
        ...params,
        model: FALLBACK_MODEL,
      });
      return {
        content: fallback.choices[0]?.message?.content ?? "",
        model: FALLBACK_MODEL,
        tokensUsed: fallback.usage?.total_tokens ?? 0,
      };
    }
    throw err;
  }
}

// Streaming completion (returns async iterable)
export async function* groqChatStream(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string, void, unknown> {
  assertAiEnabled();
  const client = getGroqClient();

  const stream = await client.chat.completions.create({
    model: PRIMARY_MODEL,
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
