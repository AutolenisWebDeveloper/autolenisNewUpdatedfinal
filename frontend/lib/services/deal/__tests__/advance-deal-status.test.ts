// Unit tests for advanceDealStatus — Program 4 hardening of the canonical seam.
// Proves: (1) the status write is a compare-and-swap so a lost race re-resolves
// to an idempotent no-op (body runs exactly once for the winning transition);
// (2) the canonical completion event (purchase_completed) is emitted EXACTLY
// ONCE when — and only when — a deal enters COMPLETED.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   lib/services/deal/__tests__/advance-deal-status.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DealStatus, InsuranceStatus } from "@prisma/client";

interface DealRow {
  id: string;
  status: DealStatus;
  buyerId: string;
  insuranceStatus: InsuranceStatus;
  feePaidAt: Date | null;
  feeRefundedAt: Date | null;
}

interface Ctrl {
  deal: DealRow;
  // When set, the FIRST updateMany matching the guarded status returns count 0
  // (simulating another writer winning the race) and mutates the row to
  // `raceTo` before the caller re-reads.
  raceTo: DealStatus | null;
  /** When true, deal.findUnique throws — simulates a DB failure mid-drive. */
  throwOnFind: boolean;
  updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  updateCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  historyCreates: Array<Record<string, unknown>>;
  commsCalls: Array<{ dealId: string; status: string }>;
  completionEmits: string[];
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async () => {
          if (ctrl.throwOnFind) throw new Error("simulated DB failure");
          return { ...ctrl.deal };
        },
        update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          ctrl.updateCalls.push(args);
          Object.assign(ctrl.deal, args.data);
          return { ...ctrl.deal };
        },
        updateMany: async (args: { where: { status?: DealStatus }; data: Record<string, unknown> }) => {
          ctrl.updateManyCalls.push(args);
          // Race simulation: the first guarded swap loses — row already moved.
          if (ctrl.raceTo && args.where.status === ctrl.deal.status) {
            ctrl.deal.status = ctrl.raceTo;
            ctrl.raceTo = null;
            return { count: 0 };
          }
          if (args.where.status !== undefined && args.where.status !== ctrl.deal.status) {
            return { count: 0 };
          }
          Object.assign(ctrl.deal, args.data);
          return { count: 1 };
        },
      },
      dealStatusHistory: { create: async (a: { data: Record<string, unknown> }) => { ctrl.historyCreates.push(a.data); } },
      buyerActivityEvent: { create: async () => {} },
    },
  },
});

mock.module("@/lib/services/notifications/acquisition-comms", {
  namedExports: { emitDealStatusComms: async (dealId: string, status: string) => { ctrl.commsCalls.push({ dealId, status }); } },
});

mock.module("@/lib/services/deal/deal-completion-event.service", {
  namedExports: { emitDealCompletionEvent: async (dealId: string) => { ctrl.completionEmits.push(dealId); } },
});

async function load() { return import("../deal.service"); }

beforeEach(() => {
  ctrl = {
    deal: { id: "d1", status: "PICKUP_SCHEDULED", buyerId: "b1", insuranceStatus: InsuranceStatus.VERIFIED, feePaidAt: null, feeRefundedAt: null },
    raceTo: null,
    throwOnFind: false,
    updateManyCalls: [],
    updateCalls: [],
    historyCreates: [],
    commsCalls: [],
    completionEmits: [],
  };
});

test("status write is a compare-and-swap guarded on the observed status", async () => {
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "COMPLETED");
  assert.equal(ctrl.updateManyCalls.length >= 1, true, "must use updateMany (CAS), not an unconditional update");
  const first = ctrl.updateManyCalls[0]!;
  assert.equal(first.where.id, "d1");
  assert.equal(first.where.status, "PICKUP_SCHEDULED", "CAS must guard on the status observed at read time");
  assert.equal(first.data.status, "COMPLETED");
});

test("entering COMPLETED emits the canonical completion event exactly once", async () => {
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "COMPLETED");
  assert.deepEqual(ctrl.completionEmits, ["d1"]);
});

test("idempotent no-op (already COMPLETED) does NOT re-emit completion", async () => {
  ctrl.deal.status = "COMPLETED";
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "COMPLETED");
  assert.deepEqual(ctrl.completionEmits, [], "a re-entry into COMPLETED must not re-emit");
  assert.equal(ctrl.updateManyCalls.length, 0, "no swap on an idempotent no-op");
});

