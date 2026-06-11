// WO-2 — claim-token hashing is deterministic and stored hashed (never plaintext).
// The issue/consume/expire/reuse flow against a live DB is covered in WO-15;
// here we lock the security-critical hashing contract that has no DB dependency.
//
// Run with:  npx tsx --test lib/services/dealer-recruitment/__tests__/account-claim.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hashClaimToken } from "../account-claim.service";

test("hashClaimToken is a deterministic SHA-256 hex digest", () => {
  const raw = "abc123";
  const expected = crypto.createHash("sha256").update(raw).digest("hex");
  assert.equal(hashClaimToken(raw), expected);
  // 64 hex chars = 256 bits.
  assert.match(hashClaimToken(raw), /^[0-9a-f]{64}$/);
});

test("different raw tokens hash to different values; same token is stable", () => {
  assert.notEqual(hashClaimToken("token-a"), hashClaimToken("token-b"));
  assert.equal(hashClaimToken("token-a"), hashClaimToken("token-a"));
});

test("hash is irreversible — the raw token is never recoverable from the hash", () => {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashClaimToken(raw);
  // The hash must not contain the raw token (sanity: no plaintext leakage).
  assert.ok(!hash.includes(raw));
});
