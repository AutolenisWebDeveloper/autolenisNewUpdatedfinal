// Task 8a — the consent-basis gate on the EXISTING SMS path.
//
// Owner direction: do NOT build a second SMS send path for dealers. A parallel
// path that skipped sendCrmSms's consent check would be a consent bypass
// implemented in architecture — the check would still exist, and simply not be
// on the road the dealer traffic takes. So the existing gate is WIDENED into an
// explicit basis instead.
//
//   EXPRESS_WRITTEN | EXPRESS | EXISTING_BUSINESS_RELATIONSHIP | NONE
//
// NONE always refuses. Dealer prospects have no consent record of any kind, so
// they resolve to NONE and SMS correctly reaches zero of them today. That is the
// intended outcome, not a gap to route around.
//
// Two further gates are INDEPENDENT of consent, because they answer different
// questions:
//   dnc_status  — may this number be dialled at all (only "not_found" clears)
//   phone_type  — mobile carries materially higher risk than a corporate line
// A valid consent basis does not override either.

import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateConsentBasis,
  CONSENT_BASES,
  DEFAULT_ALLOWED_PHONE_TYPES,
  type ConsentBasis,
} from "../consent-basis";

const CLEAR = { dncStatus: "not_found", phoneType: "corporate_phone" } as const;

test("NONE always refuses", () => {
  const r = evaluateConsentBasis({ basis: "NONE", ...CLEAR });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "NO_CONSENT_BASIS");
});

test("NONE refuses even when every other signal is maximally permissive", () => {
  // No combination of other signals may manufacture consent.
  const r = evaluateConsentBasis(
    { basis: "NONE", dncStatus: "not_found", phoneType: "corporate_phone" },
    { allowedPhoneTypes: ["corporate_phone", "direct_phone", "mobile_phone"] },
  );
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "NO_CONSENT_BASIS");
});

test("each affirmative basis is permitted when nothing else blocks", () => {
  for (const basis of ["EXPRESS_WRITTEN", "EXPRESS", "EXISTING_BUSINESS_RELATIONSHIP"] as ConsentBasis[]) {
    const r = evaluateConsentBasis({ basis, ...CLEAR });
    assert.equal(r.allowed, true, `${basis} should be permitted`);
  }
});

test("an unrecognised basis fails CLOSED as no consent", () => {
  const r = evaluateConsentBasis({ basis: "SOMETHING_ELSE" as ConsentBasis, ...CLEAR });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "NO_CONSENT_BASIS");
});

test("a null or undefined basis fails CLOSED", () => {
  for (const basis of [null, undefined] as unknown as ConsentBasis[]) {
    assert.equal(evaluateConsentBasis({ basis, ...CLEAR }).allowed, false);
  }
});

test("CONSENT_BASES lists exactly the four values, NONE included", () => {
  assert.deepEqual([...CONSENT_BASES].sort(), [
    "EXISTING_BUSINESS_RELATIONSHIP", "EXPRESS", "EXPRESS_WRITTEN", "NONE",
  ]);
});

// ─── DNC gates independently of consent ─────────────────────────────────────

test("dnc 'found' blocks despite the strongest consent basis", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS_WRITTEN", dncStatus: "found", phoneType: "corporate_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "DNC_BLOCKED");
});

test("dnc 'pending' is NOT a clearance", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS_WRITTEN", dncStatus: "pending", phoneType: "corporate_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "DNC_BLOCKED");
});

test("a null dnc_status means never checked, and blocks", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS", dncStatus: null, phoneType: "corporate_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "DNC_BLOCKED");
});

test("only 'not_found' clears the phone channel", () => {
  for (const status of ["found", "pending", "unknown", "", null]) {
    const r = evaluateConsentBasis({ basis: "EXPRESS", dncStatus: status, phoneType: "corporate_phone" });
    assert.equal(r.allowed, false, `dnc_status ${JSON.stringify(status)} must not clear`);
  }
  assert.equal(evaluateConsentBasis({ basis: "EXPRESS", dncStatus: "not_found", phoneType: "corporate_phone" }).allowed, true);
});

// ─── phone_type gates independently of DNC ──────────────────────────────────

test("mobile is blocked by default even with consent and a clear DNC", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS_WRITTEN", dncStatus: "not_found", phoneType: "mobile_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "PHONE_TYPE_BLOCKED");
});

