// Phase 4 F5 regression: cron auth must NOT accept the spoofable x-vercel-cron
// header without a secret, and must FAIL CLOSED (not accept "Bearer undefined")
// when CRON_SECRET is unset.
//
// Run via: pnpm test:security (globs lib/security/__tests__/*.test.ts)

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCronAuth, authorizeCronRequest } from "@/lib/security/cron-auth";

const SECRET = "s3cr3t-cron-value";

test("evaluateCronAuth: correct Bearer secret is authorized", () => {
  assert.deepEqual(evaluateCronAuth(`Bearer ${SECRET}`, SECRET), { ok: true });
});

test("evaluateCronAuth: wrong secret is rejected 401", () => {
  const r = evaluateCronAuth("Bearer nope", SECRET);
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 401);
});

test("evaluateCronAuth: missing Authorization is rejected 401", () => {
  const r = evaluateCronAuth(null, SECRET);
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 401);
});

test("evaluateCronAuth: FAIL CLOSED (500) when CRON_SECRET unset", () => {
  const r = evaluateCronAuth("Bearer whatever", undefined);
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 500);
});

test("evaluateCronAuth: 'Bearer undefined' is NOT accepted when secret unset", () => {
  const r = evaluateCronAuth("Bearer undefined", undefined);
  assert.equal(r.ok, false); // must never authorize
  assert.equal((r as { status: number }).status, 500);
});

test("evaluateCronAuth: empty-string secret fails closed (500)", () => {
  const r = evaluateCronAuth("Bearer ", "");
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 500);
});

// The spoofable header path is gone: a request presenting x-vercel-cron:1 but no
// valid Bearer secret must be rejected.
test("authorizeCronRequest: x-vercel-cron:1 alone is rejected (spoof-proof)", () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  try {
    const req = { headers: { get: (n: string) => (n.toLowerCase() === "x-vercel-cron" ? "1" : null) } };
    const res = authorizeCronRequest(req);
    assert.ok(res, "must return a rejection response");
    assert.equal(res!.status, 401);
  } finally {
    process.env.CRON_SECRET = prev;
  }
});

test("authorizeCronRequest: valid Bearer secret authorizes (returns null)", () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  try {
    const req = {
      headers: { get: (n: string) => (n.toLowerCase() === "authorization" ? `Bearer ${SECRET}` : null) },
    };
    assert.equal(authorizeCronRequest(req), null);
  } finally {
    process.env.CRON_SECRET = prev;
  }
});

test("authorizeCronRequest: unset secret → 500 even with a Bearer header", () => {
  const prev = process.env.CRON_SECRET;
  delete (process.env as Record<string, string | undefined>).CRON_SECRET;
  try {
    const req = {
      headers: { get: (n: string) => (n.toLowerCase() === "authorization" ? "Bearer undefined" : null) },
    };
    const res = authorizeCronRequest(req);
    assert.ok(res);
    assert.equal(res!.status, 500);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  }
});
