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

// NOTE ON A CORRECTED ASSUMPTION.
// This test previously asserted that /buyer/notifications and /buyer/billing are
// reachable for a brand-new buyer. They are not: app/buyer/layout.tsx redirects
// every /buyer/* route except dashboard, onboarding, profile, settings and
// suspended to /buyer/onboarding until onboarding is complete. The assertion
// described the intent of NAV_STAGE_REQUIREMENT rather than what the app does,
// and the gap is exactly the defect being fixed — the sidebar rendered 20 links
// that silently bounced. The running code is the source of truth, so the
// pre-onboarding case is corrected here and the post-onboarding case (which is
// what "ungated" was reaching for) is asserted separately below.

test("before onboarding, only the routes the layout permits are reachable", () => {
  const j = computeJourney(facts());
  for (const href of ["/buyer/dashboard", "/buyer/profile", "/buyer/settings"]) {
    assert.equal(isNavItemReachable(href, j), true, `${href} should be reachable`);
  }
  for (const href of ["/buyer/notifications", "/buyer/billing", "/buyer/search", "/buyer/requests", "/buyer/messages"]) {
    assert.equal(
      isNavItemReachable(href, j),
      false,
      `${href} is redirected to /buyer/onboarding by the layout — the nav must not offer it as a live link`,
    );
  }
});

test("after onboarding, ungated (account/utility) items are reachable", () => {
  const j = computeJourney(facts({ onboardingComplete: true }));
  for (const href of ["/buyer/dashboard", "/buyer/profile", "/buyer/settings", "/buyer/notifications", "/buyer/billing"]) {
    assert.equal(isNavItemReachable(href, j), true, href);
  }
});

test("an admin SKIP of onboarding lifts the onboarding gate", () => {
  // SKIP counts a stage as complete, so it is the override that legitimately
  // opens the portal for a buyer who has not run the wizard.
  const j = computeJourney(facts({ overrides: [{ stageId: "onboarding", type: "SKIP" }] }));
  assert.equal(isNavItemReachable("/buyer/notifications", j), true);
});

test("a brand-new buyer cannot reach deal-flow items", () => {
  const j = computeJourney(facts());
  for (const href of ["/buyer/deal", "/buyer/deal/financing", "/buyer/fee", "/buyer/contract-shield", "/buyer/esign", "/buyer/pickup"]) {
    assert.equal(isNavItemReachable(href, j), false, href);
  }
});

test("reaching a stage unlocks its item and everything behind it", () => {
  // Buyer at the fee stage (deal fee pending)
  const j = computeJourney(facts({ onboardingComplete: true, prequalValid: true, shortlistCount: 1, deal: { status: "FEE_PENDING", hasFinancingPath: false, feePaid: false, insuranceStatus: "NOT_STARTED", contractShieldPassed: false } }));
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
  const j = computeJourney(facts({ onboardingComplete: true, overrides: [{ stageId: "sign", type: "UNLOCK" }] }));
  assert.equal(isNavItemReachable("/buyer/esign", j), true);
  // A different locked item stays locked
  assert.equal(isNavItemReachable("/buyer/pickup", j), false);
});

test("an UNLOCK override does NOT bypass the onboarding gate", () => {
  // The layout's onboarding redirect does not consult journey overrides, so a
  // stage UNLOCK cannot make a route reachable while onboarding is incomplete.
  // Showing it as live would be a link that bounces. SKIP is the tool for that
  // (see above), and it works because it marks onboarding complete.
  const j = computeJourney(facts({ overrides: [{ stageId: "sign", type: "UNLOCK" }] }));
  assert.equal(isNavItemReachable("/buyer/esign", j), false);
});

test("a completed deal reaches every deal-flow item", () => {
  const j = computeJourney(facts({ onboardingComplete: true, prequalValid: true, shortlistCount: 1, deal: { status: "COMPLETED", hasFinancingPath: true, feePaid: true, insuranceStatus: "VERIFIED", contractShieldPassed: true } }));
  for (const href of ["/buyer/auctions", "/buyer/deal", "/buyer/fee", "/buyer/insurance", "/buyer/contract-shield", "/buyer/esign", "/buyer/pickup"]) {
    assert.equal(isNavItemReachable(href, j), true, href);
  }
});
