// Security tests for the $99 pre-checkout secure request-resume token.
//
// Proves the HIGH-severity resume credential is safe:
//   • the RAW token is 256-bit and is NEVER persisted — only its SHA-256 hash;
//   • validation is by hash lookup (no plaintext compare); a wrong/guessed token
//     resolves to a different hash → not_found (cannot read another buyer's row);
//   • expired and already-consumed tokens are rejected;
//   • consume is single-use and race-safe (conditional update; only one winner).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/buyer/__tests__/request-resume-token.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  created: Array<Record<string, unknown>>;
  recordsByHash: Record<string, Record<string, unknown> | null>;
  consumeCount: number;
  consumeWhere: Record<string, unknown> | null;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerRequestClaimToken: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.created.push(data);
          return { id: "tok_1", ...data };
        },
        findUnique: async ({ where }: { where: { tokenHash: string } }) =>
          ctrl.recordsByHash[where.tokenHash] ?? null,
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.consumeWhere = where;
          return { count: ctrl.consumeCount };
        },
      },
    },
  },
});

async function load() {
  return import("@/lib/services/buyer/request-resume-token.service");
}

beforeEach(() => {
  ctrl = { created: [], recordsByHash: {}, consumeCount: 1, consumeWhere: null };
});

test("issue persists ONLY the SHA-256 hash; the raw token is 256-bit and never stored", async () => {
  const { issueResumeToken, hashResumeToken } = await load();
  const { rawToken, expiresAt } = await issueResumeToken({ buyerId: "b1", vehicleRequestId: "vr1" });
  // 32 random bytes → 64 hex chars.
  assert.equal(rawToken.length, 64);
  assert.match(rawToken, /^[0-9a-f]{64}$/);
  assert.equal(ctrl.created.length, 1);
  const stored = ctrl.created[0];
  assert.equal(stored.buyerId, "b1");
  assert.equal(stored.vehicleRequestId, "vr1");
  // The stored value is the hash, NOT the raw token.
  assert.notEqual(stored.tokenHash, rawToken, "raw token must never be persisted");
  assert.equal(stored.tokenHash, hashResumeToken(rawToken), "stored value is the SHA-256 hash");
  assert.ok(expiresAt instanceof Date && expiresAt.getTime() > Date.now(), "expiry in the future");
});

test("validate resolves a live token to its bound buyer (hash lookup)", async () => {
  const { issueResumeToken, validateResumeToken, hashResumeToken } = await load();
  const { rawToken } = await issueResumeToken({ buyerId: "bA", vehicleRequestId: "vrA" });
  const hash = hashResumeToken(rawToken);
  ctrl.recordsByHash[hash] = {
    id: "tok_1", buyerId: "bA", vehicleRequestId: "vrA",
    consumedAt: null, expiresAt: new Date(Date.now() + 1000),
  };
  const v = await validateResumeToken(rawToken);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.buyerId, "bA");
    assert.equal(v.vehicleRequestId, "vrA");
  }
});

test("a guessed/wrong token hashes to a different key → not_found (no cross-buyer read)", async () => {
  const { validateResumeToken, hashResumeToken } = await load();
  // Only buyer A's token exists in the store.
  const realHash = hashResumeToken("aaaa");
  ctrl.recordsByHash[realHash] = { id: "t", buyerId: "bA", vehicleRequestId: null, consumedAt: null, expiresAt: new Date(Date.now() + 1000) };
  const v = await validateResumeToken("an-attacker-guess"); // different hash → miss
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "not_found");
});

test("expired token is rejected", async () => {
  const { validateResumeToken, hashResumeToken } = await load();
  const hash = hashResumeToken("exp");
  ctrl.recordsByHash[hash] = { id: "t", buyerId: "bA", vehicleRequestId: null, consumedAt: null, expiresAt: new Date(Date.now() - 1000) };
  const v = await validateResumeToken("exp");
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "expired");
});

test("already-consumed token is rejected", async () => {
  const { validateResumeToken, hashResumeToken } = await load();
  const hash = hashResumeToken("used");
  ctrl.recordsByHash[hash] = { id: "t", buyerId: "bA", vehicleRequestId: null, consumedAt: new Date(), expiresAt: new Date(Date.now() + 1000) };
  const v = await validateResumeToken("used");
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "consumed");
});

test("empty/garbage input is not_found (no throw, no query surprise)", async () => {
  const { validateResumeToken } = await load();
  const v = await validateResumeToken("");
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "not_found");
});

test("consume is single-use + race-safe — only the winner (count===1) succeeds", async () => {
  const { consumeResumeToken } = await load();
  ctrl.consumeCount = 1;
  assert.equal(await consumeResumeToken("tok_1"), true);
  // The conditional update is scoped to an un-consumed row.
  assert.equal(ctrl.consumeWhere?.id, "tok_1");
  assert.equal(ctrl.consumeWhere?.consumedAt, null);
  // A concurrent loser sees count===0.
  ctrl.consumeCount = 0;
  assert.equal(await consumeResumeToken("tok_1"), false);
});
