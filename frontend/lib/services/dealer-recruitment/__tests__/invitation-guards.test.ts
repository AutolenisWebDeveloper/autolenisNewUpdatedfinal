// Invitation write guards.
//
// These pin the PREDICATES, which is where the bugs were: an unguarded write
// that trusts a read taken moments earlier, and a consume that a just-expired
// row could slip through. Integration tests prove the same behaviour against a
// real database (tests/integration/dealer-invitation-schema.itest.ts); these run
// in CI, where no database is available.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer-recruitment/__tests__/invitation-guards.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { hashToken } from "@/lib/services/dealer-recruitment/account-claim.service";

interface Call { where: Record<string, unknown>; data: Record<string, unknown> }
let calls: Call[] = [];
let updateManyCount = 1;

const prisma = {
  dealerInvitation: {
    updateMany: async (args: Call) => {
      calls.push(args);
      return { count: updateManyCount };
    },
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma } });

// Imported lazily, after the mock — top-level await is unsupported under the
// CJS transform tsx uses here.
function loadService() {
  return import("@/lib/services/dealer-recruitment/invitation-token.service");
}

beforeEach(() => {
  calls = [];
  updateManyCount = 1;
});

// ── consume ─────────────────────────────────────────────────────────────────

test("consume is guarded on BOTH status PENDING and consumedAt null", async () => {
  const { consumeInvitationToken } = await loadService();
  const now = new Date("2026-01-01T00:00:00Z");

  assert.equal(await consumeInvitationToken("inv1", "d1", now), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { id: "inv1", status: "PENDING", consumedAt: null });
  assert.deepEqual(calls[0].data, {
    status: "ACCEPTED", acceptedAt: now, consumedAt: now, dealerId: "d1",
  });
});

test("a consume that matched no row reports failure rather than success", async () => {
  const { consumeInvitationToken } = await loadService();
  updateManyCount = 0;
  assert.equal(await consumeInvitationToken("inv1", "d1"), false);
});

test("a consume that somehow matched several rows is NOT reported as won", async () => {
  const { consumeInvitationToken } = await loadService();
  updateManyCount = 2;
  assert.equal(await consumeInvitationToken("inv1", "d1"), false);
});

test("consume writes through the client it is handed, so a transaction keeps the guard", async () => {
  const { consumeInvitationToken } = await loadService();
  const txCalls: Call[] = [];
  const tx = {
    dealerInvitation: {
      updateMany: async (args: Call) => { txCalls.push(args); return { count: 1 }; },
    },
  } as unknown as Parameters<typeof consumeInvitationToken>[3];

  assert.equal(await consumeInvitationToken("inv1", "d1", new Date(), tx), true);
  assert.equal(txCalls.length, 1, "the write must go to the transaction, not the singleton");
  assert.equal(calls.length, 0);
  assert.equal(txCalls[0].where.status, "PENDING");
});

// ── resend / rotation ───────────────────────────────────────────────────────

test("resend mints a token from the shared scheme and stores only its hash", async () => {
  const { refreshInvitationToken } = await loadService();
  const now = new Date("2026-01-01T00:00:00Z");

  const rotated = await refreshInvitationToken("inv1", now);
  assert.ok(rotated);
  assert.equal(rotated.rawToken.length, 64, "256 bits, same as every other dealer token");

  const { data } = calls[0];
  assert.equal(data.tokenHash, hashToken(rotated.rawToken));
  assert.notEqual(data.tokenHash, rotated.rawToken, "the raw token is never persisted");
  // 7 days, not the 72h the removed HMAC scheme used.
  assert.equal((data.expiresAt as Date).getTime(), now.getTime() + 7 * 24 * 60 * 60 * 1000);
  assert.equal(data.status, "PENDING");
});

test("resend invalidates the superseded link — new hash AND the plaintext nulled", async () => {
  const { refreshInvitationToken } = await loadService();
  const first = await refreshInvitationToken("inv1");
  const second = await refreshInvitationToken("inv1");
  assert.ok(first && second);
  assert.notEqual(first.rawToken, second.rawToken, "a resend must not reissue the same token");
  assert.notEqual(calls[0].data.tokenHash, calls[1].data.tokenHash);
  assert.equal(calls[1].data.token, null, "a residual plaintext token must stop resolving");
});

test("resend is guarded so it cannot resurrect an ACCEPTED or CANCELLED invitation", async () => {
  const { refreshInvitationToken } = await loadService();
  await refreshInvitationToken("inv1");
  assert.deepEqual(calls[0].where, { id: "inv1", status: { in: ["PENDING", "EXPIRED"] } });
});

test("resend reports null when its guard matched nothing", async () => {
  const { refreshInvitationToken } = await loadService();
  updateManyCount = 0;
  assert.equal(await refreshInvitationToken("inv1"), null);
});

// ── sweep ───────────────────────────────────────────────────────────────────

test("the expiry sweep only retires PENDING rows that are actually past their TTL", async () => {
  const { expireStaleInvitations } = await loadService();
  const now = new Date("2026-01-01T00:00:00Z");
  await expireStaleInvitations(now);
  assert.deepEqual(calls[0].where, { status: "PENDING", expiresAt: { lt: now } });
  assert.deepEqual(calls[0].data, { status: "EXPIRED" });
});

// ── cancel ──────────────────────────────────────────────────────────────────

test("cancel is guarded so it cannot undo an invitation that was just accepted", async () => {
  const { cancelInvitation } = await loadService();
  assert.equal(await cancelInvitation("inv1"), true);
  assert.deepEqual(calls[0].where, { id: "inv1", status: { in: ["PENDING", "EXPIRED"] } });
  assert.deepEqual(calls[0].data, { status: "CANCELLED" });
});

test("cancel reports false when its guard matched nothing", async () => {
  const { cancelInvitation } = await loadService();
  updateManyCount = 0;
  assert.equal(await cancelInvitation("inv1"), false);
});
