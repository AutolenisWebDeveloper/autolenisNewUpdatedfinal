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

// ── Schema-compat query shaping ─────────────────────────────────────────────
//
// Production has neither token_hash nor consumed_at, and `token` is still NOT
// NULL. These prove the service emits a query the database can actually answer
// in every schema generation, and — the load-bearing invariant — that a token
// minted in one generation is still redeemable in the next.

import {
  buildInvitationTokenFields,
  buildInvitationRotateFields,
  buildInvitationLookup,
  buildConsumeArgs,
} from "@/lib/services/dealer-recruitment/invitation-token.service";
import {
  LEGACY_CAPABILITIES,
  MODERN_CAPABILITIES,
} from "@/lib/services/dealer-recruitment/invitation-schema-compat";

const PARTIAL = { hasTokenHash: true, hasConsumedAt: false, hasToken: true, tokenRequired: true };
const TOKEN_DROPPED = { hasTokenHash: true, hasConsumedAt: true, hasToken: false, tokenRequired: false };

test("legacy: a new invitation writes only `token` — never the missing hash column", () => {
  const issued = issueInvitationToken();
  const fields = buildInvitationTokenFields(issued, LEGACY_CAPABILITIES);
  assert.deepEqual(Object.keys(fields), ["token"]);
  assert.equal(fields.token, issued.rawToken);
});

test("legacy stores the RAW token, not the hash — the migration backfill depends on it", () => {
  // A raw token and a SHA-256 hash are both 64 hex chars, so a row that stored
  // the hash in `token` would be indistinguishable to the backfill and would be
  // double-hashed into an unresolvable token_hash. Storing raw keeps
  // digest(token) == the hash a post-migration lookup computes.
  const issued = issueInvitationToken();
  const fields = buildInvitationTokenFields(issued, LEGACY_CAPABILITIES);
  assert.notEqual(fields.token, issued.tokenHash);
  assert.equal(hashToken(fields.token as string), issued.tokenHash);
});

test("modern: a new invitation writes only the hash — the raw token is never persisted", () => {
  const issued = issueInvitationToken();
  const fields = buildInvitationTokenFields(issued, MODERN_CAPABILITIES);
  assert.deepEqual(Object.keys(fields), ["tokenHash"]);
  assert.equal(fields.tokenHash, hashToken(issued.rawToken));
});

test("partially applied migration: both columns are written so NOT NULL is satisfied", () => {
  const issued = issueInvitationToken();
  const fields = buildInvitationTokenFields(issued, PARTIAL);
  assert.equal(fields.tokenHash, issued.tokenHash);
  assert.equal(fields.token, issued.rawToken);
});

test("after the token column is dropped, only the hash is written", () => {
  const issued = issueInvitationToken();
  assert.deepEqual(Object.keys(buildInvitationTokenFields(issued, TOKEN_DROPPED)), ["tokenHash"]);
});

test("a token minted in ANY schema generation is found by that generation's lookup", () => {
  for (const caps of [LEGACY_CAPABILITIES, MODERN_CAPABILITIES, PARTIAL, TOKEN_DROPPED]) {
    const issued = issueInvitationToken();
    const stored = buildInvitationTokenFields(issued, caps) as Record<string, string>;
    const branches = (buildInvitationLookup(issued.rawToken, caps).OR ?? []) as Record<string, string>[];
    const matched = branches.some(b =>
      Object.entries(b).every(([col, val]) => stored[col] === val),
    );
    assert.ok(matched, `lookup misses its own minted token for ${JSON.stringify(caps)}`);
  }
});

test("a token minted on the LEGACY schema is still redeemable after the migration", () => {
  // The exact production upgrade path: mint now, apply the migration, redeem.
  const issued = issueInvitationToken();
  const legacyRow = buildInvitationTokenFields(issued, LEGACY_CAPABILITIES);
  // The migration backfills token_hash = encode(digest(token,'sha256'),'hex').
  const backfilled = { ...legacyRow, tokenHash: hashToken(legacyRow.token as string) };
  const branches = (buildInvitationLookup(issued.rawToken, MODERN_CAPABILITIES).OR ?? []) as Record<string, string>[];
  assert.ok(
    branches.some(b => Object.entries(b).every(([col, val]) => (backfilled as Record<string, string>)[col] === val)),
    "a link emailed before the migration must still resolve after it",
  );
});

test("legacy lookup never references the absent hash column", () => {
  const branches = (buildInvitationLookup("raw", LEGACY_CAPABILITIES).OR ?? []) as Record<string, unknown>[];
  assert.deepEqual(branches, [{ token: "raw" }]);
});

test("modern lookup tries the hash first, then the pre-migration plaintext row", () => {
  const branches = (buildInvitationLookup("raw", MODERN_CAPABILITIES).OR ?? []) as Record<string, unknown>[];
  assert.deepEqual(branches, [{ tokenHash: hashToken("raw") }, { token: "raw" }]);
});

test("resend rotates the token and invalidates the previous link in every generation", () => {
  const issued = issueInvitationToken();
  // Modern: the hash is replaced AND the stale plaintext column is nulled.
  const modern = buildInvitationRotateFields(issued, MODERN_CAPABILITIES);
  assert.equal(modern.tokenHash, issued.tokenHash);
  assert.equal(modern.token, null, "a stale plaintext token must stop resolving");
  // Legacy: the plaintext column is overwritten with the new raw token.
  const legacy = buildInvitationRotateFields(issued, LEGACY_CAPABILITIES);
  assert.deepEqual(legacy, { token: issued.rawToken });
  // Partially applied: NOT NULL still has to be satisfied.
  assert.deepEqual(buildInvitationRotateFields(issued, PARTIAL), {
    tokenHash: issued.tokenHash, token: issued.rawToken,
  });
  // Token dropped: nothing to null.
  assert.deepEqual(buildInvitationRotateFields(issued, TOKEN_DROPPED), { tokenHash: issued.tokenHash });
});

test("consume is guarded on status PENDING in EVERY generation, not just where consumed_at exists", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const legacy = buildConsumeArgs("inv1", "d1", now, LEGACY_CAPABILITIES);
  assert.deepEqual(legacy.where, { id: "inv1", status: "PENDING" });
  assert.deepEqual(legacy.data, { status: "ACCEPTED", acceptedAt: now, dealerId: "d1" });

  const modern = buildConsumeArgs("inv1", "d1", now, MODERN_CAPABILITIES);
  assert.deepEqual(modern.where, { id: "inv1", status: "PENDING", consumedAt: null });
  assert.deepEqual(modern.data, {
    status: "ACCEPTED", acceptedAt: now, dealerId: "d1", consumedAt: now,
  });
});

test("consume never references consumed_at when the column does not exist", () => {
  const args = buildConsumeArgs("inv1", "d1", new Date(), LEGACY_CAPABILITIES);
  assert.ok(!("consumedAt" in args.where));
  assert.ok(!("consumedAt" in args.data));
});

test("a schema with NEITHER token column yields nothing to write and nothing to match", () => {
  // Not a shape any migration produces — but it is the shape a failed/partial
  // DDL could leave, and it must fail loudly (createInvitation throws on empty
  // token fields) rather than persist a dead invite or match on an empty filter.
  const broken = { hasTokenHash: false, hasConsumedAt: false, hasToken: false, tokenRequired: false };
  assert.deepEqual(buildInvitationTokenFields(issueInvitationToken(), broken), {});
  assert.deepEqual(buildInvitationLookup("raw", broken).OR, []);
});
