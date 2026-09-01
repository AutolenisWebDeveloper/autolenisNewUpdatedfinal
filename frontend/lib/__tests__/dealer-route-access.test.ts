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
import { DEALER_PUBLIC_ROUTES, isDealerPublicRoute } from "@/lib/auth/dealer-scope";

const proxySrc = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
const layoutSrc = readFileSync(path.join(process.cwd(), "app/dealer/layout.tsx"), "utf8");

function dealerAuthRoutes(): string[] {
  return [...DEALER_PUBLIC_ROUTES];
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

test("the edge gate and the layout gate share ONE route list", () => {
  assert.ok(proxySrc.includes("DEALER_PUBLIC_ROUTES"), "proxy must use the shared list");
  assert.ok(layoutSrc.includes("isDealerPublicRoute"), "layout must use the shared predicate");
});

test("the dealer layout does not bounce a claimer back to sign-in", () => {
  // The layout runs for every /dealer/* page including /dealer/claim; if this
  // predicate said false there, requireDealer() would redirect the unauthenticated
  // claimer to sign-in and D1 would still be broken one layer down.
  assert.equal(isDealerPublicRoute("/dealer/claim"), true);
  assert.equal(isDealerPublicRoute("/dealer/invite/claim"), true);
  assert.equal(isDealerPublicRoute("/dealer/inventory"), false);
  assert.equal(isDealerPublicRoute("/dealer/onboarding"), false);
});

test("the public application entry is not gated by the dealer layout", () => {
  assert.equal(isDealerPublicRoute("/dealer/apply"), true);
});
