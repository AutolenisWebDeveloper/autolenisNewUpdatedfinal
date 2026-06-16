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
  assert.equal(canTransition("FEE_PAID", "INSURANCE_PENDING"), true);
  assert.equal(canTransition("INSURANCE_PENDING", "CONTRACT_PENDING"), true);
  assert.equal(canTransition("CONTRACT_PENDING", "CONTRACT_REVIEW"), true);
  assert.equal(canTransition("CONTRACT_REVIEW", "CONTRACT_APPROVED"), true);
  assert.equal(canTransition("CONTRACT_APPROVED", "SIGNING_PENDING"), true);
  assert.equal(canTransition("SIGNING_PENDING", "SIGNED"), true);
  assert.equal(canTransition("SIGNED", "PICKUP_SCHEDULED"), true);
  assert.equal(canTransition("PICKUP_SCHEDULED", "PICKUP_COMPLETE"), true);
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

test("a scheduled pickup may be completed directly or via PICKUP_COMPLETE", () => {
  assert.equal(canTransition("PICKUP_SCHEDULED", "COMPLETED"), true);
  assert.equal(canTransition("PICKUP_SCHEDULED", "PICKUP_COMPLETE"), true);
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
  assert.deepEqual(
    [...INSURANCE_SATISFIED].sort(),
    [InsuranceStatus.EXTERNAL_UPLOADED, InsuranceStatus.POLICY_BOUND, InsuranceStatus.VERIFIED].sort(),
  );
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.NOT_STARTED), false);
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.FAILED), false);
  assert.equal(INSURANCE_SATISFIED.includes(InsuranceStatus.QUOTE_REQUESTED), false);
});
