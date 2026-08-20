// lib/security/field-encryption.ts
//
// Shared AES-256-GCM field encryption for sensitive buyer credit PII at rest
// (SSN, income, employment, DOB). Uses the SAME platform PII key as the prequal
// consumer-report encryption (PREQUAL_ENCRYPTION_KEY) rather than a second key —
// financing and prequal are the same security domain (buyer credit PII), so they
// share one key. FAIL-FAST: there is NO default key; a missing/malformed key
// throws rather than silently degrading to a guessable key. Validated lazily on
// first use so `next build` static analysis is not broken by a throw at import.
//
// Format: "<iv-b64>:<authTag-b64>:<ciphertext-b64>". The GCM auth tag makes any
// tampering fail closed on decrypt.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Shared platform PII key (also used by prequal/microbilt for consumer reports).
const KEY_ENV = "PREQUAL_ENCRYPTION_KEY";
const KEY_RE = /^[0-9a-fA-F]{64}$/; // 32-byte AES-256 key as hex

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env[KEY_ENV];
  if (!hex || !KEY_RE.test(hex)) {
    throw new Error(
      `${KEY_ENV} is missing or not a 64-character hex string (required 32-byte ` +
        `AES-256-GCM key). Refusing to encrypt financing PII with an insecure fallback key.`,
    );
  }
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

export function isFinancingEncryptionConfigured(): boolean {
  const hex = process.env[KEY_ENV];
  return !!hex && KEY_RE.test(hex);
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptField(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("malformed encrypted field (expected iv:authTag:ciphertext)");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Encrypt when a value is present; pass through null/undefined unchanged. */
export function encryptOptionalField(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return encryptField(value);
}

/** Decrypt when present; null-safe. Throws only on a genuinely malformed/tampered value. */
export function decryptOptionalField(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decryptField(value);
}

// Test-only: the key is cached on first use; tests that change the env must reset.
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
}
