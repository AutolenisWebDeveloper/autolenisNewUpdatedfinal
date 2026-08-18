// Unit tests for the REAL isFinalAttempt predicate (no mock).
//
// S1's recovery contract depends on this returning true on the last Inngest
// attempt so the worker dead-letters AND releases the guard (re-drivable by the
// reconciler). Inngest v3 exposes a zero-indexed `attempt` and `maxAttempts`
// (total allowed). The final attempt is maxAttempts - 1.
//
// Run with:  npx tsx --test lib/inngest/__tests__/idempotency.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isFinalAttempt } from "../idempotency";

test("first attempt of a retries:3 function (maxAttempts 4) is not final", () => {
  assert.equal(isFinalAttempt({ attempt: 0, maxAttempts: 4 }), false);
});

test("a middle attempt is not final", () => {
  assert.equal(isFinalAttempt({ attempt: 2, maxAttempts: 4 }), false);
});

test("the last attempt (maxAttempts - 1) is final", () => {
  assert.equal(isFinalAttempt({ attempt: 3, maxAttempts: 4 }), true);
});

test("attempt beyond the max is still final (defensive)", () => {
  assert.equal(isFinalAttempt({ attempt: 5, maxAttempts: 4 }), true);
});

test("returns false when the max is absent (never wrongly dead-letters early)", () => {
  assert.equal(isFinalAttempt({ attempt: 0 }), false);
  assert.equal(isFinalAttempt({}), false);
});

test("supports a retries-remaining fallback shape", () => {
  assert.equal(isFinalAttempt({ attempt: 2, maxRetries: 3 }), false);
  assert.equal(isFinalAttempt({ attempt: 3, maxRetries: 3 }), true);
});
