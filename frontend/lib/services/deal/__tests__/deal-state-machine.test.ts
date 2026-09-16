// Unit tests for the deal lifecycle state machine guard.
// Run with:  npx tsx --test lib/services/deal/__tests__/deal-state-machine.test.ts
//
// These prove the transition guard rejects the integrity bypasses found in the
// Phase 2 gap analysis (Contract Shield gate, arbitrary lifecycle jumps) and that
// the insurance "satisfied" set matches the final-release gate.

import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, INSURANCE_SATISFIED } from "../deal.service";
import { DealStatus, InsuranceStatus } from "@prisma/client";

test("happy-path forward transitions are legal", () => {
  assert.equal(canTransition("PENDING", "ACTIVE"), true);
  assert.equal(canTransition("ACTIVE", "FINANCING_PENDING"), true);
  assert.equal(canTransition("FINANCING_PENDING", "FEE_PENDING"), true);
  assert.equal(canTransition("FEE_PENDING", "FEE_PAID"), true);
  // PHASE 8 (§13-D28). The live path is FEE_PAID -> CONTRACT_PENDING: insurance is a
  // parallel track requested AT the contract request, never a gate on contract preparation
  // ("Insurance never blocks contract preparation; it blocks the vehicle leaving the lot").
  assert.equal(canTransition("FEE_PAID", "CONTRACT_PENDING"), true);
  // The legacy edges are RETAINED so deals parked at INSURANCE_PENDING before Phase 8 are
  // not stranded behind an edge that vanished.
  assert.equal(canTransition("FEE_PAID", "INSURANCE_PENDING"), true);
  assert.equal(canTransition("INSURANCE_PENDING", "CONTRACT_PENDING"), true);
  assert.equal(canTransition("CONTRACT_PENDING", "CONTRACT_REVIEW"), true);
  assert.equal(canTransition("CONTRACT_REVIEW", "CONTRACT_APPROVED"), true);
  assert.equal(canTransition("CONTRACT_APPROVED", "SIGNING_PENDING"), true);
  assert.equal(canTransition("SIGNING_PENDING", "SIGNED"), true);
  // PHASE 8 (§13-D29). The buyer's signature no longer reaches pickup. "The transaction is
  // not contract-executed merely because the buyer signed" — DEALER_EXECUTED is now a
  // required predecessor, and this is the structural half of the no-spot-delivery rule.
  assert.equal(canTransition("SIGNED", "DEALER_EXECUTED"), true);
  assert.equal(canTransition("DEALER_EXECUTED", "FUNDING_PENDING"), true);
  // PHASE 9 (§8.2 defect 8). The release ladder gained two rungs. Readiness is §Stage 16's
  // thirteen-item evaluation; HANDOVER_PENDING is the dealer's release, which §Stage 19 makes a
  // required predecessor of completion: "the Deal never completes automatically on the dealer's
  // word alone."
  assert.equal(canTransition("FUNDING_PENDING", "PICKUP_READINESS"), true);
  assert.equal(canTransition("PICKUP_READINESS", "PICKUP_SCHEDULED"), true);
  assert.equal(canTransition("PICKUP_SCHEDULED", "HANDOVER_PENDING"), true);
  assert.equal(canTransition("HANDOVER_PENDING", "COMPLETED"), true);
  // RETAINED AND UNREACHABLE. §28.1 L1405 retires PICKUP_COMPLETE to a supporting-record fact.
  // Its exit stays open so a historical row is not stranded; nothing can enter it.
  assert.equal(canTransition("PICKUP_COMPLETE", "COMPLETED"), true);
});

test("Contract Shield gate: SIGNING_PENDING only reachable from CONTRACT_APPROVED", () => {
  assert.equal(canTransition("CONTRACT_APPROVED", "SIGNING_PENDING"), true);
  // Any other source must be rejected — this is the bypass the gap analysis flagged.
  for (const from of [
    "FINANCING_PENDING", "FEE_PAID", "INSURANCE_PENDING",
    "CONTRACT_PENDING", "CONTRACT_REVIEW",
  ] as DealStatus[]) {
    assert.equal(canTransition(from, "SIGNING_PENDING"), false, `${from} → SIGNING_PENDING must be illegal`);
  }
});

test("arbitrary forward jumps are rejected", () => {
  assert.equal(canTransition("FINANCING_PENDING", "COMPLETED"), false);
  assert.equal(canTransition("ACTIVE", "SIGNED"), false);
  assert.equal(canTransition("SIGNED", "COMPLETED"), false); // must pass through pickup
  assert.equal(canTransition("FEE_PENDING", "INSURANCE_PENDING"), false); // must pass FEE_PAID
});

