// S6-02a / S6-29a — opening the sourcing case at settlement.
//
// Idempotency here is not a nicety. Stripe redelivers on any 5xx, and the settlement
// transaction can legitimately run twice; a second case row is impossible (the column
// is unique) but a second set of due-diligence checkpoints is not, and that would give
// an operator eight checkpoints with no way to tell which four were real.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/sourcing/__tests__/sourcing-case.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  createThrows: { code?: string } | null;
  existingCase: { id: string } | null;
  creates: Array<Record<string, unknown>>;
  checkpointCalls: string[];
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });
mock.module("@/lib/services/vehicle-request/vehicle-request-due-diligence.service", {
  namedExports: {
    initializeCheckpoints: async (requestId: string) => {
      ctrl.checkpointCalls.push(requestId);
      return { count: 4 };
    },
  },
});

async function load() { return import("@/lib/services/sourcing/sourcing-case.service"); }

function db() {
  return {
    sourcingCase: {
      create: async (args: Record<string, unknown>) => {
        if (ctrl.createThrows) throw Object.assign(new Error("unique"), ctrl.createThrows);
        ctrl.creates.push(args);
        return { id: "case_new" };
      },
      findUnique: async () => ctrl.existingCase,
    },
  } as never;
}

beforeEach(() => {
  ctrl = { createThrows: null, existingCase: null, creates: [], checkpointCalls: [] };
});

test("opens the case at ACTIVE_SOURCING and seeds the checkpoints with it", async () => {
  const { openSourcingCase, SOURCING_CASE_STATUS } = await load();
  const res = await openSourcingCase("vr_1", db());

  assert.deepEqual(res, { caseId: "case_new", created: true });
  const data = ctrl.creates[0]!.data as Record<string, unknown>;
  assert.equal(data.vehicleRequestId, "vr_1");
  assert.equal(data.status, SOURCING_CASE_STATUS.ACTIVE_SOURCING);
  assert.ok(typeof data.id === "string" && data.id.length > 0, "the model has no @default on id");
  assert.deepEqual(ctrl.checkpointCalls, ["vr_1"], "seeded in the same call, not afterwards");
});

test("the band is left to the schema default rather than restated", async () => {
  const { openSourcingCase } = await load();
  await openSourcingCase("vr_1", db());
  const data = ctrl.creates[0]!.data as Record<string, unknown>;
  assert.equal(
    data.band,
    undefined,
    "one place decides where the 100 → 150 → 250 ladder starts, and it is the schema default",
  );
});

// The redelivery case, resolved by the CONSTRAINT rather than by a prior read.
test("a redelivered settlement returns the existing case instead of failing", async () => {
  ctrl.createThrows = { code: "P2002" };
  ctrl.existingCase = { id: "case_existing" };
  const { openSourcingCase } = await load();

  const res = await openSourcingCase("vr_1", db());
  assert.deepEqual(res, { caseId: "case_existing", created: false });
  assert.deepEqual(
    ctrl.checkpointCalls,
    ["vr_1"],
    "checkpoints are still ensured — an earlier partial run could have created the case and " +
      "failed before seeding them",
  );
});

test("a unique violation that is NOT this constraint is rethrown, not swallowed", async () => {
  ctrl.createThrows = { code: "P2002" };
  ctrl.existingCase = null; // nothing to find → the collision was on something else
  const { openSourcingCase } = await load();
  await assert.rejects(() => openSourcingCase("vr_1", db()));
});

test("a non-unique error is rethrown", async () => {
  ctrl.createThrows = { code: "P2003" };
  const { openSourcingCase } = await load();
  await assert.rejects(() => openSourcingCase("vr_1", db()));
});

// BLOCKER, found by the independent review: the P2002 recovery below runs INSIDE the
// settlement transaction, and the create-then-catch-then-re-read idiom is broken there.
// PostgreSQL aborts the whole transaction on a constraint violation and Prisma issues no
// savepoints, so the re-read throws 25P02 on an aborted transaction — and
// `lib/prisma-savepoint.ts` records the worse variant measured on PG16, where the outer
// `$transaction` RESOLVES while Postgres turns the COMMIT into a ROLLBACK and the caller
// is handed ids for rows that were never written.
//
// The redelivery this recovery exists for is a redelivery inside the money transaction,
// so the unguarded version failed exactly when it was needed.
test("the insert is SAVEPOINTED, so a P2002 leaves the transaction usable", async () => {
  const scoped: string[] = [];
  const { openSourcingCase } = await load();

  // A handle that looks like a TRANSACTION client (no `$transaction`) and can run raw
  // SQL — the shape `withSavepoint` acts on.
  const tx = {
    $executeRawUnsafe: async (sql: string) => { scoped.push(sql.split(" ")[0]!); return 0; },
    sourcingCase: {
      create: async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); },
      findUnique: async () => ({ id: "case_existing" }),
    },
  };

  const res = await openSourcingCase("vr_1", tx as never);

  assert.equal(res.caseId, "case_existing");
  assert.equal(res.created, false);
  assert.deepEqual(
    scoped,
    ["SAVEPOINT", "ROLLBACK"],
    "the failed insert is rolled back to its savepoint, which is what leaves the surrounding " +
      "settlement transaction able to commit",
  );
});
