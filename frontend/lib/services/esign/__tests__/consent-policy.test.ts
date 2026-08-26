// §1/§2 consent policy — validation fails closed unless ALL required
// acknowledgments are affirmatively accepted; the snapshot freezes the exact text.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_POLICY_VERSION,
  getActiveConsentPolicy,
  validateAcknowledgments,
  buildConsentSnapshot,
  IncompleteConsentError,
} from "../consent-policy";

const allKeys = () => getActiveConsentPolicy().acknowledgments.map((a) => ({ key: a.key, accepted: true }));

test("the active policy defines exactly four acknowledgments with non-empty text", () => {
  const policy = getActiveConsentPolicy();
  assert.equal(policy.version, CONSENT_POLICY_VERSION);
  assert.equal(policy.acknowledgments.length, 4);
  assert.ok(policy.acknowledgments.every((a) => a.text.trim().length > 20), "each acknowledgment has real copy");
});

test("validation passes only when all four are affirmatively accepted", () => {
  assert.doesNotThrow(() => validateAcknowledgments(allKeys()));
});

test("validation fails closed on a missing acknowledgment", () => {
  const three = allKeys().slice(0, 3);
  assert.throws(() => validateAcknowledgments(three), (e: unknown) => e instanceof IncompleteConsentError);
});

test("validation fails closed on an unchecked acknowledgment", () => {
  const acks = allKeys().map((a, i) => ({ ...a, accepted: i !== 0 }));
  assert.throws(() => validateAcknowledgments(acks), (e: unknown) => e instanceof IncompleteConsentError);
});

test("validation fails closed on an empty array (no preselection / a bare click is not consent)", () => {
  assert.throws(() => validateAcknowledgments([]), (e: unknown) => e instanceof IncompleteConsentError);
});

test("an unknown key can never satisfy a required acknowledgment", () => {
  const acks = [{ key: "NOT_A_REAL_KEY", accepted: true }];
  assert.throws(() => validateAcknowledgments(acks), (e: unknown) => e instanceof IncompleteConsentError);
});

test("the snapshot freezes the exact text + binding + attribution", () => {
  const now = new Date("2026-08-26T12:00:00Z");
  const snap = buildConsentSnapshot({
    signerUserId: "b1", signerName: "Sam Buyer", signerRole: "BUYER", signerEmail: "sam@example.com",
    documentVersionId: "cv_1", documentVersion: 1, documentHash: "hash", consentedAt: now,
    ipAddress: "1.2.3.4", userAgent: "UA",
  });
  assert.equal(snap.policyVersion, CONSENT_POLICY_VERSION);
  assert.equal(snap.acknowledgments.length, 4);
  assert.ok(snap.acknowledgments.every((a) => a.accepted && a.text.length > 0));
  assert.equal(snap.documentHash, "hash");
  assert.equal(snap.documentVersionId, "cv_1");
  assert.equal(snap.signerUserId, "b1");
  assert.equal(snap.consentedAt, now.toISOString());
});
