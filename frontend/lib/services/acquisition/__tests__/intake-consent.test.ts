// §5 rule 4 / §13-D46 — consent capture.
//
// Run: pnpm test:intake

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CONSENT_TEXTS, CURRENT_CONSENT_VERSION, consentTextHash, consentColumns } from "../intake-consent";

test("every consent hash is the SHA-256 of its own text — the pair cannot drift", () => {
  for (const [version, text] of Object.entries(CONSENT_TEXTS)) {
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    assert.equal(consentTextHash(version as keyof typeof CONSENT_TEXTS), expected, version);
  }
});

test("every channel names a version that exists", () => {
  for (const [channel, version] of Object.entries(CURRENT_CONSENT_VERSION)) {
    assert.ok(version in CONSENT_TEXTS, `${channel} names a version with no text`);
  }
});

test("the SMS text carries the TCPA disclosures", () => {
  const sms = CONSENT_TEXTS[CURRENT_CONSENT_VERSION.sms];
  assert.match(sms, /STOP/, "an SMS consent with no opt-out instruction is not consent");
  assert.match(sms, /rates may apply/i);
});

test("terms acceptance writes a version, a hash and a surface", () => {
  const cols = consentColumns({ surface: "homepage_hero", granted: { terms: true, email: true }, ip: "203.0.113.7" });
  assert.equal(cols.consentVersion, CURRENT_CONSENT_VERSION.terms);
  assert.equal(cols.consentTextHash, consentTextHash(CURRENT_CONSENT_VERSION.terms));
  assert.equal(cols.consentSurface, "homepage_hero");
  assert.equal(cols.consentIp, "203.0.113.7");
  assert.equal(cols.consentIpUnavailableReason, null);
  assert.ok(cols.consentAt instanceof Date);
});

test("no terms acceptance → NO version is manufactured", () => {
  // §13-D46 flags the OAuth path for storing a NULL terms version. Inventing one
  // here would hide that rather than fix it.
  const cols = consentColumns({ surface: "oauth_signup", granted: { email: true } });
  assert.equal(cols.consentVersion, null);
  assert.equal(cols.consentTextHash, null);
  assert.equal(cols.consentSurface, "oauth_signup", "the surface is still recorded");
});

test("declining is recorded as false, not as absence", () => {
  const declined = consentColumns({ surface: "hero", granted: { terms: true, sms: false } });
  assert.equal(declined.consentSms, false, "'declined' and 'no record' must not look the same to a send-time check");
  const granted = consentColumns({ surface: "hero", granted: { terms: true, sms: true } });
  assert.equal(granted.consentSms, true);
});

test("a missing consent IP records a reason, never a sentinel", () => {
  const cols = consentColumns({ surface: "hero", granted: { terms: true }, ipUnavailableReason: "PROXY_HEADER_ABSENT" });
  assert.equal(cols.consentIp, null);
  assert.equal(cols.consentIpUnavailableReason, "PROXY_HEADER_ABSENT");
});

test("no capture at all writes nothing rather than a default", () => {
  const cols = consentColumns(null);
  assert.equal(cols.consentVersion, null);
  assert.equal(cols.consentSms, null, "null, not false — we did not ask");
  assert.equal(cols.consentAt, null);
});
