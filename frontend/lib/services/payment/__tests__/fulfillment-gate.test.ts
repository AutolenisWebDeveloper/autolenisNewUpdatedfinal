// Unit tests for the $99 pre-activation cost gate — isFulfillmentUnlocked.
//
// Pins the invariant "NO PAID $99 = NO cost-bearing / dealer-facing fulfillment":
//   • unlocked ONLY when a PAID deposit exists for the buyer;
//   • a null/absent buyer id (anonymous lead — cannot have paid) is never unlocked;
//   • the query is scoped to status PAID (a PENDING intent does not unlock).
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
