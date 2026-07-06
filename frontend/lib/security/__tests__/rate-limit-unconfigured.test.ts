// Unconfigured-store contract for lib/security/rate-limit.ts (Phase 0.5).
//
// With no Redis env at all, both tiers pass through unchanged (deploys
// without the secret keep working). Separate file from rate-limit.test.ts
// because the module caches its Redis client per process — this scenario
// needs a process where the store env was never present.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "lib/security/__tests__/rate-limit-unconfigured.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

mock.module("@upstash/redis", {
  namedExports: {
    Redis: class MockRedis {
      constructor() {
        throw new Error("Redis client must not be constructed without store env");
      }
    },
  },
});

mock.module("@upstash/ratelimit", {
  namedExports: {
    Ratelimit: Object.assign(
      class MockRatelimit {
        async limit() {
          return { success: false }; // must never be reached
        }
      },
      { slidingWindow: () => ({}) },
    ),
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  },
});

test("unconfigured store passes through on both tiers", async () => {
  const { limitAuthAttempt, limitPaymentIntent, limitGeneral } = await import("../rate-limit");

  assert.deepEqual(await limitAuthAttempt("signin:x"), { ok: true });
  assert.deepEqual(await limitPaymentIntent("pay:x"), { ok: true });
  assert.deepEqual(await limitGeneral("gen:x"), { ok: true });
});
