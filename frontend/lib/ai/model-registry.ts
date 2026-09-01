// lib/ai/model-registry.ts
//
// The closed set of model identifiers this application may call, and which
// provider serves each. Split out of `lib/ai/provider.ts` so a module that only
// needs to READ the inventory — the /admin/ai console does — never pulls a
// provider SDK in with it.
//
// A closed union is what makes the console's provider list render from truth
// instead of drifting: the page previously asserted "Groq API (only approved
// provider)" and "Anthropic, OpenAI, Gemini, and Cohere are explicitly
// prohibited" while Gemini, Claude Haiku and Whisper all ran in production.
// Adding a model is now a deliberate edit here, reviewed like any other change.

// ─── The closed set of model identifiers this application may call ───────────
// A closed union is what makes the /admin/ai console's provider list render
// from truth instead of drifting (Phase 2 §3.5 property 3). Adding a model is a
// deliberate edit here, reviewed like any other change.
export const GROQ_MODEL_IDS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-safeguard-20b",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "groq/compound",
  "groq/compound-mini",
] as const;

export const GEMINI_MODEL_IDS = ["gemini-2.5-flash"] as const;

export const ANTHROPIC_MODEL_IDS = ["claude-haiku-4-5"] as const;

/** Audio models. Not usable with `complete()` — see `transcribeAudio()`. */
export const OPENAI_AUDIO_MODEL_IDS = ["whisper-1"] as const;

export const MODEL_IDS = [
  ...GROQ_MODEL_IDS,
  ...GEMINI_MODEL_IDS,
  ...ANTHROPIC_MODEL_IDS,
  ...OPENAI_AUDIO_MODEL_IDS,
] as const;

export type GroqModelId = (typeof GROQ_MODEL_IDS)[number];
export type GeminiModelId = (typeof GEMINI_MODEL_IDS)[number];
export type AnthropicModelId = (typeof ANTHROPIC_MODEL_IDS)[number];
export type OpenAiAudioModelId = (typeof OPENAI_AUDIO_MODEL_IDS)[number];
export type ModelId = (typeof MODEL_IDS)[number];

/** Every model `complete()` accepts — the full set minus the audio models. */
export type ChatModelId = Exclude<ModelId, OpenAiAudioModelId>;

export type ProviderName = "groq" | "gemini" | "anthropic" | "openai";

/** Which provider serves a model id. Unknown ids are a programming error. */
export function providerForModel(model: ModelId): ProviderName {
  if ((GROQ_MODEL_IDS as readonly string[]).includes(model)) return "groq";
  if ((GEMINI_MODEL_IDS as readonly string[]).includes(model)) return "gemini";
  if ((ANTHROPIC_MODEL_IDS as readonly string[]).includes(model)) return "anthropic";
  if ((OPENAI_AUDIO_MODEL_IDS as readonly string[]).includes(model)) return "openai";
  throw new Error(`[ai/provider] Unknown model id: ${String(model)}`);
}

/** The provider inventory the /admin/ai console renders. Single source of truth. */
export function modelInventory(): Array<{ provider: ProviderName; models: readonly string[] }> {
  return [
    { provider: "groq", models: GROQ_MODEL_IDS },
    { provider: "gemini", models: GEMINI_MODEL_IDS },
    { provider: "anthropic", models: ANTHROPIC_MODEL_IDS },
    { provider: "openai", models: OPENAI_AUDIO_MODEL_IDS },
  ];
}

