// §5d settlement side effect, and the sequencing guard that keeps it out of production.
//
// "On settlement, atomically: record the payment and Stripe object; attach it to the
//  Vehicle Request; mark the request fulfillment-unlocked; cancel reminders; queue the
//  receipt; open the sourcing case."
//
// The guard is the part worth being careful about. Phase 3 removes the only path that
// invites dealers and the replacement is Phase 5's, so shipping this ON early would give
// every paying buyer an open sourcing case and no dealer — silently, with no error and
// no failed job. The default is asserted here rather than trusted.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/settlement-effects.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  openRequest: { id: string } | null;
  depositUpdates: Array<Record<string, unknown>>;
  requestUpdates: Array<Record<string, unknown>>;
  requestUpdateCount: number;
  caseCalls: Array<{ requestId: string }>;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {},
  },
});

mock.module("@/lib/services/sourcing/sourcing-case.service", {
  namedExports: {
    openSourcingCase: async (requestId: string) => {
      ctrl.caseCalls.push({ requestId });
      return { caseId: "case_1", created: true };
    },
  },
});

mock.module("@/lib/services/vehicle-request/open-request.service", {
  namedExports: {
    OPEN_REQUEST_STATUSES: ["DRAFT", "SUBMITTED", "INTAKE", "PAYMENT_REQUIRED", "ACTIVE_SOURCING"],
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() {
  return import("@/lib/services/payment/settlement-effects.service");
}

function tx() {
  return {
    deposit: {
      updateMany: async (args: Record<string, unknown>) => { ctrl.depositUpdates.push(args); return { count: 1 }; },
    },
    vehicleRequest: {
      findFirst: async () => ctrl.openRequest,
      updateMany: async (args: Record<string, unknown>) => {
        ctrl.requestUpdates.push(args);
        return { count: ctrl.requestUpdateCount };
      },
    },
  } as never;
}

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

beforeEach(() => {
  ctrl = { openRequest: null, depositUpdates: [], requestUpdates: [], requestUpdateCount: 1, caseCalls: [] };
  delete env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH;
  assert.equal(env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH, undefined);
});

const input = { depositId: "dep_1", buyerId: "buyer_1", vehicleRequestId: "vr_1" };

// ── The sequencing guard ─────────────────────────────────────────────────────

test("THE GUARD: with no flag set, the legacy auction path still runs", async () => {
  const { applySettlementEffects } = await load();
  const res = await applySettlementEffects(input, tx());
  assert.equal(
    res.runLegacyAuctionPath,
    true,
    "Phase 3 removes the only path that invites dealers and Phase 5 supplies the replacement. " +
      "Defaulting this off would give every paying buyer an open case and no dealer, silently.",
  );
});

test("only the exact string 'true' turns it on", async () => {
  const { applySettlementEffects } = await load();
  for (const v of ["", "false", "1", "TRUE", "yes"]) {
    env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = v;
    const res = await applySettlementEffects(input, tx());
    assert.equal(res.runLegacyAuctionPath, true, `"${v}" must not be read as on`);
  }
  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "true";
  const on = await applySettlementEffects(input, tx());
  assert.equal(on.runLegacyAuctionPath, false);
});

test("the flag is read at call time, so the flip needs no deploy", async () => {
  const { applySettlementEffects } = await load();
  assert.equal((await applySettlementEffects(input, tx())).runLegacyAuctionPath, true);
  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "true";
  assert.equal(
    (await applySettlementEffects(input, tx())).runLegacyAuctionPath,
    false,
    "a value captured at module load would mean reverting a money path required a deploy",
  );
});

// ── The side effect itself ───────────────────────────────────────────────────

test("the sourcing case is opened whether or not the flag is on", async () => {
  const { applySettlementEffects } = await load();
  await applySettlementEffects(input, tx());
  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "true";
  await applySettlementEffects(input, tx());

  assert.deepEqual(ctrl.caseCalls, [{ requestId: "vr_1" }, { requestId: "vr_1" }]);
  // With the flag off the legacy auction is created too, so the case accumulates
  // truthfully from day one. Gating it as well would make the flip a cutover with no
  // history behind it.
});

// §3 — "a record is never silently re-parented". The first cut of this service wrote
// the request link onto the deposit here, and the build-failing ratchet in
// lib/services/operations/__tests__/no-service-reparent.test.ts caught it. Its one
// allowlist entry is the AUDITED admin re-parent action; a settlement write has no
// admin, no reason and no audit row, so allowlisting this file would have widened a §3
// guard to admit an unaudited system write.
test("§3: settlement writes NO parent id onto the deposit", async () => {
  const { applySettlementEffects } = await load();
  await applySettlementEffects(input, tx());

  assert.deepEqual(
    ctrl.depositUpdates,
    [],
    "the link is written at INTENT CREATION, in an upsert's create block — giving a NEW row its " +
      "parent is what §3 requires, not what it forbids. Stamping one onto an existing row is the " +
      "act the ratchet holds at zero.",
  );
});

test("the unlock is guarded so a request past sourcing is not dragged backwards", async () => {
  const { applySettlementEffects } = await load();
  await applySettlementEffects(input, tx());

  const where = ctrl.requestUpdates[0]!.where as { status: { in: string[] } };
  const data = ctrl.requestUpdates[0]!.data as { status: string };
  assert.equal(data.status, "ACTIVE_SOURCING");
  assert.deepEqual([...where.status.in].sort(), ["DRAFT", "INTAKE", "PAYMENT_REQUIRED", "SUBMITTED"]);
  assert.ok(
    !where.status.in.includes("OFFER_SENT"),
    "a settlement arriving for a request already at OFFER_SENT is a redelivery or a repair; " +
      "resetting it to ACTIVE_SOURCING would discard real progress",
  );
});

test("a lost unlock race is reported as not-unlocked rather than as success", async () => {
  ctrl.requestUpdateCount = 0;
  const { applySettlementEffects } = await load();
  const res = await applySettlementEffects(input, tx());
  assert.equal(res.unlocked, false);
  assert.equal(res.sourcingCaseId, "case_1", "the case is still opened — the request exists either way");
});

// ── Rows that predate Phase 3 ────────────────────────────────────────────────

test("a deposit with no request link falls back to the buyer's open request", async () => {
  ctrl.openRequest = { id: "vr_legacy" };
  const { applySettlementEffects } = await load();
  const res = await applySettlementEffects({ ...input, vehicleRequestId: null }, tx());

  assert.equal(res.vehicleRequestId, "vr_legacy");
  assert.deepEqual(ctrl.caseCalls, [{ requestId: "vr_legacy" }]);
  // One open request per buyer is a database invariant, so this is unambiguous where it
  // resolves at all. It exists for the eight unattached rows R1b's backfill covers.
});

test("no request anywhere means nothing is invented — and the legacy path still runs", async () => {
  ctrl.openRequest = null;
  const { applySettlementEffects } = await load();
  const res = await applySettlementEffects({ ...input, vehicleRequestId: null }, tx());

  assert.equal(res.vehicleRequestId, null);
  assert.equal(res.sourcingCaseId, null);
  assert.equal(ctrl.caseCalls.length, 0, "attaching money to an arbitrary request is worse than not attaching it");
  assert.equal(res.runLegacyAuctionPath, true);
});
