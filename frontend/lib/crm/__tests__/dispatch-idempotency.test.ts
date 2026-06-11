// Unit tests for the in-flight idempotency fix (Step 3).
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/dispatch-idempotency.test.ts
//
// Before the fix, a duplicate request whose original was still 'processing'
// returned the stored response_payload — which is null mid-flight — as a 200,
// so a near-simultaneous retry saw an empty body as if it were the result.
// The fix branches on execution_status:
//   'processing' → reject (caller retries; NEVER a 200 with a null payload)
//   'completed'  → replay the stored payload
//   'failed'     → reclaim (treat as not-yet-succeeded; allow a retry)

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDuplicateDispatch } from "../dispatch-idempotency";

test("'processing' → reject (retryable 409, NOT a 200 with null payload)", () => {
  assert.equal(resolveDuplicateDispatch("processing"), "reject");
});

test("'completed' → replay the stored response_payload", () => {
  assert.equal(resolveDuplicateDispatch("completed"), "replay");
});

test("'failed' → reclaim (allow a retry — not-yet-succeeded)", () => {
  assert.equal(resolveDuplicateDispatch("failed"), "reclaim");
});

test("unknown / null status fails safe to reject (never replays a null payload)", () => {
  assert.equal(resolveDuplicateDispatch(null), "reject");
  assert.equal(resolveDuplicateDispatch(undefined), "reject");
  assert.equal(resolveDuplicateDispatch("something_unexpected"), "reject");
});
