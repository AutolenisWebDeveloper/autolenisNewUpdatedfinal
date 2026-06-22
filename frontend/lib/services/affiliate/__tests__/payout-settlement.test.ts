// F-002/F-003 — the consolidated payout rail settlement contract.
// Run with:  npx tsx --test lib/services/affiliate/__tests__/payout-settlement.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isCommissionSettled } from "../payout-invariants";

test("a commission is settled only with PAID + paidAt + a linked payout", () => {
  assert.equal(
    isCommissionSettled({ status: "PAID", paidAt: new Date(), payoutId: "payout_1" }),
    true,
  );
});

test("the old corrupt state (paidAt stamped but status APPROVED, no payout) is NOT settled", () => {
  // This is exactly what the disabled self-serve requestPayout rail produced.
  assert.equal(
    isCommissionSettled({ status: "APPROVED", paidAt: new Date(), payoutId: null }),
    false,
  );
});

test("PAID without a linked payout is NOT considered settled", () => {
  assert.equal(
    isCommissionSettled({ status: "PAID", paidAt: new Date(), payoutId: null }),
    false,
  );
});

test("PAID with a payout link but no paidAt is NOT settled", () => {
  assert.equal(
    isCommissionSettled({ status: "PAID", paidAt: null, payoutId: "payout_1" }),
    false,
  );
});

test("PENDING / APPROVED commissions are never settled", () => {
  assert.equal(isCommissionSettled({ status: "PENDING", paidAt: null, payoutId: null }), false);
  assert.equal(isCommissionSettled({ status: "APPROVED", paidAt: null, payoutId: null }), false);
});
