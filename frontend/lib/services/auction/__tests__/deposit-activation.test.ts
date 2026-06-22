// W0-A — deposit-activation reconciler contract.
// Run with:  npx tsx --test lib/services/auction/__tests__/deposit-activation.test.ts
//
// Locks the pure activation decision (classifyActivation) that drives the
// reconciler: a confirmed $99 always converges to a populated ACTIVE auction or
// an automatic refund, and the same input is decided the same way regardless of
// how many times the reconciler runs (the double-run safety property — combined
// with the per-deposit idempotency guard, equal decisions on equal state mean
// no double-invite / no double-refund).

import test from "node:test";
import assert from "node:assert/strict";
import { classifyActivation, type ActivationState } from "../deposit-activation-policy";

const base: ActivationState = {
  depositStatus: "PAID",
  depositRefunded: false,
  hasAuction: false,
  auctionStatus: undefined,
  invitationCount: 0,
  offerCount: 0,
  auctionAgeMinutes: 0,
  noDealerRefundGraceMinutes: 120,
};

test("unpaid or refunded deposits are skipped", () => {
  assert.equal(classifyActivation({ ...base, depositStatus: "PENDING" }), "skip");
  assert.equal(classifyActivation({ ...base, depositStatus: "FAILED" }), "skip");
  assert.equal(classifyActivation({ ...base, depositRefunded: true }), "skip");
});

test("PAID deposit with no auction → create_auction (webhook crashed before create)", () => {
  assert.equal(classifyActivation({ ...base, hasAuction: false }), "create_auction");
});

test("PENDING auction → launch (launchAuction swallowed-failed; no endsAt = permanently stuck without this)", () => {
  assert.equal(
    classifyActivation({ ...base, hasAuction: true, auctionStatus: "PENDING" }),
    "launch",
  );
});

test("ACTIVE auction with zero invitations within grace → invite (re-attempt the swallowed invite)", () => {
  assert.equal(
    classifyActivation({
      ...base,
      hasAuction: true,
      auctionStatus: "ACTIVE",
      invitationCount: 0,
      offerCount: 0,
      auctionAgeMinutes: 10,
    }),
    "invite",
  );
});

test("ACTIVE auction with zero invitations past the no-dealer grace → refund", () => {
  assert.equal(
    classifyActivation({
      ...base,
      hasAuction: true,
      auctionStatus: "ACTIVE",
      invitationCount: 0,
      offerCount: 0,
      auctionAgeMinutes: 121,
    }),
    "refund",
  );
});

test("ACTIVE auction that already has invitations is OK — never re-invited (load-safe)", () => {
  assert.equal(
    classifyActivation({
      ...base,
      hasAuction: true,
      auctionStatus: "ACTIVE",
      invitationCount: 8,
      auctionAgeMinutes: 200, // even past the grace, populated = OK, never refunded
    }),
    "ok",
  );
});

test("ACTIVE auction with offers but (somehow) zero invitations is OK — never refunded once bidding exists", () => {
  assert.equal(
    classifyActivation({
      ...base,
      hasAuction: true,
      auctionStatus: "ACTIVE",
      invitationCount: 0,
      offerCount: 1,
      auctionAgeMinutes: 200,
    }),
    "ok",
  );
});

test("CLOSED / CANCELLED auctions are skipped — F-001 owns post-close", () => {
  assert.equal(classifyActivation({ ...base, hasAuction: true, auctionStatus: "CLOSED" }), "skip");
  assert.equal(classifyActivation({ ...base, hasAuction: true, auctionStatus: "CANCELLED" }), "skip");
});

test("double-run safety: identical state yields an identical decision (no divergent re-action)", () => {
  const populated: ActivationState = {
    ...base,
    hasAuction: true,
    auctionStatus: "ACTIVE",
    invitationCount: 8,
  };
  // Two consecutive reconciler passes over an already-populated auction both say
  // 'ok' → the second pass never re-invites (which would double-increment load).
  assert.equal(classifyActivation(populated), "ok");
  assert.equal(classifyActivation(populated), "ok");

  const refunding: ActivationState = {
    ...base,
    hasAuction: true,
    auctionStatus: "ACTIVE",
    invitationCount: 0,
    offerCount: 0,
    auctionAgeMinutes: 200,
  };
  // First pass triggers refund (closes the auction). Once CLOSED, the deposit's
  // state on the next pass classifies as 'skip' — never a second refund.
  assert.equal(classifyActivation(refunding), "refund");
  assert.equal(classifyActivation({ ...refunding, auctionStatus: "CLOSED" }), "skip");
});

test("convergence: every PAID-deposit state resolves to a non-stuck action", () => {
  // Enumerate the reachable states and assert none returns an actionless dead-end.
  const terminalOrProgress = new Set([
    "ok", "skip", "create_auction", "launch", "invite", "refund",
  ]);
  for (const auctionStatus of [undefined, "PENDING", "ACTIVE", "CLOSED", "CANCELLED"]) {
    const a = classifyActivation({
      ...base,
      hasAuction: auctionStatus !== undefined,
      auctionStatus,
    });
    assert.ok(terminalOrProgress.has(a), `state ${auctionStatus} → ${a}`);
  }
});
