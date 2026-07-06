// Unit tests for the deposit transition matrix (lib/payments/deposit-state.ts).
//
// Run with: npx tsx --test lib/payments/__tests__/deposit-state.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionDeposit,
  isTerminalDepositStatus,
  allowedPredecessors,
} from "../deposit-state";

test("permitted edges", () => {
  assert.ok(canTransitionDeposit("PENDING", "PAID"));
  assert.ok(canTransitionDeposit("PENDING", "FAILED"));
  assert.ok(canTransitionDeposit("PAID", "REFUNDED"));
});

test("disallowed / out-of-order edges fail closed", () => {
  assert.ok(!canTransitionDeposit("REFUNDED", "PAID"), "settled refund cannot revert to paid");
  assert.ok(!canTransitionDeposit("PAID", "FAILED"), "paid cannot downgrade to failed");
  assert.ok(!canTransitionDeposit("FAILED", "PAID"));
  assert.ok(!canTransitionDeposit("PENDING", "REFUNDED"), "cannot refund a never-paid deposit");
});

test("same-state is an idempotent no-op (allowed)", () => {
  for (const s of ["PENDING", "PAID", "FAILED", "REFUNDED"] as const) {
    assert.ok(canTransitionDeposit(s, s));
  }
});

test("terminal states", () => {
  assert.ok(isTerminalDepositStatus("FAILED"));
  assert.ok(isTerminalDepositStatus("REFUNDED"));
  assert.ok(!isTerminalDepositStatus("PENDING"));
  assert.ok(!isTerminalDepositStatus("PAID"));
});

test("allowedPredecessors backs the updateMany WHERE clause", () => {
  assert.deepEqual(allowedPredecessors("PAID"), ["PENDING"]);
  assert.deepEqual(allowedPredecessors("FAILED"), ["PENDING"]);
  assert.deepEqual(allowedPredecessors("REFUNDED"), ["PAID"]);
});
