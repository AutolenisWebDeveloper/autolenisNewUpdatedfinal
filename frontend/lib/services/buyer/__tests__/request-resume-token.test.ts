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
  /** Every argument object findUnique was called with, so the SELECT can be asserted. */
  findUniqueArgs: Array<Record<string, unknown>>;
  /** Counts calls that reached the MODULE-LEVEL client rather than a supplied handle. */
  moduleConsumeCalls: number;
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
        findUnique: async (args: { where: { tokenHash: string } }) => {
          ctrl.findUniqueArgs.push(args as unknown as Record<string, unknown>);
          return ctrl.recordsByHash[args.where.tokenHash] ?? null;
        },
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.moduleConsumeCalls += 1;
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
  ctrl = {
    created: [], recordsByHash: {}, consumeCount: 1, consumeWhere: null,
    findUniqueArgs: [], moduleConsumeCalls: 0,
  };
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

// ── the transaction handle ──────────────────────────────────────────────────
//
// The intake write path consumes the token that authorised it from inside
// `prisma.$transaction`. Bound to the module-level client, the consume would commit
// on its own connection — the token would burn even when the intake it authorised
// rolled back, leaving the visitor a dead link to a request that was never written.
// These two assert the handle is honoured AND that the default is unchanged, because
// the resume route and /complete still call it with one argument.

test("consume writes through a SUPPLIED transaction handle, not the module client", async () => {
  const { consumeResumeToken } = await load();
  const txCalls: Array<Record<string, unknown>> = [];
  const tx = {
    buyerRequestClaimToken: {
      updateMany: async ({ where }: { where: Record<string, unknown> }) => {
        txCalls.push(where);
        return { count: 1 };
      },
    },
  } as unknown as Parameters<typeof consumeResumeToken>[1];

  assert.equal(await consumeResumeToken("tok_tx", tx), true);
  assert.equal(txCalls.length, 1, "the supplied handle performed the write");
  assert.equal(txCalls[0]?.id, "tok_tx");
  assert.equal(txCalls[0]?.consumedAt, null, "still the conditional, race-safe update");
  assert.equal(
    ctrl.moduleConsumeCalls, 0,
    "the module-level client must NOT be touched — that is the write that would escape the transaction",
  );
});

test("consume still defaults to the module client — the two single-argument callers are unchanged", async () => {
  const { consumeResumeToken } = await load();
  ctrl.consumeCount = 1;
  assert.equal(await consumeResumeToken("tok_default"), true);
  assert.equal(ctrl.moduleConsumeCalls, 1, "no handle supplied → module client");
});

// ── the 42703 window ────────────────────────────────────────────────────────

test("validate names its columns explicitly — a new declared column cannot 42703 this read", async () => {
  const { validateResumeToken, hashResumeToken } = await load();
  const hash = hashResumeToken("sel");
  ctrl.recordsByHash[hash] = {
    id: "t", buyerId: "bA", vehicleRequestId: null,
    consumedAt: null, expiresAt: new Date(Date.now() + 1000),
  };
  await validateResumeToken("sel");

  assert.equal(ctrl.findUniqueArgs.length, 1);
  const select = ctrl.findUniqueArgs[0]?.select as Record<string, boolean> | undefined;
  assert.ok(
    select,
    "findUnique must pass an explicit select: Prisma's default read selects EVERY declared " +
      "scalar, so a column declared before its migration is applied raises 42703 here — which " +
      "breaks the $99 resume link and the rule-16 claim link at the same time",
  );
  assert.deepEqual(
    Object.keys(select).sort(),
    ["buyerId", "consumedAt", "expiresAt", "id", "vehicleRequestId"],
    "exactly the five columns this function reads, and no more",
  );
});
