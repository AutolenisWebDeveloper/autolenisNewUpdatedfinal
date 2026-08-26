// Tests for GET /api/public/request/resume/[token] — the $99 pre-checkout resume
// deep-link. Proves: valid → 302 into the auth-gated checkout + single-use
// consume; invalid/expired/consumed → 302 to a "request a fresh link" page (no
// detail leaked, same destination); throttle → redirect. No PII in any URL.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/public/request/__tests__/resume-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

interface Ctrl {
  validation: { ok: boolean; tokenId?: string; buyerId?: string; vehicleRequestId?: string | null; reason?: string };
  consumed: string[];
  rlOk: boolean;
}
let ctrl: Ctrl;

mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitGeneral: async () => (ctrl.rlOk ? { ok: true } : { ok: false, status: 429, message: "slow down" }),
    clientIpKey: () => "1.2.3.4",
  },
});

mock.module("@/lib/services/buyer/request-resume-token.service", {
  namedExports: {
    validateResumeToken: async () => ctrl.validation,
    consumeResumeToken: async (id: string) => { ctrl.consumed.push(id); return true; },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() {
  return (await import("@/app/api/public/request/resume/[token]/route")).GET;
}

function call(GET: (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => Promise<Response>, token: string) {
  const req = new NextRequest(`https://autolenis.com/api/public/request/resume/${token}`);
  return GET(req, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  ctrl = { validation: { ok: false, reason: "not_found" }, consumed: [], rlOk: true };
  process.env.NEXT_PUBLIC_APP_URL = "https://autolenis.com";
});

test("valid token → 302 into /buyer/deposit and consumes single-use", async () => {
  ctrl.validation = { ok: true, tokenId: "tok_1", buyerId: "b1", vehicleRequestId: "vr1" };
  const GET = await load();
  const res = await call(GET, "rawtok");
  assert.equal(res.status, 302);
  const loc = res.headers.get("location") ?? "";
  assert.match(loc, /\/buyer\/deposit/);
  assert.doesNotMatch(loc, /@|email=/, "no PII in the redirect URL");
  assert.deepEqual(ctrl.consumed, ["tok_1"], "token consumed exactly once");
});

test("invalid token → 302 to request-a-car?resume=expired, no consume", async () => {
  ctrl.validation = { ok: false, reason: "not_found" };
  const GET = await load();
  const res = await call(GET, "bad");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location") ?? "", /\/request-a-car\?resume=expired/);
  assert.equal(ctrl.consumed.length, 0);
});

test("expired and consumed both route to the SAME failure page (no reason leaked)", async () => {
  const GET = await load();
  ctrl.validation = { ok: false, reason: "expired" };
  const r1 = await call(GET, "e");
  ctrl.validation = { ok: false, reason: "consumed" };
  const r2 = await call(GET, "c");
  assert.equal(r1.headers.get("location"), r2.headers.get("location"));
});

test("throttled → redirect (does not process the token)", async () => {
  ctrl.rlOk = false;
  ctrl.validation = { ok: true, tokenId: "tok_1", buyerId: "b1", vehicleRequestId: null };
  const GET = await load();
  const res = await call(GET, "rawtok");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location") ?? "", /resume=throttled/);
  assert.equal(ctrl.consumed.length, 0, "no consume when throttled");
});
