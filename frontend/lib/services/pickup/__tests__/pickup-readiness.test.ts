// §Stage 16's thirteen-item readiness checklist.
//
// WRITTEN FAILING FIRST. Before this change nothing in the pickup rail evaluated any of the
// thirteen — §Stage 16 L897 says so in the specification itself: "Current pickup coordination
// evaluates none of these." Every test below fails against that implementation because the
// module did not exist.
//
// THE ANTI-VACUITY ASSERTION IS THE `independentlyFalsifiable` LOOP, and it is the reason this
// file is worth more than a spot check. A checklist is exactly the shape that rots into a gate
// which cannot fail: one item gets hardcoded true during a refactor, or two items end up reading
// the same fact, and the suite stays green because the happy-path test still passes and no test
// ever flipped that one fact alone. The loop flips each of the thirteen facts on its own against
// an otherwise-ready deal and asserts that EXACTLY that item goes outstanding. An item that
// cannot be made to fail is reported by name.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-readiness.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** The shape `evaluatePickupReadiness` selects. One object, mutated per case. */
type DealRow = Record<string, unknown> | null;
let dealRow: DealRow = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => dealRow },
    },
  },
});

const svc = () => import("../pickup-readiness.service");

const CLEARED = new Date("2026-09-20T09:00:00.000Z");
const FUTURE = new Date("2126-01-01T00:00:00.000Z");

/** A deal on which all thirteen items are satisfied. Each case spoils exactly one fact. */
function readyDeal(): Record<string, unknown> {
  return {
    id: "deal_1",
    status: "FUNDING_PENDING",
    vin: "1HGCM82633A004352",
    vehicleYear: 2021,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleHoldUntil: FUTURE,
    dealerExecutedContractId: "cv_1",
    financingCompletedAt: CLEARED,
    fundingClearedAt: CLEARED,
    insuranceStatus: "VERIFIED",
    downPaymentCents: 200000,
    holdReason: null,
    frozenAt: null,
    financing: { downPaymentMethod: "CASHIERS_CHECK" },
    pickup: {
      vehiclePreparedAt: CLEARED,
      dealerReadinessChecklist: { accessoriesPresent: true, deliveryDocumentsReady: true },
      dueBillItems: [],
    },
    tradeInSubmissions: [
      { titleInHand: true, payoffGoodThroughDate: FUTURE, verifiedPayoffCents: 500000 },
    ],
    queueItems: [],
  };
}

test("all THIRTEEN items are produced, with unique keys", async () => {
  const { evaluatePickupReadiness, STAGE_16_ITEM_COUNT } = await svc();
  dealRow = readyDeal();
  const { items } = await evaluatePickupReadiness("deal_1");

  assert.equal(STAGE_16_ITEM_COUNT, 13, "Stage 16 lists thirteen items");
  assert.equal(items.length, 13, `expected 13 items, got ${items.length}: ${items.map((i) => i.key).join(", ")}`);
  assert.equal(new Set(items.map((i) => i.key)).size, 13, "two items share a key");
});

test("a fully ready deal is READY with nothing outstanding", async () => {
  const { evaluatePickupReadiness } = await svc();
  dealRow = readyDeal();
  const r = await evaluatePickupReadiness("deal_1");
  assert.equal(r.ready, true, `outstanding: ${r.outstanding.map((i) => i.key).join(", ")}`);
  assert.deepEqual(r.outstanding, []);
});