test("a non-COMPLETED transition does not emit the completion event", async () => {
  ctrl.deal.status = "ACTIVE";
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "FINANCING_PENDING");
  assert.deepEqual(ctrl.completionEmits, []);
  assert.deepEqual(ctrl.commsCalls, [{ dealId: "d1", status: "FINANCING_PENDING" }]);
});

test("lost CAS race that lands on the target state re-resolves to a no-op (body runs once)", async () => {
  // Another writer advances PICKUP_SCHEDULED → COMPLETED between our read and swap.
  ctrl.raceTo = "COMPLETED";
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "COMPLETED");
  // We lost the swap; on re-resolve the deal is already COMPLETED → no emit here,
  // no duplicate history. The winning writer owns the single emit.
  assert.deepEqual(ctrl.completionEmits, [], "the race loser must not emit a second completion event");
  assert.equal(ctrl.historyCreates.length, 0, "the race loser must not write a duplicate history row");
});

test("illegal transition throws DealTransitionError (fail-closed)", async () => {
  ctrl.deal.status = "FINANCING_PENDING";
  const { advanceDealStatus, DealTransitionError } = await load();
  await assert.rejects(() => advanceDealStatus("d1", "COMPLETED"), (e: unknown) => e instanceof DealTransitionError);
  assert.equal(ctrl.updateManyCalls.length, 0, "no swap attempted on an illegal transition");
});

test("insurance hard-gate blocks COMPLETED without proof on file", async () => {
  ctrl.deal.insuranceStatus = InsuranceStatus.NOT_STARTED;
  const { advanceDealStatus, InsuranceRequiredError } = await load();
  await assert.rejects(() => advanceDealStatus("d1", "COMPLETED"), (e: unknown) => e instanceof InsuranceRequiredError);
  assert.deepEqual(ctrl.completionEmits, []);
});

// ── Insurance-gate driver: INSURANCE_PENDING → CONTRACT_PENDING ──────────────
// This edge previously had NO automatic driver: the only buyer-facing insurance
// path (upload-proof) wrote insuranceStatus directly and never advanced, so every
// self-service deal stranded at INSURANCE_PENDING until an admin intervened.

test("proof on file advances INSURANCE_PENDING → CONTRACT_PENDING through the guarded seam", async () => {
  ctrl.deal.status = "INSURANCE_PENDING";
  ctrl.deal.insuranceStatus = InsuranceStatus.EXTERNAL_UPLOADED;
  const { advanceOnInsuranceSatisfied } = await load();
  const advanced = await advanceOnInsuranceSatisfied("d1");
  assert.equal(advanced, true);
  assert.equal(ctrl.deal.status, "CONTRACT_PENDING");
  // Went through advanceDealStatus: CAS + history + comms, not a raw write.
  assert.equal(ctrl.updateManyCalls[0]?.where.status, "INSURANCE_PENDING");
  assert.equal(ctrl.historyCreates.length, 1);
  assert.deepEqual(ctrl.commsCalls, [{ dealId: "d1", status: "CONTRACT_PENDING" }]);
});

for (const satisfied of [InsuranceStatus.VERIFIED, InsuranceStatus.POLICY_BOUND, InsuranceStatus.EXTERNAL_UPLOADED]) {
  test(`every INSURANCE_SATISFIED value releases the gate (${satisfied})`, async () => {
    ctrl.deal.status = "INSURANCE_PENDING";
    ctrl.deal.insuranceStatus = satisfied;
    const { advanceOnInsuranceSatisfied } = await load();
    assert.equal(await advanceOnInsuranceSatisfied("d1"), true);
    assert.equal(ctrl.deal.status, "CONTRACT_PENDING");
  });
}

test("unsatisfied insurance does NOT advance — the gate holds", async () => {
  ctrl.deal.status = "INSURANCE_PENDING";
  ctrl.deal.insuranceStatus = InsuranceStatus.QUOTE_REQUESTED;
  const { advanceOnInsuranceSatisfied } = await load();
  assert.equal(await advanceOnInsuranceSatisfied("d1"), false);
  assert.equal(ctrl.deal.status, "INSURANCE_PENDING");
  assert.equal(ctrl.updateManyCalls.length, 0, "no swap attempted while proof is missing");
});

test("no-op when the deal is not at INSURANCE_PENDING (never skips or rewinds a stage)", async () => {
  ctrl.deal.status = "FEE_PAID";
  ctrl.deal.insuranceStatus = InsuranceStatus.VERIFIED;
  const { advanceOnInsuranceSatisfied } = await load();
  assert.equal(await advanceOnInsuranceSatisfied("d1"), false);
  assert.equal(ctrl.deal.status, "FEE_PAID");
  assert.equal(ctrl.updateManyCalls.length, 0);
});