test("a scheduled pickup can NOT be completed directly — handover is required", () => {
  // THIS TEST USED TO ASSERT THE DEFECT. It read "a scheduled pickup may be completed directly
  // or via PICKUP_COMPLETE" and passed, which is how §8.2 defect (8) survived: the direct edge
  // was not an oversight in the map, it was pinned by a test that described it as intended.
  //
  // §Stage 19: "A dealer release with no buyer confirmation reminds the buyer — the Deal never
  // completes automatically on the dealer's word alone." Both direct routes are closed.
  assert.equal(canTransition("PICKUP_SCHEDULED", "COMPLETED"), false);
  // Closed for the reason Phase 7 established: an edge with no domain caller is NOT unreachable
  // while DEAL_STAGE_ADVANCED resolves its target at runtime. Left open this was a two-hop path
  // from a scheduled pickup to COMPLETED that skipped handover entirely.
  assert.equal(canTransition("PICKUP_SCHEDULED", "PICKUP_COMPLETE"), false);
  // And nothing may enter the retired state at all.
  for (const from of [
    "FUNDING_PENDING", "PICKUP_READINESS", "HANDOVER_PENDING", "SIGNED", "DEALER_EXECUTED",
  ] as DealStatus[]) {
    assert.equal(canTransition(from, "PICKUP_COMPLETE"), false, `${from} → PICKUP_COMPLETE must be illegal`);
  }
});

test("completion is reachable ONLY from HANDOVER_PENDING (and the retired legacy state)", () => {
  // The inverse of the ladder assertion, stated as an exhaustive sweep so a future edge added
  // to COMPLETED from anywhere else fails here rather than being noticed in production.
  const legal: DealStatus[] = ["HANDOVER_PENDING", "PICKUP_COMPLETE"];
  const all: DealStatus[] = [
    "PENDING", "ACTIVE", "FINANCING_PENDING", "FEE_PENDING", "FEE_PAID", "INSURANCE_PENDING",
    "CONTRACT_PENDING", "CONTRACT_REVIEW", "CONTRACT_APPROVED", "SIGNING_PENDING", "SIGNED",
    "DEALER_CONFIRMATION", "RECAP_PENDING", "DEALER_EXECUTED", "FUNDING_PENDING",
    "PICKUP_READINESS", "PICKUP_SCHEDULED", "HANDOVER_PENDING", "PICKUP_COMPLETE",
    "FROZEN_PENDING_RELEASE", "COMPLETED", "CANCELLED", "REFUNDED",
  ];
  for (const from of all) {
    assert.equal(
      canTransition(from, "COMPLETED"),
      legal.includes(from),
      `${from} → COMPLETED should be ${legal.includes(from)}`,
    );
  }
});

test("cancellation is reachable from any non-terminal state, never from terminal", () => {
  for (const from of [
    "PENDING", "ACTIVE", "FINANCING_PENDING", "CONTRACT_APPROVED", "SIGNED", "PICKUP_SCHEDULED",
  ] as DealStatus[]) {
    assert.equal(canTransition(from, "CANCELLED"), true, `${from} → CANCELLED should be allowed`);
  }
  assert.equal(canTransition("COMPLETED", "CANCELLED"), false);
  assert.equal(canTransition("CANCELLED", "CANCELLED"), false);
  assert.equal(canTransition("REFUNDED", "CANCELLED"), false);
});

test("refund is reachable from CANCELLED and from non-terminal states", () => {
  assert.equal(canTransition("CANCELLED", "REFUNDED"), true);
  assert.equal(canTransition("FEE_PAID", "REFUNDED"), true);
  assert.equal(canTransition("COMPLETED", "REFUNDED"), false);
});

test("same-state transitions are not 'transitions'", () => {
  assert.equal(canTransition("ACTIVE", "ACTIVE"), false);
  assert.equal(canTransition("COMPLETED", "COMPLETED"), false);
});

test("insurance satisfied set matches the final-release gate (and excludes NOT_STARTED/FAILED)", () => {
  // PHASE 8 (§13-D31). EXTERNAL_UPLOADED LEFT this set. Stage 15: "An upload is not
  // approval ... Only VERIFIED or POLICY_BOUND permits release."
  assert.deepEqual(
    [...INSURANCE_SATISFIED].sort(),
    [InsuranceStatus.POLICY_BOUND, InsuranceStatus.VERIFIED].sort(),
  );
  assert.equal(
    INSURANCE_SATISFIED.includes(InsuranceStatus.EXTERNAL_UPLOADED),
    false,
    "an upload must not satisfy the release gate — §13-D31",
  );
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.NOT_STARTED), false);
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.FAILED), false);
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.QUOTE_REQUESTED), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8 — Stages 13 to 15
// ─────────────────────────────────────────────────────────────────────────────

