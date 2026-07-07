// Regression tests for the unified buyer journey machine (M-3).
// Run with: npx tsx --test lib/services/buyer/__tests__/journey.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { computeJourney, type JourneyFacts, type JourneyDealFacts } from "../journey";

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

function deal(over: Partial<JourneyDealFacts> = {}): JourneyDealFacts {
  return {
    status: "PENDING",
    hasFinancingPath: false,
    feePaid: false,
    insuranceStatus: "NOT_STARTED",
    contractShieldPassed: false,
    ...over,
  };
}

test("brand-new buyer sits at onboarding", () => {
  const r = computeJourney(facts());
  assert.equal(r.currentStage, "onboarding");
  assert.deepEqual(r.completedStages, ["account"]);
});

test("pre-deal progression is gated in order", () => {
  assert.equal(computeJourney(facts({ onboardingComplete: true })).currentStage, "prequal");
  assert.equal(computeJourney(facts({ onboardingComplete: true, prequalValid: true })).currentStage, "search");
  assert.equal(
    computeJourney(facts({ onboardingComplete: true, prequalValid: true, shortlistCount: 2 })).currentStage,
    "deposit",
  );
  // A valid prequal without onboarding cannot skip ahead.
  assert.equal(computeJourney(facts({ prequalValid: true, shortlistCount: 2 })).currentStage, "onboarding");
});

test("deposit paid advances to auction", () => {
  const r = computeJourney(facts({ onboardingComplete: true, prequalValid: true, shortlistCount: 1, depositPaid: true }));
  assert.equal(r.currentStage, "auction");
  assert.ok(r.completedStages.includes("deposit"));
});

test("a deal implies deposit+auction+select complete regardless of the pre-deal flags", () => {
  const r = computeJourney(facts({ deal: deal({ status: "FINANCING_PENDING" }) }));
  for (const st of ["deposit", "auction", "select-deal"]) assert.ok(r.completedStages.includes(st as never), st);
  assert.equal(r.currentStage, "financing");
});

test("deal fact progression: financing → fee → insurance → contract → sign → pickup → complete", () => {
  assert.equal(computeJourney(facts({ deal: deal({ status: "FEE_PENDING" }) })).currentStage, "fee");
  assert.equal(computeJourney(facts({ deal: deal({ hasFinancingPath: true }) })).currentStage, "fee");
  assert.equal(computeJourney(facts({ deal: deal({ status: "INSURANCE_PENDING" }) })).currentStage, "insurance");
  assert.equal(computeJourney(facts({ deal: deal({ feePaid: true }) })).currentStage, "insurance");
  assert.equal(computeJourney(facts({ deal: deal({ insuranceStatus: "QUOTE_REQUESTED" }) })).currentStage, "contract");
  assert.equal(computeJourney(facts({ deal: deal({ status: "CONTRACT_REVIEW" }) })).currentStage, "contract");
  assert.equal(computeJourney(facts({ deal: deal({ contractShieldPassed: true }) })).currentStage, "sign");
  assert.equal(computeJourney(facts({ deal: deal({ status: "SIGNING_PENDING" }) })).currentStage, "sign");
  assert.equal(computeJourney(facts({ deal: deal({ status: "PICKUP_SCHEDULED" }) })).currentStage, "pickup");
  const complete = computeJourney(facts({ deal: deal({ status: "COMPLETED" }) }));
  assert.equal(complete.currentStage, "complete");
  assert.ok(complete.completedStages.includes("pickup"));
});

test("completedStages is always in canonical journey order", () => {
  const r = computeJourney(facts({ deal: deal({ status: "PICKUP_SCHEDULED" }) }));
  const order = r.completedStages.map((s) => ["account","onboarding","prequal","search","shortlist","deposit","auction","select-deal","financing","fee","insurance","contract","sign","pickup","complete"].indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("admin SKIP completes a stage; UNLOCK only marks it accessible", () => {
  const skip = computeJourney(facts({ overrides: [{ stageId: "prequal", type: "SKIP" }] }));
  assert.ok(skip.completedStages.includes("prequal"));
  const unlock = computeJourney(facts({ overrides: [{ stageId: "deposit", type: "UNLOCK" }] }));
  assert.deepEqual(unlock.unlockedStages, ["deposit"]);
  assert.ok(!unlock.completedStages.includes("deposit"));
});

test("nextAction tracks the current stage", () => {
  assert.equal(computeJourney(facts()).nextAction, "Complete your profile");
  assert.equal(computeJourney(facts({ deal: deal({ status: "COMPLETED" }) })).nextAction, "Your deal is complete");
});
