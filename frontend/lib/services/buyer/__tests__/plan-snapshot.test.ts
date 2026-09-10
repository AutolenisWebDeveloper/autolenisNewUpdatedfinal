// §23.1 / §23.5 — the request-bound half of the plan snapshot writer.
//
// `lib/services/buyer/plan-snapshot.service.ts` had no unit test of its own: the
// buyer-level Stage 1 functions were exercised only through the upgrade route, and
// Phase 3's request-bound additions had none at all. Two things below are the reason to
// have one.
//
// THE DEDUPE IS THE SUBTLE PART. At buyer level, re-electing the plan you already hold
// is not a change and must not write. At REQUEST level the same comparison is wrong in
// two directions: §23.1 says a new request means a fresh election, and a snapshot
// recording what SETTLED is not a repeat of one recording an intention. The second
// independent review found the second of those — a buyer who elected PREMIUM before
// paying already had a PREMIUM snapshot, so settlement's own election, carrying
// `settled_deposit_cents` and touchpoint "settlement", was discarded as a duplicate and
// the money was never recorded for exactly the buyers whose money had just moved.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/buyer/__tests__/plan-snapshot.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  latest: Record<string, unknown> | null;
  created: Array<Record<string, unknown>>;
  requestUpdates: Array<Record<string, unknown>>;
  dealUpdates: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      planSnapshot: {
        findFirst: async () => ctrl.latest,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.created.push(data);
          return data;
        },
      },
      vehicleRequest: {
        updateMany: async (args: Record<string, unknown>) => { ctrl.requestUpdates.push(args); return { count: 1 }; },
      },
      deal: {
        updateMany: async (args: Record<string, unknown>) => { ctrl.dealUpdates.push(args); return { count: 1 }; },
      },
    },
  },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/buyer/plan-snapshot.service");
}

const BASE = {
  buyerId: "buyer_1",
  vehicleRequestId: "vr_1",
  plan: "PREMIUM" as const,
  actor: "system:settlement",
};

beforeEach(() => {
  ctrl = { latest: null, created: [], requestUpdates: [], dealUpdates: [] };
});

test("the first election for a request is always written and bound", async () => {
  const { recordRequestPlanElection } = await load();
  const res = await recordRequestPlanElection({ ...BASE, touchpoint: "settlement" });

  assert.notEqual(res.snapshot, null);
  assert.equal(ctrl.created.length, 1);
  assert.equal(ctrl.created[0]!.vehicleRequestId, "vr_1");
  assert.equal(
    (ctrl.requestUpdates[0]!.data as { currentPlanSnapshotId: string }).currentPlanSnapshotId,
    res.boundSnapshotId,
    "the pointer the Phase 1 wave provisioned and nothing wrote",
  );
});

test("re-electing the same plan writes nothing but still binds the pointer", async () => {
  ctrl.latest = { id: "snap_prior", plan: "PREMIUM", settledDepositCents: null };
  const { recordRequestPlanElection } = await load();
  const res = await recordRequestPlanElection({ ...BASE, touchpoint: "buyer_dashboard_upgrade" });

  assert.equal(res.snapshot, null, "electing the plan you already elected is not a change");
  assert.equal(res.boundSnapshotId, "snap_prior");
  assert.equal(
    ctrl.requestUpdates.length,
    1,
    "the pointer is written anyway — every row from before Phase 3 has a snapshot and no pointer",
  );
});

// THE DEFECT the second review found.
test("a snapshot carrying settled money is written even when the plan is unchanged", async () => {
  ctrl.latest = { id: "snap_prior", plan: "PREMIUM", settledDepositCents: null };
  const { recordRequestPlanElection } = await load();
  const res = await recordRequestPlanElection({
    ...BASE,
    touchpoint: "settlement",
    settledDepositCents: 9900,
  });

  assert.notEqual(res.snapshot, null, "a record of what SETTLED is not a repeat of a record of intent");
  assert.equal(ctrl.created[0]!.settledDepositCents, 9900);
  assert.equal(ctrl.created[0]!.touchpoint, "settlement");
});

test("re-running the SAME settlement writes nothing — a redelivery is not a second payment", async () => {
  ctrl.latest = { id: "snap_settled", plan: "PREMIUM", settledDepositCents: 9900 };
  const { recordRequestPlanElection } = await load();
  const res = await recordRequestPlanElection({
    ...BASE,
    touchpoint: "settlement",
    settledDepositCents: 9900,
  });

  assert.equal(res.snapshot, null);
  assert.equal(res.boundSnapshotId, "snap_settled");
});

test("a plan CHANGE always writes, money or not", async () => {
  ctrl.latest = { id: "snap_prior", plan: "PREMIUM", settledDepositCents: 9900 };
  const { recordRequestPlanElection } = await load();
  const res = await recordRequestPlanElection({ ...BASE, plan: "STANDARD", touchpoint: "downgrade" });

  assert.notEqual(res.snapshot, null, "§23.5: every plan change appends");
  assert.equal(ctrl.created[0]!.plan, "STANDARD");
});

test("a deal id binds the deal pointer too", async () => {
  const { recordRequestPlanElection } = await load();
  await recordRequestPlanElection({ ...BASE, touchpoint: "settlement", dealId: "deal_1" });
  assert.equal(ctrl.dealUpdates.length, 1);
});

test("no deal id leaves the deal pointer alone", async () => {
  const { recordRequestPlanElection } = await load();
  await recordRequestPlanElection({ ...BASE, touchpoint: "settlement" });
  assert.equal(ctrl.dealUpdates.length, 0);
});
