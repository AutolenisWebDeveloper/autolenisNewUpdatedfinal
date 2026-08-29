// D3 — invitation tokens share the claim-token design instead of plaintext.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashToken, hashClaimToken, generateRawToken, INVITATION_TOKEN_TTL_MS,
} from "@/lib/services/dealer-recruitment/account-claim.service";
import { issueInvitationToken } from "@/lib/services/dealer-recruitment/invitation-token.service";

test("hashToken is sha256 hex", () => {
  assert.equal(
    hashToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("there is ONE hashing implementation — the claim helper delegates", () => {
  assert.equal(hashClaimToken("abc"), hashToken("abc"));
});
test("TTL is 7 days, matching the claim token (was 72h)", () => {
  assert.equal(INVITATION_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});
test("raw tokens carry 256 bits of entropy and are unique", () => {
  const a = generateRawToken(), b = generateRawToken();
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});
test("issue returns the raw token but persists only its hash", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const issued = issueInvitationToken(now);
  assert.equal(issued.tokenHash, hashToken(issued.rawToken));
  assert.notEqual(issued.tokenHash, issued.rawToken);
  assert.equal(issued.expiresAt.getTime(), now.getTime() + INVITATION_TOKEN_TTL_MS);
});
