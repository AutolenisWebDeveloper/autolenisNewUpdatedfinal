// D1 — the emailed claim link must be reachable by someone with no dealer session.
//
// These assert the ROUTE TABLE rather than importing proxy.ts (which pulls in
// next/server and the Supabase edge client). The table is the thing that was
// wrong: /dealer/claim appeared in neither PUBLIC_ROUTES nor DEALER_AUTH_ROUTES,
// so the dealer-path branch redirected the page to sign-in and 401'd the API
// before either handler could check its own token.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const proxySrc = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");

function dealerAuthRoutes(): string[] {
  const m = proxySrc.match(/const DEALER_AUTH_ROUTES = \[([\s\S]*?)\];/);
  assert.ok(m, "DEALER_AUTH_ROUTES not found in proxy.ts");
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test("the claim page is reachable without a dealer session", () => {
  assert.ok(dealerAuthRoutes().includes("/dealer/claim"));
});

test("the claim API is reachable without a dealer session", () => {
  assert.ok(dealerAuthRoutes().includes("/api/dealer/claim"));
});

test("the invite claim path stays reachable", () => {
  assert.ok(dealerAuthRoutes().includes("/dealer/invite/claim"));
});

test("fast-track is no longer a token-exempt path (the page is deleted)", () => {
  assert.equal(proxySrc.includes("/dealer/onboarding/fast-track"), false);
});

test("an onboarding-scoped session is confined at the edge", () => {
  assert.ok(proxySrc.includes("ONBOARDING_REQUIRED"), "API confinement missing");
  assert.ok(proxySrc.includes("isOnboardingPath"), "page confinement missing");
});
