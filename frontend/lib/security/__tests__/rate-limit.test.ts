// Fail-mode contract tests for lib/security/rate-limit.ts (Phase 0.5).
//
// Owner directive being pinned:
//   • auth limiter FAILS OPEN on store outage (+ alert via logger.error)
//   • payment-intent limiter FAILS CLOSED (503) on store outage
//   • unconfigured store (no env) → pass-through, error-logged in production
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "lib/security/__tests__/rate-limit.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable Upstash behaviour ───────────────────────────────────────────
let limitBehavior: "allow" | "deny" | "throw" = "allow";
let errorLogs: string[] = [];

mock.module("@upstash/redis", {
  namedExports: { Redis: class MockRedis {} },
});

mock.module("@upstash/ratelimit", {
  namedExports: {
    Ratelimit: Object.assign(
      class MockRatelimit {
        async limit(_key: string) {
          if (limitBehavior === "throw") throw new Error("redis unreachable");
          return { success: limitBehavior === "allow", limit: 10, remaining: 0, reset: 0 };
        }
      },
      { slidingWindow: () => ({}) },
    ),
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => { errorLogs.push(msg); },
    },
  },
});

async function loadModule() {
  // Cache-bust so each test gets fresh singletons/env evaluation.
  return import(`../rate-limit?${Math.floor(performance.now() * 1000)}`) as Promise<
    typeof import("../rate-limit")
  >;
}

beforeEach(() => {
  limitBehavior = "allow";
  errorLogs = [];
  process.env.UPSTASH_REDIS_REST_URL = "https://mock.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("payment limiter allows under the limit and 429s over it", async () => {
  const { limitPaymentIntent } = await loadModule();

  limitBehavior = "allow";
  assert.deepEqual(await limitPaymentIntent("pay:x"), { ok: true });

  limitBehavior = "deny";
  const denied = await limitPaymentIntent("pay:x");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 429);
});

test("payment limiter FAILS CLOSED (503) when the store is unreachable", async () => {
  const { limitPaymentIntent } = await loadModule();
  limitBehavior = "throw";

  const res = await limitPaymentIntent("pay:x");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 503);
  assert.ok(errorLogs.some((m) => m.includes("failing CLOSED")), "outage must be alerted");
});

test("auth limiter FAILS OPEN when the store is unreachable, with an alert", async () => {
  const { limitAuthAttempt } = await loadModule();
  limitBehavior = "throw";

  const res = await limitAuthAttempt("signin:x");
  assert.deepEqual(res, { ok: true });
  assert.ok(errorLogs.some((m) => m.includes("failing open")), "outage must be alerted");
});

test("auth limiter 429s over the limit when the store is healthy", async () => {
  const { limitAuthAttempt } = await loadModule();
  limitBehavior = "deny";

  const res = await limitAuthAttempt("signin:x");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 429);
});

// The unconfigured-store pass-through case lives in
// rate-limit-unconfigured.test.ts: the module caches its Redis client for
// serverless warm reuse, so that scenario needs a process where the store env
// was never present — the runner gives each test file its own process.