test("idempotent — re-driving an already-advanced deal does nothing", async () => {
  ctrl.deal.status = "INSURANCE_PENDING";
  ctrl.deal.insuranceStatus = InsuranceStatus.EXTERNAL_UPLOADED;
  const { advanceOnInsuranceSatisfied } = await load();
  assert.equal(await advanceOnInsuranceSatisfied("d1"), true);
  const swapsAfterFirst = ctrl.updateManyCalls.length;
  assert.equal(await advanceOnInsuranceSatisfied("d1"), false, "second call is a no-op");
  assert.equal(ctrl.updateManyCalls.length, swapsAfterFirst, "no second swap");
  assert.equal(ctrl.historyCreates.length, 1, "exactly one history row");
});

test("never throws — a DB failure while driving the gate is swallowed", async () => {
  ctrl.throwOnFind = true;
  const { advanceOnInsuranceSatisfied } = await load();
  assert.equal(await advanceOnInsuranceSatisfied("d1"), false, "returns false instead of throwing");
});

test("NEVER rewinds: losing the race to a deal that moved on to CONTRACT_REVIEW must not pull it back", async () => {
  // CONTRACT_REVIEW → CONTRACT_PENDING is a LEGAL transition (contract re-submit),
  // so without a from-guard the race loser re-resolves against the fresh state and
  // legally writes the deal BACKWARDS — stranding a passing Contract Shield deal.
  ctrl.deal.status = "INSURANCE_PENDING";
  ctrl.deal.insuranceStatus = InsuranceStatus.EXTERNAL_UPLOADED;
  ctrl.raceTo = "CONTRACT_REVIEW"; // another writer advances past us mid-flight
  const { advanceOnInsuranceSatisfied } = await load();
  await advanceOnInsuranceSatisfied("d1");
  assert.equal(ctrl.deal.status, "CONTRACT_REVIEW", "the deal must stay where the winner put it");
  assert.equal(
    ctrl.historyCreates.length,
    0,
    "no history row claiming an insurance-driven advance that never legitimately happened",
  );
});

test("ARRIVING at INSURANCE_PENDING with proof already on file releases the gate immediately", async () => {
  // upload-proof has no deal-status check, so a buyer can submit proof at any
  // stage. If they do it BEFORE the deal reaches INSURANCE_PENDING, the driver
  // no-ops at upload time — and without a re-check on arrival the deal strands at
  // INSURANCE_PENDING with satisfied proof, which is the exact bug the driver exists
  // to prevent.
  ctrl.deal.status = "FEE_PAID";
  ctrl.deal.insuranceStatus = InsuranceStatus.EXTERNAL_UPLOADED;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "INSURANCE_PENDING", { actorRole: "SYSTEM" });
  assert.equal(ctrl.deal.status, "CONTRACT_PENDING", "the gate must release on arrival, not only on upload");
  assert.deepEqual(
    ctrl.historyCreates.map((h) => h.toStatus),
    ["INSURANCE_PENDING", "CONTRACT_PENDING"],
    "both hops recorded",
  );
});

test("arriving at INSURANCE_PENDING WITHOUT proof still parks the deal there", async () => {
  ctrl.deal.status = "FEE_PAID";
  ctrl.deal.insuranceStatus = InsuranceStatus.NOT_STARTED;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "INSURANCE_PENDING", { actorRole: "SYSTEM" });
  assert.equal(ctrl.deal.status, "INSURANCE_PENDING", "no proof, no release — the gate still holds");
});

test("expectedFrom guards advanceDealStatus against advancing from any other state", async () => {
  ctrl.deal.status = "CONTRACT_REVIEW";
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "CONTRACT_PENDING", { expectedFrom: "INSURANCE_PENDING" });
  assert.equal(ctrl.deal.status, "CONTRACT_REVIEW", "no write when the deal is not in the expected state");
  assert.equal(ctrl.updateManyCalls.length, 0);
});

// ── Fee ladder: self-completing on arrival ──────────────────────────────────
// The only driver of FEE_PAID -> INSURANCE_PENDING was the Stripe webhook, so an
// admin "mark fee paid" stranded the deal at FEE_PAID forever. And a fee paid while
// the deal was still BEFORE FEE_PENDING was banked (feePaidAt set, which is also the
// duplicate-charge guard) but never advanced — wedging the deal permanently.

