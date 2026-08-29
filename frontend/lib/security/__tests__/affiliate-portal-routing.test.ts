// R1 — proxy step 10: bare /affiliate/portal must land on the dashboard, not
// rewrite to the unrouted /affiliate/portal/portal (a 404 reachable through
// the post-sign-in redirect); other bare /affiliate/* paths still canonicalize
// into /affiliate/portal/*.
//
// Drives the REAL proxy() with a crafted Supabase session cookie; the auth
// server round-trip is a fetch stub returning the affiliate user.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/security/__tests__/affiliate-portal-routing.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";

mock.module("@/lib/auth/terms", {
  namedExports: {
    needsTermsAcceptance: () => false,
    getCurrentTermsVersion: () => "2026-01",
  },
});

const AFFILIATE_USER = {
  id: "sb_aff_1",
  aud: "authenticated",
  email: "aff@x.com",
  user_metadata: { role: "AFFILIATE" },
  app_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const realFetch = global.fetch;
global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("supabase.test")) {
    return new Response(JSON.stringify(AFFILIATE_USER), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// @supabase/ssr storage key: sb-<first host label>-auth-token; value is the
// base64url-encoded session JSON with the library's "base64-" prefix.
function sessionCookie(): { name: string; value: string } {
  const session = {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: AFFILIATE_USER,
  };
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { name: "sb-supabase-auth-token", value: `base64-${encoded}` };
}

async function routeAs(path: string): Promise<{ status: number; location: string | null }> {
  const { proxy } = await import("@/proxy");
  const cookie = sessionCookie();
  const request = new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  });
  const response = await proxy(request);
  return { status: response.status, location: response.headers.get("location") };
}

test("bare /affiliate/portal → /affiliate/portal/dashboard (not /portal/portal)", async () => {
  const { status, location } = await routeAs("/affiliate/portal");
  assert.ok(status === 307 || status === 308, `expected redirect, got ${status}`);
  assert.equal(new URL(location!).pathname, "/affiliate/portal/dashboard");
});

test("bare /affiliate/portal/ (trailing slash) → dashboard", async () => {
  const { status, location } = await routeAs("/affiliate/portal/");
  assert.ok(status === 307 || status === 308);
  assert.equal(new URL(location!).pathname, "/affiliate/portal/dashboard");
});

test("legacy /affiliate/earnings still canonicalizes into the portal", async () => {
  const { status, location } = await routeAs("/affiliate/earnings");
  assert.ok(status === 307 || status === 308);
  assert.equal(new URL(location!).pathname, "/affiliate/portal/earnings");
});

test("/affiliate/portal/dashboard passes through (no redirect loop)", async () => {
  const { status } = await routeAs("/affiliate/portal/dashboard");
  assert.equal(status, 200);
});
