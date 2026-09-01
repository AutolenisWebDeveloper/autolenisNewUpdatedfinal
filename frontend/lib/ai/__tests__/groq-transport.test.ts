// Transport fidelity for the Groq adapter.
//
// The migration's whole promise is "only the transport line changes". Two of the
// things that make that true are invisible in a diff and were found by an
// adversarial review of this change:
//
//   1. `groqChat` used the groq-sdk, which applies `maxRetries: 2` and a 60s
//      per-request timeout to EVERY request (groq-sdk core.js). Moving to a bare
//      fetch silently dropped both for all fourteen of its call sites.
//   2. The direct-`fetch` modules the adapter absorbed never retried and never
//      timed out. Giving them retries would be just as much of a change.
//
// So the policy is per-request, and these tests pin both halves.
//
//   pnpm test:zura

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("@/lib/ai/kill-switch", {
  namedExports: {
    assertAiEnabledForModelCall: async () => {},
    isAiEnabled: () => true,
    isAiEnabledAsync: async () => true,
    assertAiEnabled: () => {},
    invalidateKillSwitchCache: () => {},
    __resetKillSwitchCacheForTests: () => {},
    AI_KILL_SWITCH_FLAG: "ai_kill_switch",
    KILL_FLAG_CACHE_MS: 10_000,
  },
});

interface Attempt {
  model: string;
  hasSignal: boolean;
}
let attempts: Attempt[] = [];
/** Status returned per attempt; the last value repeats once exhausted. */
let statuses: number[] = [];

const realFetch = globalThis.fetch;

function okBody(model: string) {
  return JSON.stringify({
    choices: [{ message: { content: `answered by ${model}` } }],
    usage: { total_tokens: 7 },
  });
}

beforeEach(() => {
  attempts = [];
  statuses = [200];
  process.env.GROQ_API_KEY = "gsk_test_key";
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string };
    attempts.push({ model: body.model, hasSignal: !!init.signal });
    const status = statuses[Math.min(attempts.length - 1, statuses.length - 1)];
    return new Response(status === 200 ? okBody(body.model) : "upstream said no", { status });
  }) as unknown as typeof fetch;
});

function restore() {
  globalThis.fetch = realFetch;
}

test("groqChat retries a transient failure twice — the groq-sdk default it replaced", async () => {
  const { groqChat } = await import("@/lib/ai/groq-client");
  statuses = [500, 500, 200];
  const result = await groqChat([{ role: "user", content: "hi" }]);
  assert.equal(attempts.length, 3, "one attempt plus two retries");
  assert.match(result.content, /answered by/);
  restore();
});

test("groqChat gives up after the declared retries rather than looping", async () => {
  const { groqChat } = await import("@/lib/ai/groq-client");
  statuses = [500];
  await assert.rejects(() => groqChat([{ role: "user", content: "hi" }]));
  assert.equal(attempts.length, 3);
  restore();
});

test("groqChat does NOT retry a non-transient failure", async () => {
  const { groqChat } = await import("@/lib/ai/groq-client");
  statuses = [400];
  await assert.rejects(() => groqChat([{ role: "user", content: "hi" }]));
  assert.equal(attempts.length, 1, "a 400 is the caller's fault; retrying it is waste");
  restore();
});

test("groqChat sends an abort signal — the 60s per-request timeout is restored", async () => {
  const { groqChat } = await import("@/lib/ai/groq-client");
  await groqChat([{ role: "user", content: "hi" }]);
  assert.equal(attempts[0].hasSignal, true);
  restore();
});

test("a direct `complete()` caller gets NO retries and NO timeout, as before", async () => {
  // The modules that previously used a bare fetch must keep exactly that.
  const { complete } = await import("@/lib/ai/provider");
  statuses = [500];
  await assert.rejects(() =>
    complete({
      purpose: "test.direct",
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "hi" }],
    }),
  );
  assert.equal(attempts.length, 1, "a migrated direct-fetch caller must not gain retries");
  assert.equal(attempts[0].hasSignal, false, "…nor a timeout it never had");
  restore();
});

test("the 120b→20b fallback fires on 429, exactly as the original predicate did", async () => {
  const { groqChat } = await import("@/lib/ai/groq-client");
  // 429 is retryable, so the primary is attempted three times before the
  // fallback model is tried.
  statuses = [429, 429, 429, 200];
  const result = await groqChat([{ role: "user", content: "hi" }]);
  assert.equal(attempts[0].model, "openai/gpt-oss-120b");
  assert.equal(attempts[attempts.length - 1].model, "openai/gpt-oss-20b");
  assert.equal(result.model, "openai/gpt-oss-20b", "the result must name who actually answered");
  restore();
});

test("the fallback does NOT fire on 503 — that widening was reverted", async () => {
  // The original predicate matched "429" / "rate_limit" / "overloaded" only.
  // Downgrading to the smaller model during an outage the original surfaced as
  // an error would be a behaviour change.
  const { groqChat } = await import("@/lib/ai/groq-client");
  statuses = [503];
  await assert.rejects(() => groqChat([{ role: "user", content: "hi" }]));
  assert.ok(
    attempts.every((a) => a.model === "openai/gpt-oss-120b"),
    "a 503 must surface as an error, not as a silent model downgrade",
  );
  restore();
});