test("arriving at FEE_PAID with the fee already recorded continues to INSURANCE_PENDING", async () => {
  ctrl.deal.status = "FEE_PENDING";
  ctrl.deal.feePaidAt = new Date();
  ctrl.deal.insuranceStatus = InsuranceStatus.NOT_STARTED;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "FEE_PAID", { actorRole: "ADMIN", force: true });
  assert.equal(ctrl.deal.status, "INSURANCE_PENDING", "a paid fee must not strand the deal at FEE_PAID");
});

test("arriving at FEE_PENDING with the fee ALREADY paid settles the whole ladder", async () => {
  ctrl.deal.status = "FEE_PAID";
  ctrl.deal.status = "FINANCING_PENDING";
  ctrl.deal.feePaidAt = new Date();
  ctrl.deal.insuranceStatus = InsuranceStatus.NOT_STARTED;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "FEE_PENDING", { actorRole: "SYSTEM" });
  assert.equal(ctrl.deal.status, "INSURANCE_PENDING", "a fee paid before the fee stage must not wedge the deal");
  assert.deepEqual(
    ctrl.historyCreates.map((h) => h.toStatus),
    ["FEE_PENDING", "FEE_PAID", "INSURANCE_PENDING"],
    "every hop is recorded truthfully rather than force-skipped",
  );
});

test("arriving at FEE_PENDING with NO fee paid parks the deal there (still awaiting payment)", async () => {
  ctrl.deal.status = "FINANCING_PENDING";
  ctrl.deal.feePaidAt = null;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "FEE_PENDING", { actorRole: "SYSTEM" });
  assert.equal(ctrl.deal.status, "FEE_PENDING", "no payment, no advance");
});

test("the fee ladder chains into the insurance gate when proof is already on file", async () => {
  ctrl.deal.status = "FINANCING_PENDING";
  ctrl.deal.feePaidAt = new Date();
  ctrl.deal.insuranceStatus = InsuranceStatus.EXTERNAL_UPLOADED;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "FEE_PENDING", { actorRole: "SYSTEM" });
  assert.equal(ctrl.deal.status, "CONTRACT_PENDING", "fee ladder then insurance gate, both already satisfied");
});

// ── Cascade-safety regressions found in independent review ──────────────────

test("a CAS loser whose winner CASCADED past the target no-ops instead of throwing", async () => {
  // The winner's arrival hooks can carry the deal several hops. The loser then
  // re-resolves against a state from which the original target is no longer
  // reachable. That must be an idempotent no-op (someone else did the work), not a
  // DealTransitionError surfacing as a 500 on a buyer's double-click.
  ctrl.deal.status = "FINANCING_PENDING";
  ctrl.deal.feePaidAt = new Date();
  ctrl.raceTo = "INSURANCE_PENDING"; // winner cascaded well past FEE_PENDING
  const { advanceDealStatus } = await load();
  const moved = await advanceDealStatus("d1", "FEE_PENDING", { actorRole: "BUYER" });
  assert.equal(moved, false, "the race loser reports it did not move the deal");
  assert.equal(ctrl.deal.status, "INSURANCE_PENDING", "and must not drag the deal backwards");
});

test("the idempotent data-merge path still runs the arrival hooks", async () => {
  // mark-paid calls advanceDealStatus(FEE_PAID, {data:{feePaidAt}}) on a deal an
  // admin already parked at FEE_PAID. Returning early after merging `data` wrote
  // feePaidAt but never settled the ladder — stranding the deal at FEE_PAID.
  ctrl.deal.status = "FEE_PAID";
  ctrl.deal.feePaidAt = null;
  ctrl.deal.insuranceStatus = InsuranceStatus.NOT_STARTED;
  const { advanceDealStatus } = await load();
  await advanceDealStatus("d1", "FEE_PAID", { actorRole: "ADMIN", data: { feePaidAt: new Date() } });
  assert.equal(ctrl.deal.status, "INSURANCE_PENDING", "recording the fee must settle the ladder even on the no-op path");
});

test("a REFUNDED fee does not re-drive the ladder", async () => {
  // The refund route deliberately leaves feePaidAt set. Ops must be able to park a
  // refunded deal back on FEE_PENDING to re-collect without it instantly advancing.
  ctrl.deal.status = "FEE_PENDING";
  ctrl.deal.feePaidAt = new Date();
  ctrl.deal.feeRefundedAt = new Date();
  const { settleFeeLadderIfPaid } = await load();
  assert.equal(await settleFeeLadderIfPaid("d1"), false);
  assert.equal(ctrl.deal.status, "FEE_PENDING", "a refunded fee is not a paid fee");
});
