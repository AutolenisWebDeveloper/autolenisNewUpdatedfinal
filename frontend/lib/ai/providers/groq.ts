// lib/ai/providers/groq.ts
//
// Groq transport. The ONLY module permitted to name `api.groq.com`.
//
// This adapter is a transport move, not a rewrite. It preserves, verbatim:
//   • the OpenAI-compatible chat/completions body every caller was already
//     sending (model, messages, max_tokens, temperature, top_p,
//     reasoning_effort, response_format);
//   • `groqChat`'s fallback chain — 429 / rate_limit / overloaded on the primary
//     model retries once on the caller's declared fallback model, and the
//     returned `model` says which one actually answered
//     (autolenis-system-architecture rule 10: document the fallback, log who
//     fired);
//   • the SSE streaming reader shape `streamConcierge` used.
//
// The kill switch is NOT asserted here — it is asserted once, upstream, in
// `lib/ai/provider.ts`. Asserting it in both places would re-create the
// per-module discipline problem this chokepoint exists to remove.

import { ProviderHttpError } from "@/lib/ai/provider-errors";
import type { CompletionRequest, CompletionResult } from "@/lib/ai/provider";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqRawResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
}

function apiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  return key;
}

// Every optional field is emitted ONLY when the caller set it. The adapter must
// not invent defaults: several migrated call sites deliberately omitted
// `temperature` or `top_p` and relied on Groq's server-side default, so filling
// them in here would silently change those callers' behaviour — the one thing
// this transport migration must never do. Defaults live at the caller.
function body(req: CompletionRequest, model: string, stream: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    model,
    messages: req.messages,
  };
  if (req.maxTokens !== undefined) out.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.topP !== undefined) out.top_p = req.topP;
  if (req.reasoningEffort) out.reasoning_effort = req.reasoningEffort;
  const compound = req.providerOptions?.groqCompound;
  if (compound) {
    if (compound.maxCompletionTokens !== undefined) {
      out.max_completion_tokens = compound.maxCompletionTokens;
    }
    if (compound.enabledTools) {
      out.compound_custom = { tools: { enabled_tools: compound.enabledTools } };
    }
    if (compound.searchCountry) out.search_settings = { country: compound.searchCountry };
  }
  if (req.responseFormatJson) out.response_format = { type: "json_object" };
  if (stream) out.stream = true;
  return out;
}

/**
 * Exactly the conditions the original `groqChat` fallback reacted to: its
 * predicate was `String(err)` containing "429", "rate_limit" or "overloaded".
 *
 * 503 is deliberately NOT here. Adding it would silently downgrade an answer to
 * the smaller model during an outage the original surfaced as an error — a
 * behaviour change, and this migration changes transport only.
 */
function isOverloaded(status: number, detail: string): boolean {
  if (status === 429) return true;
  const s = detail.toLowerCase();
  return s.includes("rate_limit") || s.includes("overloaded");
}

/** Transient conditions worth another attempt — the groq-sdk's own set. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postOnce(
  req: CompletionRequest,
  model: string,
  stream: boolean,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body(req, model, stream)),
    ...(signal ? { signal } : {}),
  });
}

/**
 * One request, with the caller's declared retry and timeout policy.
 *
 * `maxRetries` and `timeoutMs` both default to absent, so a call site that
 * previously used a bare `fetch` keeps exactly the behaviour it had. Only
 * `lib/ai/groq-client.ts` opts in, restoring the groq-sdk defaults (2 retries,
 * 60s per attempt) that its fourteen callers were built against.
 */
async function post(req: CompletionRequest, model: string, stream: boolean): Promise<Response> {
  const attempts = (req.maxRetries ?? 0) + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // A per-attempt timeout, combined with any caller-supplied signal so an
    // explicit abort still wins immediately.
    const timer = req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined;
    const signal =
      timer && req.signal
        ? AbortSignal.any([timer, req.signal])
        : (timer ?? req.signal);

    try {
      const res = await postOnce(req, model, stream, signal);
      if (res.ok || !isRetryable(res.status) || attempt === attempts - 1) return res;
      // Drain the body so the connection can be reused before retrying.
      await res.text().catch(() => "");
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1) throw err;
    }
    // Exponential backoff with a small floor, as the SDK does.
    await sleep(Math.min(500 * 2 ** attempt, 4_000));
  }

  throw lastError ?? new Error("Groq request failed with no response");
}

export async function chat(req: CompletionRequest): Promise<CompletionResult> {
  const primary = req.model as string;
  let res = await post(req, primary, false);
  let answered = primary;

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (req.fallbackModel && isOverloaded(res.status, detail)) {
      answered = req.fallbackModel as string;
      res = await post(req, answered, false);
      if (!res.ok) {
        const d2 = await res.text().catch(() => "");
        throw new ProviderHttpError("Groq", res.status, d2);
      }
    } else {
      throw new ProviderHttpError("Groq", res.status, detail);
    }
  }

  const data = (await res.json()) as GroqRawResponse;
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model: answered,
    provider: "groq",
    tokensUsed: data.usage?.total_tokens ?? 0,
    raw: data,
  };
}

export async function* chatStream(
  req: CompletionRequest,
): AsyncGenerator<string, void, unknown> {
  const res = await post(req, req.model as string, true);
  if (!res.ok || !res.body) {
    const detail = res.ok ? "no response body" : await res.text().catch(() => "");
    throw new ProviderHttpError("Groq", res.status, String(detail));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // The final element may be a partial line — hold it for the next chunk.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // A malformed SSE frame is skipped rather than killing the stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
