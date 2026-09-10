// Unit tests for the deposit transition matrix (lib/payments/deposit-state.ts).
//
// Run with: npx tsx --test lib/payments/__tests__/deposit-state.test.ts
//
// PHASE 3 REWRITE. The matrix this file used to pin encoded money-path defect 1:
// `FAILED` was terminal AND was where a declined card landed. Stripe Elements retries
// on the SAME PaymentIntent, so a buyer whose first attempt was declined could never
// reach `PAID` again -- while the webhook, which resolved the deposit row separately
// from the status write, went on creating the auction, inviting dealers and emailing
// "deposit received" for a deposit that was still `FAILED`.
//
// The fix is not "make FAILED non-terminal". It is to stop putting a live intent there
// at all: a decline leaves the deposit `PENDING`, because the intent is still live and
// the buyer can retry on it. `FAILED` now means the intent itself is dead -- cancelled
// or expired -- which is a state nothing can retry out of. The `FAILED -> PAID` edge
// survives anyway, for the rows the OLD behaviour already stranded in production.

import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionDeposit,
  isTerminalDepositStatus,
  allowedPredecessors,
  DEPOSIT_STATUSES,
  SETTLE_FROM,
  DEAD_INTENT_FROM,
  DISPUTE_FROM,
  REFUND_FROM,
  DISPUTE_WON_FROM,
  depositNotOnHold,
} from "../deposit-state";

test("permitted edges", () => {
  assert.ok(canTransitionDeposit("PENDING", "PAID"));
  assert.ok(canTransitionDeposit("PENDING", "FAILED"), "a cancelled or expired intent");
  assert.ok(canTransitionDeposit("PAID", "REFUNDED"));
  assert.ok(canTransitionDeposit("PAID", "DISPUTED"), "the charge succeeded and is now contested");
  assert.ok(
    canTransitionDeposit("PENDING", "DISPUTED"),
    "a dispute can arrive for a charge whose success webhook was never delivered",
  );
  assert.ok(canTransitionDeposit("DISPUTED", "PAID"), "dispute won: the charge stands");
  assert.ok(canTransitionDeposit("DISPUTED", "REFUNDED"), "dispute lost: the funds went back");
});

// DEFECT 1, the regression. Against the pre-Phase-3 matrix this assertion fails:
// FAILED had an empty successor set and was in TERMINAL.
test("DEFECT 1: a deposit stranded at FAILED by the old behaviour can still settle", () => {
  assert.ok(
    canTransitionDeposit("FAILED", "PAID"),
    "Stripe Elements retries on the same PaymentIntent. Rows the old matrix pushed to FAILED on a " +
      "decline are still live at the provider, and a successful retry must be able to land.",
  );
  assert.ok(
    allowedPredecessors("PAID").includes("FAILED"),
    "the DB-level WHERE clause must admit it too, or the edge exists only on paper",
  );
});

test("disallowed / out-of-order edges fail closed", () => {
  assert.ok(!canTransitionDeposit("REFUNDED", "PAID"), "settled refund cannot revert to paid");
  assert.ok(!canTransitionDeposit("PAID", "FAILED"), "paid cannot downgrade to failed");
  assert.ok(!canTransitionDeposit("PENDING", "REFUNDED"), "cannot refund a never-paid deposit");
  assert.ok(!canTransitionDeposit("FAILED", "REFUNDED"), "nothing was captured, so nothing returns");
  assert.ok(!canTransitionDeposit("FAILED", "DISPUTED"), "a dead intent has no charge to contest");
  assert.ok(
    !canTransitionDeposit("REFUNDED", "DISPUTED"),
    "a dispute against an already-refunded charge is a Finance exception, not a status rewrite -- " +
      "the money already went back and overwriting REFUNDED would lose that",
  );
});

test("same-state is an idempotent no-op (allowed)", () => {
  for (const s of DEPOSIT_STATUSES) assert.ok(canTransitionDeposit(s, s));
});

