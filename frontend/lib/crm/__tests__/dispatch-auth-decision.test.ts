// Unit tests for the two-path dispatch auth decision (HMAC + static key).
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/dispatch-auth-decision.test.ts
//
// Precedence under test (decideDispatchAuth):
//   1. X-AutoLenis-Signature present → verify HMAC (PRIMARY, unchanged).
//   2. else X-Dispatch-Key present   → constant-time compare vs CRM_DISPATCH_KEY.
//   3. else                          → missing_auth.
// Replay/idempotency/rate-limit live in authorizeDispatch AFTER this decision
// and apply to both paths; they are covered by their own checks.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { decideDispatchAuth } from "../dispatch-auth-decision";

const SECRET = "hmac-secret-for-code-callers";
const STATIC_KEY = "PA8m1n0Vn0Yk0v2bq1Zr3Xw9Lc4Td7Up6Hs5Jf8Kg=";
const BODY = JSON.stringify({ contactId: "c_1", idempotencyKey: "k_1" });

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("valid X-Dispatch-Key → passes auth (static_key)", () => {
  const d = decideDispatchAuth({
    signatureHeader: null,
    dispatchKeyHeader: STATIC_KEY,
    rawBody: BODY,
    hmacSecret: SECRET,
    staticKey: STATIC_KEY,
  });
  assert.deepEqual(d, { ok: true, method: "static_key" });
});

test("wrong X-Dispatch-Key → 401 bad_key", () => {
  const d = decideDispatchAuth({
    signatureHeader: null,
    dispatchKeyHeader: "not-the-key",
    rawBody: BODY,
    hmacSecret: SECRET,
    staticKey: STATIC_KEY,
  });
  assert.deepEqual(d, { ok: false, reason: "bad_key" });
});

test("neither signature nor dispatch key → 401 missing_auth", () => {
  const d = decideDispatchAuth({
    signatureHeader: null,
    dispatchKeyHeader: null,
    rawBody: BODY,
    hmacSecret: SECRET,
    staticKey: STATIC_KEY,
  });
  assert.deepEqual(d, { ok: false, reason: "missing_auth" });
});

test("REGRESSION: valid X-AutoLenis-Signature still passes (HMAC path unbroken)", () => {
  const d = decideDispatchAuth({
    signatureHeader: sign(BODY),
    dispatchKeyHeader: null,
    rawBody: BODY,
    hmacSecret: SECRET,
    staticKey: STATIC_KEY,
  });
  assert.deepEqual(d, { ok: true, method: "hmac" });
});

test("signature takes precedence over key; a bad signature is NOT rescued by a valid key", () => {
  const d = decideDispatchAuth({
    signatureHeader: "deadbeef",
    dispatchKeyHeader: STATIC_KEY, // valid key present, but signature header wins
    rawBody: BODY,
    hmacSecret: SECRET,
    staticKey: STATIC_KEY,
  });
  assert.deepEqual(d, { ok: false, reason: "bad_signature" });
});

test("static-key path with CRM_DISPATCH_KEY unset → dispatch_not_configured (never auto-pass)", () => {
  const d = decideDispatchAuth({
    signatureHeader: null,
    dispatchKeyHeader: STATIC_KEY,
    rawBody: BODY,
    hmacSecret: SECRET,
    staticKey: undefined,
  });
  assert.deepEqual(d, { ok: false, reason: "dispatch_not_configured" });
});
