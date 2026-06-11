// End-to-end proof that replay protection (timestamp skew) applies to the
// STATIC-KEY path, not just the HMAC path. Exercises the real authorizeDispatch.
//
// The skew gate sits AFTER the auth decision and BEFORE any Supabase/Prisma
// call, so an expired timestamp returns `timestamp_skew` without touching the
// DB — making this runnable as a unit test.
//
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/dispatch-auth-skew.proof.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { authorizeDispatch } from "../dispatch-auth";

const STATIC_KEY = "PA8m1n0Vn0Yk0v2bq1Zr3Xw9Lc4Td7Up6Hs5Jf8Kg=";
// Read lazily inside authorizeDispatch, so setting them here (before any test
// runs) is sufficient.
process.env.CRM_DISPATCH_KEY = STATIC_KEY;
process.env.CRM_DISPATCH_SECRET = process.env.CRM_DISPATCH_SECRET ?? "hmac-secret-for-code-callers";

function makeRequest(headers: Record<string, string>, body: object): NextRequest {
  return new NextRequest("http://localhost/api/crm/dispatch/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("static-key path + EXPIRED timestamp → 401 timestamp_skew (replay protection applies to both paths)", async () => {
  const expired = String(Date.now() - 10 * 60 * 1000); // 10 min ago, > 5 min skew
  const req = makeRequest(
    { "x-dispatch-key": STATIC_KEY, "x-autolenis-timestamp": expired, "x-idempotency-key": "k_skew" },
    { contactId: "c_1" },
  );
  const res = await authorizeDispatch(req, "dispatch/email");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.response.status, 401);
  const json = (await res.response.json()) as { status: string; error: string };
  assert.equal(json.status, "unauthorized");
  assert.equal(json.error, "timestamp_skew");
});

test("no credential header at the real gate → 401 missing_auth (before any skew/idempotency)", async () => {
  const req = makeRequest(
    { "x-autolenis-timestamp": String(Date.now()), "x-idempotency-key": "k_none" },
    { contactId: "c_1" },
  );
  const res = await authorizeDispatch(req, "dispatch/email");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.response.status, 401);
  const json = (await res.response.json()) as { error: string };
  assert.equal(json.error, "missing_auth");
});

test("wrong static key at the real gate → 401 bad_key", async () => {
  const req = makeRequest(
    { "x-dispatch-key": "wrong-key", "x-autolenis-timestamp": String(Date.now()), "x-idempotency-key": "k_bad" },
    { contactId: "c_1" },
  );
  const res = await authorizeDispatch(req, "dispatch/email");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.response.status, 401);
  const json = (await res.response.json()) as { error: string };
  assert.equal(json.error, "bad_key");
});
