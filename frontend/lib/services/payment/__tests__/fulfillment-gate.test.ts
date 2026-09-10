// Unit tests for the $99 pre-activation cost gate — isFulfillmentUnlocked.
//
// Pins the invariant "NO PAID $99 = NO cost-bearing / dealer-facing fulfillment":
//   • unlocked ONLY when a PAID deposit exists for the buyer;
//   • a null/absent buyer id (anonymous lead — cannot have paid) is never unlocked;
//   • the query is scoped to status PAID (a PENDING intent does not unlock);
//   • a deposit under a dispute/refund HOLD does not unlock, however PAID it is
//     (PAY-38b — the clause that makes §26's dispute row mean anything).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/fulfillment-gate.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  findWhere: Record<string, unknown> | null;
  paidRow: { id: string } | null;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.findWhere = where;
          return ctrl.paidRow;
        },
      },
    },
  },
});

async function load() {
  return import("@/lib/services/payment/fulfillment-gate");
}

beforeEach(() => {
  ctrl = { findWhere: null, paidRow: null };
});

test("unlocked when a PAID deposit exists for the buyer", async () => {
  ctrl.paidRow = { id: "dep_1" };
  const { isFulfillmentUnlocked } = await load();
  const out = await isFulfillmentUnlocked("b1");
  assert.equal(out, true);
  assert.equal(ctrl.findWhere?.buyerId, "b1");
  assert.equal(ctrl.findWhere?.status, "PAID", "gate scoped to PAID, not PENDING");
});

test("NOT unlocked when no PAID deposit exists", async () => {
  ctrl.paidRow = null;
  const { isFulfillmentUnlocked } = await load();
  assert.equal(await isFulfillmentUnlocked("b1"), false);
});

test("NOT unlocked for a null buyer id — never queries", async () => {
  const { isFulfillmentUnlocked } = await load();
  assert.equal(await isFulfillmentUnlocked(null), false);
  assert.equal(await isFulfillmentUnlocked(undefined), false);
  assert.equal(await isFulfillmentUnlocked(""), false);
  assert.equal(ctrl.findWhere, null, "no DB query for an absent buyer");
});

// ── PAY-38b: the hold clause ────────────────────────────────────────────────
//
// Before Phase 3 this predicate read `status: "PAID"` alone, so a deposit carrying
// `disputed_at` still answered "unlocked" — dealer outreach, paid enrichment and the
// AI action gate would all keep spending against a charge the buyer was contesting.
// The hold is DERIVED (`disputed_at IS NOT NULL AND hold_released_at IS NULL`), so
// what is pinned here is the query's negation of it, not a stored column.

test("the query excludes deposits under a dispute/refund hold", async () => {
  ctrl.paidRow = { id: "dep_1" };
  const { isFulfillmentUnlocked } = await load();
  await isFulfillmentUnlocked("b1");

  const or = ctrl.findWhere?.OR as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(or), "the hold clause must reach the database, not be filtered in memory");
  assert.deepEqual(
    or,
    [{ disputedAt: null }, { holdReleasedAt: { not: null } }],
    "NOT on hold = never disputed, OR disputed and since released. Any other shape is a different rule.",
  );
});

test("a held deposit does not unlock, however PAID it is", async () => {
  // The mock returns what the WHERE would have matched; a held row matches nothing.
  ctrl.paidRow = null;
  const { isFulfillmentUnlocked } = await load();
  assert.equal(await isFulfillmentUnlocked("b1"), false);
  assert.equal(ctrl.findWhere?.status, "PAID", "the status clause is still there — the hold is an ADDITION");
});

// The hold predicate and its negation are defined once, in the module that owns the
// transition matrix, so the gate, the fee credit and the upgrade window cannot drift
// into three readings of the same rule.
test("the gate consumes the shared hold definition rather than re-spelling it", async () => {
  const { depositNotOnHold } = await import("@/lib/payments/deposit-state");
  ctrl.paidRow = { id: "dep_1" };
  const { isFulfillmentUnlocked } = await load();
  await isFulfillmentUnlocked("b1");
  assert.deepEqual(ctrl.findWhere?.OR, depositNotOnHold().OR);
});