// ── the anti-vacuity loop ────────────────────────────────────────────────────────────────
//
// One spoiler per item. If a key here has no spoiler, or a spoiler fails to move its item to
// outstanding, this test names it — which is how a hardcoded-true item gets caught.
const SPOILERS: Record<string, (d: Record<string, unknown>) => void> = {
  VEHICLE_VIN_CONFIRMED:     (d) => { d.vin = null; },
  VEHICLE_AVAILABLE:         (d) => { d.vehicleHoldUntil = new Date("2020-01-01T00:00:00.000Z"); },
  CONTRACT_EXECUTED:         (d) => { d.dealerExecutedContractId = null; },
  FINANCING_COMPLETE:        (d) => { d.financingCompletedAt = null; },
  FUNDING_CLEARED:           (d) => { d.fundingClearedAt = null; },
  DOWN_PAYMENT_ARRANGED:     (d) => { d.financing = { downPaymentMethod: null }; d.downPaymentCents = 200000; },
  INSURANCE_VERIFIED:        (d) => { d.insuranceStatus = "EXTERNAL_UPLOADED"; },
  TRADE_PACKET_READY:        (d) => { (d.tradeInSubmissions as Record<string, unknown>[])[0]!.titleInHand = false; },
  NO_BLOCKING_HOLD:          (d) => { d.queueItems = [{ id: "q1", exceptionCode: "PICKUP_EXCEPTION" }]; },
  VEHICLE_PREPARED:          (d) => { (d.pickup as Record<string, unknown>).vehiclePreparedAt = null; },
  ACCESSORIES_PRESENT:       (d) => { (d.pickup as Record<string, unknown>).dealerReadinessChecklist = { deliveryDocumentsReady: true }; },
  DUE_BILL_DOCUMENTED:       (d) => { (d.pickup as Record<string, unknown>).dueBillItems = null; },
  DELIVERY_DOCUMENTS_READY:  (d) => { (d.pickup as Record<string, unknown>).dealerReadinessChecklist = { accessoriesPresent: true }; },
};

test("every one of the thirteen is independently falsifiable", async () => {
  const { evaluatePickupReadiness } = await svc();
  dealRow = readyDeal();
  const { items } = await evaluatePickupReadiness("deal_1");
  const keys = items.map((i) => i.key);

  const unspoiled = keys.filter((k) => !(k in SPOILERS));
  assert.deepEqual(unspoiled, [], `no spoiler defined for ${unspoiled.join(", ")} — the item is untested`);

  const notFalsifiable: string[] = [];
  const collateral: string[] = [];
  for (const key of keys) {
    const d = readyDeal();
    SPOILERS[key]!(d);
    dealRow = d;
    const r = await evaluatePickupReadiness("deal_1");
    const out = r.outstanding.map((i) => i.key);
    if (!out.includes(key)) notFalsifiable.push(key);
    // FUNDING_CLEARED is the readiness clock: removing it also removes every deadline, but it
    // must not move any OTHER item to outstanding.
    const extra = out.filter((k) => k !== key);
    if (extra.length) collateral.push(`${key} -> also ${extra.join(", ")}`);
    if (out.includes(key)) assert.equal(r.ready, false, `${key} outstanding but ready still true`);
  }

  assert.deepEqual(notFalsifiable, [], `these items could not be made to fail: ${notFalsifiable.join(", ")}`);
  assert.deepEqual(collateral, [], `spoiling one item moved others: ${collateral.join(" | ")}`);
});

// ── the three-state rule, and the two distinctions that are easy to lose ─────────────────

test("no trade at all makes the trade packet NOT APPLICABLE, not outstanding", async () => {
  const { evaluatePickupReadiness } = await svc();
  const d = readyDeal();
  d.tradeInSubmissions = [];
  dealRow = d;
  const r = await evaluatePickupReadiness("deal_1");
  const trade = r.items.find((i) => i.key === "TRADE_PACKET_READY")!;
  assert.equal(trade.notApplicable, true);
  assert.equal(trade.satisfied, true, "not-applicable counts as satisfied for the exit condition");
  assert.equal(r.ready, true, "a deal with no trade is not held on a trade packet");
});

test("a STALE payoff quote is outstanding — Stage 16 asks for payoff status CURRENT", async () => {
  // Reintroduced defect: checking only that payoffGoodThroughDate is non-null. Red — a quote
  // that expired last year would satisfy "title and payoff status current".
  const { evaluatePickupReadiness } = await svc();
  const d = readyDeal();
  (d.tradeInSubmissions as Record<string, unknown>[])[0]!.payoffGoodThroughDate = new Date("2020-01-01T00:00:00.000Z");
  dealRow = d;
  const r = await evaluatePickupReadiness("deal_1");
  assert.equal(r.outstanding.map((i) => i.key).includes("TRADE_PACKET_READY"), true);
});

