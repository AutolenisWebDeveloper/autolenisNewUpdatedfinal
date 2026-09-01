// D2 — scope is what confines a PENDING dealer, instead of blocking them outright.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dealerScope, isOnboardingPath, isOnboardingApiPath, shouldRedirectToOnboarding,
} from "@/lib/auth/dealer-scope";

test("PENDING gets onboarding scope — not blocked", () => {
  assert.equal(dealerScope({ status: "PENDING" }), "ONBOARDING");
});
test("ACTIVE gets full scope", () => assert.equal(dealerScope({ status: "ACTIVE" }), "FULL"));
test("suspended and terminated get nothing", () => {
  assert.equal(dealerScope({ status: "SUSPENDED" }), "NONE");
  assert.equal(dealerScope({ status: "TERMINATED" }), "NONE");
});
test("absent dealer gets nothing", () => assert.equal(dealerScope(null), "NONE"));

test("onboarding path matches its own subtree only", () => {
  assert.equal(isOnboardingPath("/dealer/onboarding"), true);
  assert.equal(isOnboardingPath("/dealer/onboarding/agreement"), true);
  assert.equal(isOnboardingPath("/dealer/inventory"), false);
  assert.equal(isOnboardingPath("/dealer/onboarding-other"), false);
});
test("onboarding API path matches its own subtree only", () => {
  assert.equal(isOnboardingApiPath("/api/dealer/onboarding"), true);
  assert.equal(isOnboardingApiPath("/api/dealer/inventory"), false);
});

test("an onboarding dealer is redirected away from portal paths", () => {
  assert.equal(shouldRedirectToOnboarding("ONBOARDING", "/dealer/inventory"), true);
});
test("NO REDIRECT LOOP: onboarding scope on the onboarding page renders", () => {
  assert.equal(shouldRedirectToOnboarding("ONBOARDING", "/dealer/onboarding"), false);
});
test("full scope is never redirected", () => {
  assert.equal(shouldRedirectToOnboarding("FULL", "/dealer/inventory"), false);
});
test("unknown pathname fails OPEN to onboarding rather than looping", () => {
  assert.equal(shouldRedirectToOnboarding("ONBOARDING", null), false);
  assert.equal(shouldRedirectToOnboarding("ONBOARDING", undefined), false);
});