test("mobile is permitted only when config explicitly allows it", () => {
  const r = evaluateConsentBasis(
    { basis: "EXPRESS_WRITTEN", dncStatus: "not_found", phoneType: "mobile_phone" },
    { allowedPhoneTypes: ["mobile_phone", "direct_phone", "corporate_phone"] },
  );
  assert.equal(r.allowed, true);
});

test("an unknown or missing phone_type is blocked", () => {
  for (const phoneType of ["unknown", "", null, undefined]) {
    const r = evaluateConsentBasis({ basis: "EXPRESS", dncStatus: "not_found", phoneType: phoneType as string });
    assert.equal(r.allowed, false, `phone_type ${JSON.stringify(phoneType)} must be blocked`);
  }
});

test("the default allow-list excludes mobile", () => {
  assert.ok(!DEFAULT_ALLOWED_PHONE_TYPES.includes("mobile_phone"));
  assert.ok(DEFAULT_ALLOWED_PHONE_TYPES.includes("corporate_phone"));
});

// ─── the gates are ordered so the reported reason is the most fundamental ───

test("consent is reported before DNC when BOTH would block", () => {
  // "you have no basis to contact this person" is the more fundamental problem
  // than "this particular number is listed", and it is the one that does not go
  // away by finding another number.
  const r = evaluateConsentBasis({ basis: "NONE", dncStatus: "found", phoneType: "mobile_phone" });
  assert.equal(r.reason, "NO_CONSENT_BASIS");
});

test("DNC is reported before phone type when both would block", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS", dncStatus: "found", phoneType: "mobile_phone" });
  assert.equal(r.reason, "DNC_BLOCKED");
});

// ─── the CRM mapping preserves existing behaviour ───────────────────────────

test("the existing CRM flags map onto the basis without changing who can be texted", async () => {
  const { crmContactConsentBasis } = await import("../consent-basis");
  // consent_sms true, not globally opted out -> EXPRESS (was: allowed)
  assert.equal(crmContactConsentBasis({ consent_sms: true, do_not_contact: false }), "EXPRESS");
  // consent_sms false -> NONE (was: refused)
  assert.equal(crmContactConsentBasis({ consent_sms: false, do_not_contact: false }), "NONE");
  // do_not_contact overrides consent entirely (was: refused)
  assert.equal(crmContactConsentBasis({ consent_sms: true, do_not_contact: true }), "NONE");
  assert.equal(crmContactConsentBasis({ consent_sms: null, do_not_contact: null }), "NONE");
});

test("a dealer prospect with no consent record resolves to NONE", async () => {
  const { dealerProspectConsentBasis } = await import("../consent-basis");
  // Nothing in this change writes a consent basis, so every dealer prospect is
  // NONE and SMS reaches zero of them. Intended, not a gap.
  assert.equal(dealerProspectConsentBasis(null), "NONE");
  assert.equal(dealerProspectConsentBasis(undefined), "NONE");
  assert.equal(dealerProspectConsentBasis("NONE"), "NONE");
  assert.equal(dealerProspectConsentBasis("EXPRESS"), "EXPRESS");
  assert.equal(dealerProspectConsentBasis("garbage"), "NONE", "an unrecognised stored value fails closed");
});

test("screenPhone:false skips the phone screens but NEVER the consent gate", () => {
  // The CRM path uses this. It must not become a way to send without consent.
  const withConsent = evaluateConsentBasis(
    { basis: "EXPRESS", dncStatus: null, phoneType: null }, { screenPhone: false });
  assert.equal(withConsent.allowed, true, "a consented CRM contact must still be reachable");

  const withoutConsent = evaluateConsentBasis(
    { basis: "NONE", dncStatus: null, phoneType: null }, { screenPhone: false });
  assert.equal(withoutConsent.allowed, false, "screenPhone:false must not bypass consent");
  assert.equal(withoutConsent.reason, "NO_CONSENT_BASIS");
});

test("screening defaults ON, so a new caller fails closed", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS", dncStatus: null, phoneType: null });
  assert.equal(r.allowed, false, "omitting the option must screen, not skip");
  assert.equal(r.reason, "DNC_BLOCKED");
});
