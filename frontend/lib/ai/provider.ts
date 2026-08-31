// lib/ai/provider.ts
//
// THE model-call chokepoint. Every model call in AutoLenis passes through this
// module, and this module is the ONE place `assertAiEnabled()` runs.
//
// Why this exists (Phase 1 §C.15 / Phase 2 §3.5): the kill switch was enforced
// on 1 of 19 model call paths because enforcement was a convention, not a
// structure. Eighteen modules reached a provider's HTTP endpoint (or SDK)
// directly, each with its own prompt, model id and error handling. A code-review
// rule cannot hold that line; a chokepoint can.
//
// What this module does NOT change: every caller keeps its prompt, its model id,
// its temperature, its token cap, its response format and its behaviour. Only
// the transport line moves. `lib/ai/__tests__/provider-chokepoint.test.ts`
// mechanically asserts that no module outside `lib/ai/providers/` speaks a
// provider's wire protocol.
//
// Provider-native shapes that have no cross-provider meaning (Gemini grounding
// tools + grounding metadata, OpenAI audio transcription) are served by dedicated
// entry points here rather than being flattened into a lowest-common-denominator
// chat call — flattening them would have changed caller behaviour, which is
// exactly what this migration must not do. All of them share one gate.

import { assertAiEnabledForModelCall } from "@/lib/ai/kill-switch";
import * as groq from "@/lib/ai/providers/groq";
import * as gemini from "@/lib/ai/providers/gemini";
import * as anthropic from "@/lib/ai/providers/anthropic";
import * as openaiAudio from "@/lib/ai/providers/openai";

// ─── Message shape (unchanged from lib/ai/groq-client.ts) ────────────────────
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export {
  GROQ_MODEL_IDS,
  GEMINI_MODEL_IDS,
  ANTHROPIC_MODEL_IDS,
  OPENAI_AUDIO_MODEL_IDS,
  MODEL_IDS,
  providerForModel,
  modelInventory,
} from "@/lib/ai/model-registry";
export type {
  GroqModelId,
  GeminiModelId,
  AnthropicModelId,
  OpenAiAudioModelId,
  ModelId,
  ChatModelId,
  ProviderName,
} from "@/lib/ai/model-registry";

import { providerForModel } from "@/lib/ai/model-registry";
import type {
  ChatModelId,
  GroqModelId,
  GeminiModelId,
  AnthropicModelId,
  OpenAiAudioModelId,
  ProviderName,
} from "@/lib/ai/model-registry";

// ─── Requests ────────────────────────────────────────────────────────────────
export interface CompletionRequest {
  /**
   * A stable, non-PII label for WHY this call is being made — e.g.
   * "zura.buyer.chat", "acquisition.extract_structured_data". Carried into the
   * AI audit trail and structured logs so a model call is attributable to a
   * capability rather than to a file path.
   */
  purpose: string;
  model: ChatModelId;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** gpt-oss family knob. Groq only; ignored elsewhere. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Ask for a strict-JSON body. Groq/OpenAI-compatible only. */
  responseFormatJson?: boolean;
  /**
   * Secondary model tried when the primary is rate-limited/overloaded. This is
   * the existing `groqChat` 120b → 20b chain, preserved verbatim; it fires only
   * on 429 / rate_limit / overloaded, never on a generic error.
   */
  fallbackModel?: ChatModelId;
  /** Request-level abort/timeout, passed straight to `fetch`. */
  signal?: AbortSignal;
  /** Provider-native extras with no cross-provider meaning. */
  providerOptions?: {
    /** Gemini `tools` array (e.g. `[{ googleMaps: {} }]`, `[{ googleSearch: {} }]`). */
    geminiTools?: unknown[];
    /**
     * Groq Compound knobs. These models take `max_completion_tokens` rather
     * than `max_tokens`, plus a `compound_custom.tools.enabled_tools` allowlist
     * and `search_settings`. The caller reads the executed-tool search results
     * back off `CompletionResult.raw`.
     */
    groqCompound?: {
      maxCompletionTokens?: number;
      enabledTools?: string[];
      searchCountry?: string;
    };
  };
}

export interface CompletionResult {
  content: string;
  /** The model that ACTUALLY answered — reflects a fallback when one fired. */
  model: string;
  provider: ProviderName;
  tokensUsed: number;
  /**
   * The provider's parsed response body. Present so callers that legitimately
   * need provider-native detail (Gemini grounding metadata) keep the behaviour
   * they had before this adapter existed.
   */
  raw: unknown;
}

export interface TranscriptionRequest {
  purpose: string;
  model: OpenAiAudioModelId;
  audio: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
  prompt?: string;
  responseFormat?: "json" | "verbose_json" | "text";
}

export interface TranscriptionResult {
  model: string;
  provider: "openai";
  raw: unknown;
}

// ─── The single gate ─────────────────────────────────────────────────────────
// Every exported call below runs this first. It is the whole reason this module
// exists, and it is why the kill switch now reaches all 19 paths.
async function gate(purpose: string): Promise<void> {
  await assertAiEnabledForModelCall(purpose);
}

// ─── Chat completion ─────────────────────────────────────────────────────────
export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  await gate(req.purpose);
  const provider = providerForModel(req.model);
  switch (provider) {
    case "groq":
      return groq.chat(req as CompletionRequest & { model: GroqModelId });
    case "gemini":
      return gemini.generate(req as CompletionRequest & { model: GeminiModelId });
    case "anthropic":
      return anthropic.messages(req as CompletionRequest & { model: AnthropicModelId });
    case "openai":
      throw new Error(
        `[ai/provider] ${req.model} is an audio model — use transcribeAudio(), not complete().`,
      );
  }
}

// ─── Streaming chat completion ───────────────────────────────────────────────
// Kept a distinct entry point because a generator cannot be awaited into
// existence: the gate has to run inside it, on first pull.
export async function* completeStream(
  req: CompletionRequest,
): AsyncGenerator<string, void, unknown> {
  await gate(req.purpose);
  const provider = providerForModel(req.model);
  if (provider !== "groq") {
    throw new Error(`[ai/provider] Streaming is implemented for Groq only (got ${provider}).`);
  }
  yield* groq.chatStream(req as CompletionRequest & { model: GroqModelId });
}

// ─── Audio transcription ─────────────────────────────────────────────────────
export async function transcribeAudio(req: TranscriptionRequest): Promise<TranscriptionResult> {
  await gate(req.purpose);
  return openaiAudio.transcribe(req);
}
