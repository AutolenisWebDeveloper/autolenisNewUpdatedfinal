// Tests for journey-aware buyer nav gating (M-4). Pure logic over the M-3
// journey machine output.
// Run with: npx tsx --test lib/services/buyer/__tests__/nav-gating.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { computeJourney, type JourneyFacts } from "../journey";
import { isNavItemReachable } from "../nav-gating";

function facts(over: Partial<JourneyFacts> = {}): JourneyFacts {
  return {
    onboardingComplete: false,
    prequalValid: false,
    shortlistCount: 0,
    depositPaid: false,
    activeAuction: false,
    deal: null,
    ...over,
  };
}

test("ungated (account/utility) items are always reachable", () => {
  const j = computeJourney(facts());
  for (const href of ["/buyer/dashboard", "/buyer/profile", "/buyer/settings", "/buyer/notifications", "/buyer/billing"]) {
    assert.equal(isNavItemReachable(href, j), true, href);
  }
});

test("a brand-new buyer cannot reach deal-flow items", () => {
  const j = computeJourney(facts());
  for (const href of ["/buyer/deal", "/buyer/deal/financing", "/buyer/fee", "/buyer/contract-shield", "/buyer/esign", "/buyer/pickup"]) {
    assert.equal(isNavItemReachable(href, j), false, href);
  }
});

test("reaching a stage unlocks its item and everything behind it", () => {
  // Buyer at the fee stage (deal fee pending)
  const j = computeJourney(facts({ deal: { status: "FEE_PENDING", hasFinancingPath: false, feePaid: false, insuranceStatus: "NOT_STARTED", contractShieldPassed: false } }));
  assert.equal(j.currentStage, "fee");
  // fee itself and earlier deal items reachable
  assert.equal(isNavItemReachable("/buyer/fee", j), true);
  assert.equal(isNavItemReachable("/buyer/deal", j), true);
  assert.equal(isNavItemReachable("/buyer/deal/financing", j), true);
  assert.equal(isNavItemReachable("/buyer/auctions", j), true);
  // later items still locked
  assert.equal(isNavItemReachable("/buyer/insurance", j), false);
  assert.equal(isNavItemReachable("/buyer/esign", j), false);
  assert.equal(isNavItemReachable("/buyer/pickup", j), false);
});

test("admin UNLOCK override makes a future item reachable without completing it", () => {
  const j = computeJourney(facts({ overrides: [{ stageId: "sign", type: "UNLOCK" }] }));
  assert.equal(isNavItemReachable("/buyer/esign", j), true);
  // A different locked item stays locked
  assert.equal(isNavItemReachable("/buyer/pickup", j), false);
});

test("a completed deal reaches every deal-flow item", () => {
  const j = computeJourney(facts({ deal: { status: "COMPLETED", hasFinancingPath: true, feePaid: true, insuranceStatus: "VERIFIED", contractShieldPassed: true } }));
  for (const href of ["/buyer/auctions", "/buyer/deal", "/buyer/fee", "/buyer/insurance", "/buyer/contract-shield", "/buyer/esign", "/buyer/pickup"]) {
    assert.equal(isNavItemReachable(href, j), true, href);
  }
});
