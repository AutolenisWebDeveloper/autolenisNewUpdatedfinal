// PROOF: when the configured dispatch credential is UNSET or EMPTY, the auth
// decision must REJECT — it must never constant-time-compare an incoming header
// against `undefined`/"" and pass. A falsy secret can only ever mean
// `dispatch_not_configured`, which the real gate surfaces as 401.
//
// Two layers are proven here:
//   1. decideDispatchAuth (pure) — for BOTH credentials (CRM_DISPATCH_SECRET →
//      hmacSecret, CRM_DISPATCH_KEY → staticKey) and BOTH falsy shapes
//      (undefined and ""), with a header present, the result is
//      `dispatch_not_configured` and is NEVER `ok: true`.
//   2. authorizeDispatch (real NextRequest) — the same condition returns an
//      actual HTTP 401, before any Supabase/Prisma call.
//
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/dispatch-auth-unset-secret.proof.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { decideDispatchAuth } from "../dispatch-auth-decision";
import { authorizeDispatch } from "../dispatch-auth";

const STATIC_KEY = "PA8m1n0Vn0Yk0v2bq1Zr3Xw9Lc4Td7Up6Hs5Jf8Kg=";
const SECRET = "hmac-secret-for-code-callers";
const BODY = JSON.stringify({ contactId: "c_1" });

// ---------------------------------------------------------------------------
// Layer 1 — pure decision. The header is PRESENT and (for the static path) even
// equals the value an attacker might guess; the only variable is the falsy
// configured secret. Passing here would be the vulnerability.
// ---------------------------------------------------------------------------

for (const staticKey of [undefined, ""] as const) {
  test(`static-key path with CRM_DISPATCH_KEY=${JSON.stringify(staticKey)} → dispatch_not_configured (never auto-pass)`, () => {
    const d = decideDispatchAuth({
      signatureHeader: null,
      dispatchKeyHeader: STATIC_KEY, // a real-looking header presented by the caller
      rawBody: BODY,
      hmacSecret: SECRET,
      staticKey,
    });
    assert.deepEqual(d, { ok: false, reason: "dispatch_not_configured" });
  });

  // The empty-string trap specifically: an attacker sending an empty header must
  // not be matched against an empty configured key.
  test(`static-key path with empty header AND CRM_DISPATCH_KEY=${JSON.stringify(staticKey)} → still rejects (no ""==="" pass)`, () => {
    const d = decideDispatchAuth({
      signatureHeader: null,
      dispatchKeyHeader: "", // falsy header is treated as "no credential"
      rawBody: BODY,
      hmacSecret: SECRET,
      staticKey,
    });
    assert.equal(d.ok, false);
  });
}

for (const hmacSecret of [undefined, ""] as const) {
  test(`HMAC path with CRM_DISPATCH_SECRET=${JSON.stringify(hmacSecret)} → dispatch_not_configured (never auto-pass)`, () => {
    const d = decideDispatchAuth({
      signatureHeader: "deadbeefcafe", // signature presented; selects the HMAC path
      dispatchKeyHeader: null,
      rawBody: BODY,
      hmacSecret,
      staticKey: STATIC_KEY,
    });
    assert.deepEqual(d, { ok: false, reason: "dispatch_not_configured" });
  });
}

// ---------------------------------------------------------------------------
// Layer 2 — real gate → real 401. dispatch_not_configured short-circuits before
// any Supabase/Prisma call, so this is runnable as a unit test.
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/crm/dispatch/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: BODY,
  });
}

test("static-key header presented but CRM_DISPATCH_KEY unset at the real gate → 401", async () => {
  delete process.env.CRM_DISPATCH_KEY;
  const req = makeRequest({
    "x-dispatch-key": STATIC_KEY,
    "x-autolenis-timestamp": String(Date.now()),
    "x-idempotency-key": "k_unset_key",
  });
  const res = await authorizeDispatch(req, "dispatch/email");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.response.status, 401);
  const json = (await res.response.json()) as { status: string; error: string };
  assert.equal(json.status, "unauthorized");
  assert.equal(json.error, "dispatch_not_configured");
});

test("static-key header presented but CRM_DISPATCH_KEY empty ('') at the real gate → 401", async () => {
  process.env.CRM_DISPATCH_KEY = "";
  const req = makeRequest({
    "x-dispatch-key": STATIC_KEY,
    "x-autolenis-timestamp": String(Date.now()),
    "x-idempotency-key": "k_empty_key",
  });
  const res = await authorizeDispatch(req, "dispatch/email");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.response.status, 401);
  const json = (await res.response.json()) as { error: string };
  assert.equal(json.error, "dispatch_not_configured");
});

test("signature header presented but CRM_DISPATCH_SECRET unset at the real gate → 401", async () => {
  delete process.env.CRM_DISPATCH_SECRET;
  const sig = crypto.createHmac("sha256", "anything").update(BODY).digest("hex");
  const req = makeRequest({
    "x-autolenis-signature": sig,
    "x-autolenis-timestamp": String(Date.now()),
    "x-idempotency-key": "k_unset_secret",
  });
  const res = await authorizeDispatch(req, "dispatch/email");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.response.status, 401);
  const json = (await res.response.json()) as { error: string };
  assert.equal(json.error, "dispatch_not_configured");
});