test("§13-D29: SIGNED -> PICKUP_SCHEDULED is CLOSED — the buyer's signature is not execution", () => {
  // THE DEFECT: this edge was open, and pickup scheduling reached it with `force: true`.
  // A buyer could sign, schedule a pickup and take delivery of a vehicle the dealership
  // had never countersigned. §14d: "Release remains blocked until the dealership's fully
  // executed copy is stored."
  assert.equal(canTransition("SIGNED", "PICKUP_SCHEDULED"), false);
  assert.equal(canTransition("SIGNED", "PICKUP_READINESS"), false);
  assert.equal(canTransition("SIGNED", "COMPLETED"), false);
});

test("§13-D29: DEALER_EXECUTED is the ONLY exit from SIGNED", () => {
  const reachable = (["DEALER_EXECUTED", "FUNDING_PENDING", "PICKUP_SCHEDULED", "PICKUP_READINESS",
    "CONTRACT_APPROVED", "COMPLETED"] as DealStatus[]).filter((to) => canTransition("SIGNED", to));
  assert.deepEqual(reachable, ["DEALER_EXECUTED"]);
});

test("Stage 14: FUNDING_PENDING is reached only from DEALER_EXECUTED", () => {
  assert.equal(canTransition("DEALER_EXECUTED", "FUNDING_PENDING"), true);
  for (const from of ["SIGNED", "SIGNING_PENDING", "CONTRACT_APPROVED", "CONTRACT_REVIEW"] as DealStatus[]) {
    assert.equal(canTransition(from, "FUNDING_PENDING"), false, `${from} -> FUNDING_PENDING must be illegal`);
  }
});

test("Stage 14 send-back: FUNDING_PENDING returns to RECAP_PENDING, and to nothing else forward", () => {
  // "A financing change ... sends the transaction back through recap confirmation, contract
  // generation, Contract Shield, AND signatures." RECAP_PENDING is the head of that path.
  assert.equal(canTransition("FUNDING_PENDING", "RECAP_PENDING"), true);
  // PHASE 9 OPENED READINESS, together with the checklist that guards it — which is the
  // condition Phase 8 set for opening it at all.
  assert.equal(canTransition("FUNDING_PENDING", "PICKUP_READINESS"), true);
  // AND CLOSED THE DIRECT ROUTE TO SCHEDULING. §Stage 16: "Nothing is scheduled while any item
  // is unmet." A second edge that reached scheduling without evaluating the thirteen would be
  // that rule with a hole in it. The capability MOVED one rung, it was not removed.
  assert.equal(canTransition("FUNDING_PENDING", "PICKUP_SCHEDULED"), false);
  assert.equal(canTransition("FUNDING_PENDING", "COMPLETED"), false);
});

test("the full return path after a send-back is legal end to end", () => {
  // Proves the send-back is not a dead end: from RECAP_PENDING the existing edges carry the
  // deal all the way back to a fresh contract request.
  const path: DealStatus[] = ["RECAP_PENDING", "FINANCING_PENDING", "FEE_PENDING", "FEE_PAID", "CONTRACT_PENDING"];
  for (let i = 0; i < path.length - 1; i += 1) {
    assert.equal(canTransition(path[i], path[i + 1]), true, `${path[i]} -> ${path[i + 1]} must be legal`);
  }
});

test("§13-D28: insurance never gates contract entry, and the legacy edge survives for parked deals", () => {
  assert.equal(canTransition("FEE_PAID", "CONTRACT_PENDING"), true, "the live path skips INSURANCE_PENDING");
  assert.equal(canTransition("INSURANCE_PENDING", "CONTRACT_PENDING"), true, "deals parked before Phase 8 must still be able to leave");
});

test("§13-D31: the three insurance sets are disjoint and complete about what blocks release", async () => {
  const { INSURANCE_AWAITING_REVIEW, INSURANCE_BLOCKED } = await import("../deal.service");
  // An upload is awaiting review, never satisfied — the whole of §13-D31 in one assertion.
  assert.equal(INSURANCE_AWAITING_REVIEW.includes(InsuranceStatus.EXTERNAL_UPLOADED), true);
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.EXTERNAL_UPLOADED), false);
  // A state cannot be both satisfied and blocked, which is the mistake that would let a
  // rejected policy pass the gate.
  for (const blocked of INSURANCE_BLOCKED) {
    assert.equal(INSURANCE_SATISFIED.includes(blocked), false, `${blocked} must never satisfy release`);
  }
  for (const awaiting of INSURANCE_AWAITING_REVIEW) {
    assert.equal(INSURANCE_SATISFIED.includes(awaiting), false, `${awaiting} must never satisfy release`);
  }
});