test("REFUNDED is the only terminal state", () => {
  assert.ok(isTerminalDepositStatus("REFUNDED"));
  assert.ok(
    !isTerminalDepositStatus("FAILED"),
    "FAILED now means the intent is dead, not that the deposit is closed to a later success",
  );
  assert.ok(!isTerminalDepositStatus("PENDING"));
  assert.ok(!isTerminalDepositStatus("PAID"));
  assert.ok(!isTerminalDepositStatus("DISPUTED"), "a dispute resolves in one direction or the other");
});

test("allowedPredecessors backs the updateMany WHERE clause", () => {
  assert.deepEqual(allowedPredecessors("PAID").sort(), ["DISPUTED", "FAILED", "PENDING"]);
  assert.deepEqual(allowedPredecessors("FAILED"), ["PENDING"]);
  assert.deepEqual(allowedPredecessors("REFUNDED").sort(), ["DISPUTED", "PAID"]);
  assert.deepEqual(allowedPredecessors("DISPUTED").sort(), ["PAID", "PENDING"]);
});

// The matrix says what is LEGAL. It does not say which event may perform which edge, and
// conflating the two is how `allowedPredecessors("PAID")` would let a `payment_intent.succeeded`
// resurrect a DISPUTED deposit -- a dispute is resolved by `charge.dispute.closed`, never by a
// success event. Each caller passes the set for ITS event instead.
test("per-event predecessor sets are narrower than the matrix, and never wider", () => {
  const legal = (to: Parameters<typeof allowedPredecessors>[0]) => new Set(allowedPredecessors(to));
  const subset = (from: readonly string[], to: Parameters<typeof allowedPredecessors>[0]) =>
    from.every((f) => legal(to).has(f as never));

  assert.ok(subset(SETTLE_FROM, "PAID"));
  assert.ok(subset(DEAD_INTENT_FROM, "FAILED"));
  assert.ok(subset(DISPUTE_FROM, "DISPUTED"));
  assert.ok(subset(REFUND_FROM, "REFUNDED"));
  assert.ok(subset(DISPUTE_WON_FROM, "PAID"));

  assert.ok(
    !SETTLE_FROM.includes("DISPUTED" as never),
    "a payment_intent.succeeded must NOT clear a dispute -- charge.dispute.closed does that",
  );
  assert.deepEqual([...SETTLE_FROM].sort(), ["FAILED", "PENDING"]);
  assert.deepEqual([...DEAD_INTENT_FROM], ["PENDING"]);
});

// ── The fulfilment hold ─────────────────────────────────────────────────────
//
// The hold is DERIVED, per the Phase 1 wave's own migration comment: a deposit is on
// hold when `disputed_at IS NOT NULL AND hold_released_at IS NULL`. `depositNotOnHold()`
// is that rule's negation, and it lives here — beside the matrix — because three
// separate consumers read it (the fulfilment gate, the Premium fee credit, the upgrade
// window) and three hand-written spellings would eventually disagree.

test("depositNotOnHold is exactly the negation of the derived hold rule", () => {
  const { OR } = depositNotOnHold();
  assert.deepEqual(OR, [{ disputedAt: null }, { holdReleasedAt: { not: null } }]);
});

test("depositNotOnHold returns a fresh object each call", () => {
  const a = depositNotOnHold();
  const b = depositNotOnHold();
  assert.notEqual(a, b, "a shared literal spread into a caller's where-clause is aliasable by every call site");
  assert.notEqual(a.OR, b.OR);
});

// A truth table over the four reachable combinations, evaluated the way Prisma would.
test("the four hold states resolve as the rule says", () => {
  const t = new Date();
  const notOnHold = (row: { disputedAt: Date | null; holdReleasedAt: Date | null }) =>
    depositNotOnHold().OR.some((c) =>
      "disputedAt" in c ? row.disputedAt === c.disputedAt : row.holdReleasedAt !== c.holdReleasedAt.not,
    );

  assert.equal(notOnHold({ disputedAt: null, holdReleasedAt: null }), true, "never disputed");
  assert.equal(notOnHold({ disputedAt: t, holdReleasedAt: null }), false, "disputed, hold live — THE held case");
  assert.equal(notOnHold({ disputedAt: t, holdReleasedAt: t }), true, "dispute won, hold released");
  assert.equal(notOnHold({ disputedAt: null, holdReleasedAt: t }), true, "released with no dispute — not a hold");
});
