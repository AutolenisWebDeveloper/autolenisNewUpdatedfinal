// Phase 5 Block 3 — AES-256-GCM field encryption for financing PII (SSN, income,
// employment, DOB). Fail-fast: no default key ever (a missing/short key throws,
// never silently degrades). GCM auth tag makes tampering detectable on decrypt.
// Mirrors the discipline in prequal/microbilt.service.ts but is the shared helper.
//
// Run: pnpm test:security

import test from "node:test";
import assert from "node:assert/strict";

const GOOD_KEY = "a".repeat(64); // 32-byte hex

test("roundtrip: decrypt(encrypt(x)) === x, and ciphertext is not the plaintext", async () => {
  process.env.FINANCING_ENCRYPTION_KEY = GOOD_KEY;
  const { encryptField, decryptField, __resetKeyCacheForTests } = await import("@/lib/security/field-encryption");
  __resetKeyCacheForTests();
  const secret = "123-45-6789";
  const enc = encryptField(secret);
  assert.notEqual(enc, secret);
  assert.match(enc, /^[^:]+:[^:]+:[^:]+$/, "iv:tag:ciphertext format");
  assert.equal(decryptField(enc), secret);
});

test("two encryptions of the same value differ (random IV) but both decrypt", async () => {
  process.env.FINANCING_ENCRYPTION_KEY = GOOD_KEY;
  const { encryptField, decryptField, __resetKeyCacheForTests } = await import("@/lib/security/field-encryption");
  __resetKeyCacheForTests();
  const a = encryptField("same");
  const b = encryptField("same");
  assert.notEqual(a, b, "random IV ⇒ different ciphertext");
  assert.equal(decryptField(a), "same");
  assert.equal(decryptField(b), "same");
});

test("tampered ciphertext fails the GCM auth tag on decrypt", async () => {
  process.env.FINANCING_ENCRYPTION_KEY = GOOD_KEY;
  const { encryptField, decryptField, __resetKeyCacheForTests } = await import("@/lib/security/field-encryption");
  __resetKeyCacheForTests();
  const enc = encryptField("90000.00");
  const [iv, tag, ct] = enc.split(":");
  const flipped = Buffer.from(ct!, "base64");
  flipped[0] = flipped[0]! ^ 0xff;
  const tampered = `${iv}:${tag}:${flipped.toString("base64")}`;
  assert.throws(() => decryptField(tampered), "authenticated decryption rejects tampering");
});

test("FAIL-FAST: a missing or short key throws — never a silent insecure fallback", async () => {
  delete process.env.FINANCING_ENCRYPTION_KEY;
  const { encryptField, isFinancingEncryptionConfigured, __resetKeyCacheForTests } = await import("@/lib/security/field-encryption");
  __resetKeyCacheForTests();
  assert.equal(isFinancingEncryptionConfigured(), false);
  assert.throws(() => encryptField("x"), /FINANCING_ENCRYPTION_KEY/);

  process.env.FINANCING_ENCRYPTION_KEY = "tooshort";
  __resetKeyCacheForTests();
  assert.equal(isFinancingEncryptionConfigured(), false);
  assert.throws(() => encryptField("x"), /FINANCING_ENCRYPTION_KEY/);
});