test("an EMPTY due-bill list is documented; a null one is not", async () => {
  // The distinction the spec's word "documented" carries: an empty list is an answer, silence
  // is not. Reintroduced defect: a truthiness check — `[]` is falsy in neither JS nor Prisma,
  // but `.length` would be, and that mistake would hold every deal with no due-bill items.
  const { evaluatePickupReadiness } = await svc();
  const empty = readyDeal();
  (empty.pickup as Record<string, unknown>).dueBillItems = [];
  dealRow = empty;
  assert.equal((await evaluatePickupReadiness("deal_1")).ready, true, "an empty due-bill list is documented");

  const silent = readyDeal();
  (silent.pickup as Record<string, unknown>).dueBillItems = null;
  dealRow = silent;
  const r = await evaluatePickupReadiness("deal_1");
  assert.equal(r.outstanding.map((i) => i.key).includes("DUE_BILL_DOCUMENTED"), true);
});

test("an upload is NOT approval — EXTERNAL_UPLOADED does not satisfy insurance", async () => {
  // §13-D31. Reintroduced defect: including EXTERNAL_UPLOADED in the satisfied set, which is
  // the exact regression Phase 8 corrected.
  const { evaluatePickupReadiness } = await svc();
  const d = readyDeal();
  d.insuranceStatus = "EXTERNAL_UPLOADED";
  dealRow = d;
  const r = await evaluatePickupReadiness("deal_1");
  assert.equal(r.outstanding.map((i) => i.key).includes("INSURANCE_VERIFIED"), true);
});

// ── owner, action and deadline: Stage 16's four attributes for every unmet item ──────────

test("every outstanding item names an owner, a required action and a buyer-visible status", async () => {
  const { evaluatePickupReadiness } = await svc();
  const d = readyDeal();
  d.vin = null;
  d.dealerExecutedContractId = null;
  d.insuranceStatus = "EXTERNAL_UPLOADED";
  dealRow = d;
  const r = await evaluatePickupReadiness("deal_1");

  assert.ok(r.outstanding.length >= 3, "fixture should leave at least three items outstanding");
  for (const item of r.outstanding) {
    assert.ok(["FINANCE", "DEALERSHIP", "BUYER", "OPERATIONS"].includes(item.owner), `${item.key} has no valid owner`);
    assert.ok(item.requiredAction.length > 0, `${item.key} has no required action`);
    assert.ok(item.detail.length > 0, `${item.key} has no buyer-visible status`);
    assert.ok(item.deadlineAt instanceof Date, `${item.key} has no deadline`);
  }
});

test("the deadline is anchored to funding clearance, not to now", async () => {
  // Reintroduced defect: `deadlineFor` anchored to `new Date()`. Red — the deadline would move
  // forward on every evaluation, which is a deadline that can never pass.
  const { evaluatePickupReadiness } = await svc();
  const d = readyDeal();
  d.dealerExecutedContractId = null;
  dealRow = d;
  const r = await evaluatePickupReadiness("deal_1");
  const item = r.outstanding.find((i) => i.key === "CONTRACT_EXECUTED")!;
  // DEALERSHIP SLA is 48h from funding clearance.
  assert.equal(item.deadlineAt!.toISOString(), new Date(CLEARED.getTime() + 48 * 3600000).toISOString());
});

test("no funding clearance means the readiness clock has not started — no deadline", async () => {
  const { evaluatePickupReadiness } = await svc();
  const d = readyDeal();
  d.fundingClearedAt = null;
  dealRow = d;
  const r = await evaluatePickupReadiness("deal_1");
  const item = r.outstanding.find((i) => i.key === "FUNDING_CLEARED")!;
  assert.equal(item.deadlineAt, null, "a clock that has not started has no deadline");
});

test("a satisfied item carries no deadline", async () => {
  const { evaluatePickupReadiness } = await svc();
  dealRow = readyDeal();
  const r = await evaluatePickupReadiness("deal_1");
  assert.deepEqual(r.items.filter((i) => i.deadlineAt !== null).map((i) => i.key), []);
});

// ── fail closed ─────────────────────────────────────────────────────────────────────────

test("an unreadable deal is NOT ready — it fails closed and loudly", async () => {
  // Reintroduced defect: returning `{ items: [], outstanding: [], ready: true }`. Red — an
  // empty checklist would read as "all thirteen satisfied" and schedule a handover on a deal
  // nobody could load.
  const { evaluatePickupReadiness } = await svc();
  dealRow = null;
  const r = await evaluatePickupReadiness("missing");
  assert.equal(r.ready, false);
  assert.equal(r.outstanding.length, 1);
  assert.equal(r.outstanding[0]!.owner, "OPERATIONS");
});
