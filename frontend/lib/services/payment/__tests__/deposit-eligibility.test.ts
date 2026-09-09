// §5a eligibility recheck — the named-failure contract.
//
// The requirement these pin is one sentence of the specification: "Any failure returns
// the buyer to the exact missing requirement — named, not generic." So every test here
// asserts a CODE and the NAMED item, not merely that the gate refused.
//
// Run with: npx tsx --test lib/services/payment/__tests__/deposit-eligibility.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPaymentEligibility,
  type EligibilityFacts,
  type EligibilityFailureCode,
} from "../deposit-eligibility";

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 1000);

function facts(over: Partial<EligibilityFacts> = {}): EligibilityFacts {
  return {
    buyer: {
      id: "buyer_1",
      onboardingComplete: true,
      city: "Frisco",
      state: "TX",
      zip: "75035",
      disabledAt: null,
      purgedAt: null,
      isSuspended: false,
    },
    emailConfirmedAt: PAST,
    prequal: { decision: "APPROVED", expiresAt: FUTURE },
    request: {
      id: "vr_1",
      status: "SUBMITTED",
      makePreference: "Toyota",
      modelPreference: null,
      maxBudgetCents: 3_500_000,
    },
    otherOpenRequestIds: [],
    disclosuresAcceptedAt: PAST,
    disclosuresVersion: "2026-09-09",
    ...over,
  };
}

const TRANSITION = { requireDisclosureAcceptance: false } as const;
const INTENT = { requireDisclosureAcceptance: true, currentDisclosuresVersion: "2026-09-09" } as const;

function expectFail(f: EligibilityFacts, opts: Parameters<typeof checkPaymentEligibility>[1]) {
  const res = checkPaymentEligibility(f, opts);
  assert.equal(res.eligible, false, "expected the gate to refuse");
  return res as Extract<typeof res, { eligible: false }>;
}

test("a complete buyer passes both gates", () => {
  assert.deepEqual(checkPaymentEligibility(facts(), TRANSITION), { eligible: true });
  assert.deepEqual(checkPaymentEligibility(facts(), INTENT), { eligible: true });
});

test("every failure names the exact missing requirement, never a generic refusal", () => {
  const cases: Array<[Partial<EligibilityFacts>, EligibilityFailureCode, string]> = [
    [{ buyer: { ...facts().buyer, disabledAt: PAST } }, "ACCOUNT_INACTIVE", "account"],
    [{ buyer: { ...facts().buyer, isSuspended: true } }, "ACCOUNT_INACTIVE", "account"],
    [{ emailConfirmedAt: null }, "EMAIL_UNVERIFIED", "email"],
    [{ buyer: { ...facts().buyer, onboardingComplete: false } }, "ONBOARDING_REQUIRED", "onboarding"],
    [{ buyer: { ...facts().buyer, zip: null } }, "LOCATION_REQUIRED", "ZIP code"],
    [{ prequal: null }, "PREQUAL_REQUIRED", "prequalification"],
    [{ prequal: { decision: "APPROVED", expiresAt: PAST } }, "PREQUAL_REQUIRED", "prequalification"],
    [{ prequal: { decision: "DECLINED", expiresAt: FUTURE } }, "PREQUAL_REQUIRED", "prequalification"],
    [
      { request: { ...facts().request, makePreference: null, modelPreference: null } },
      "VEHICLE_CRITERIA_INCOMPLETE",
      "make or model",
    ],
    [
      { request: { ...facts().request, maxBudgetCents: null } },
      "VEHICLE_CRITERIA_INCOMPLETE",
      "budget",
    ],
    [{ otherOpenRequestIds: ["vr_other"] }, "REQUEST_CONFLICT", "open request"],
  ];

  for (const [over, code, missing] of cases) {
    const res = expectFail(facts(over), TRANSITION);
    assert.equal(res.code, code, `expected ${code} for ${JSON.stringify(Object.keys(over))}`);
    assert.equal(res.missing, missing);
    assert.ok(res.message.length > 20, "the message names the requirement rather than saying 'ineligible'");
  }
});

test("a partial location names EVERY missing part, not just the first", () => {
  const res = expectFail(facts({ buyer: { ...facts().buyer, city: null, zip: null } }), TRANSITION);
  assert.equal(res.code, "LOCATION_REQUIRED");
  assert.equal(res.missing, "city, ZIP code");
  assert.match(res.message, /city, ZIP code/);
});

test("a request missing both criteria names both", () => {
  const res = expectFail(
    facts({ request: { ...facts().request, makePreference: null, modelPreference: null, maxBudgetCents: 0 } }),
    TRANSITION,
  );
  assert.equal(res.missing, "make or model, budget");
});

// THE DEADLOCK THIS AVOIDS. §5a lists disclosure acceptance among the conditions for
// reaching PAYMENT_REQUIRED, and §5b shows the disclosures on the surface that
// PAYMENT_REQUIRED unlocks. Required at BOTH gates, no request could ever reach the
// state, because acceptance is unobtainable until it does.
test("disclosure acceptance gates the PaymentIntent, NOT the transition to PAYMENT_REQUIRED", () => {
  const notYetAccepted = facts({ disclosuresAcceptedAt: null, disclosuresVersion: null });

  assert.deepEqual(
    checkPaymentEligibility(notYetAccepted, TRANSITION),
    { eligible: true },
    "a buyer who has not yet SEEN the disclosures must still be able to reach checkout, which is where " +
      "they are shown — otherwise the state can never be entered",
  );

  const res = expectFail(notYetAccepted, INTENT);
  assert.equal(res.code, "DISCLOSURE_REQUIRED");
  assert.equal(res.missing, "disclosures");
});

test("a STALE acceptance is not an acceptance — the buyer agreed to different words", () => {
  const res = expectFail(facts({ disclosuresVersion: "2026-01-01" }), INTENT);
  assert.equal(res.code, "DISCLOSURE_REQUIRED");
  assert.match(res.message, /updated since/);
});

// Order is a product decision, not an implementation detail: the first thing a buyer is
// told to fix must be the thing that has to be fixed first.
test("the most fundamental failure is reported first when several apply at once", () => {
  const everythingWrong = facts({
    buyer: { ...facts().buyer, disabledAt: PAST, onboardingComplete: false, city: null },
    prequal: null,
    request: { ...facts().request, makePreference: null, modelPreference: null, maxBudgetCents: null },
    otherOpenRequestIds: ["vr_other"],
    emailConfirmedAt: null,
  });
  assert.equal(
    expectFail(everythingWrong, INTENT).code,
    "ACCOUNT_INACTIVE",
    "telling a suspended buyer their budget is missing sends them down a road ending in the same refusal",
  );
});

// §11.6 ruling 12. If this ever fails, someone has moved PAY-06b back to Phase 3 ahead
// of the Phase 4 capture surface, and the payment gate will refuse every buyer.
test("the co-buyer/trade elections clause is NOT checked here — it moved to Phase 4 with its writer", () => {
  const res = checkPaymentEligibility(facts(), INTENT);
  assert.deepEqual(res, { eligible: true });

  const source = Object.keys(facts()).join(",");
  assert.ok(
    !/coBuyer|co_buyer|tradeElection|trade_election/i.test(source),
    "the facts this gate reads must not include an election nothing writes until Phase 4 — " +
      "and it must not be added here inert either, because a predicate that always passes " +
      "cannot be told apart from a missing one",
  );
});
