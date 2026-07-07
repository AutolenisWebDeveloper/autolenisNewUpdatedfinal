// H-6 regression tests: affiliate banking readiness is driven by ONE canonical
// model (AffiliatePayoutMethod, the Finance Hub record) so banking set up in
// either surface satisfies both. Pure-function tests over
// computeOnboardingCompletion — the single choke point every readiness reader
// (profile checklist, onboarding submit gate) flows through.
//
// Run with: npx tsx --test lib/services/affiliate/__tests__/onboarding-banking.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { computeOnboardingCompletion, type getOnboardingProfile } from "../onboarding.service";

type ProfileData = Awaited<ReturnType<typeof getOnboardingProfile>>;

const now = new Date();

function base(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    review: null,
    profile: null,
    taxProfile: null,
    paymentProfile: null,
    payoutMethod: null,
    documents: [],
    ...overrides,
  } as ProfileData;
}

function canonicalRecord(method: string, extras: Record<string, unknown> = {}) {
  return {
    id: "pm_1",
    affiliateId: "aff_1",
    method,
    bankName: null,
    accountType: null,
    routingNumberLast4: null,
    accountNumberLast4: null,
    zelleEmail: null,
    paypalEmail: null,
    taxIdLast4: null,
    businessName: null,
    taxClassification: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...extras,
  } as NonNullable<ProfileData["payoutMethod"]>;
}

test("banking set via the FINANCE HUB satisfies onboarding readiness (the H-6 break)", () => {
  const completion = computeOnboardingCompletion(
    base({ payoutMethod: canonicalRecord("ACH", { accountNumberLast4: "4321" }) }),
  );
  assert.equal(completion.steps.paymentProfile, true);
});

test("PAYPAL/ZELLE/CHECK payees count as banked (no account number required)", () => {
  for (const method of ["PAYPAL", "ZELLE", "CHECK"]) {
    const completion = computeOnboardingCompletion(base({ payoutMethod: canonicalRecord(method) }));
    assert.equal(completion.steps.paymentProfile, true, `${method} must satisfy readiness`);
  }
});

test("pre-unification legacy rows still count (backward compatibility)", () => {
  const completion = computeOnboardingCompletion(
    base({
      paymentProfile: {
        id: "pp_1", affiliateId: "aff_1", payoutMethod: "ACH", holderName: "T",
        routingLast4: "1111", accountLast4: "2222", accountType: "CHECKING",
        paypalEmail: null, zellePhone: null, verified: false, createdAt: now, updatedAt: now,
      } as NonNullable<ProfileData["paymentProfile"]>,
    }),
  );
  assert.equal(completion.steps.paymentProfile, true);
});

test("no banking anywhere → readiness incomplete", () => {
  const completion = computeOnboardingCompletion(base());
  assert.equal(completion.steps.paymentProfile, false);
});
