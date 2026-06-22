// F-004 — commission amount must be a percentage of the ACTUAL fee paid, not a
// hardcoded $499 constant.
// Run with:  npx tsx --test lib/services/affiliate/__tests__/commission-basis.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { computeCommissionCents } from "../commission-math";

// Mirror the configured rates locally so the test has no server-only import
// chain (commission.service pulls in the payment/event spine). The production
// values live in lib/constants COMMISSION_RATES.
const COMMISSION_RATES = { LEVEL_1: 0.15, LEVEL_2: 0.03, LEVEL_3: 0.03 } as const;

test("commission is the rate applied to the actual fee basis", () => {
  // $499 fee, L1 rate
  assert.equal(
    computeCommissionCents(49900, COMMISSION_RATES.LEVEL_1),
    Math.round(49900 * COMMISSION_RATES.LEVEL_1),
  );
});

test("a different actual fee yields a different commission (the whole point of F-004)", () => {
  const standard = computeCommissionCents(49900, COMMISSION_RATES.LEVEL_1);
  const discounted = computeCommissionCents(29900, COMMISSION_RATES.LEVEL_1);
  const premium = computeCommissionCents(79900, COMMISSION_RATES.LEVEL_1);
  assert.notEqual(discounted, standard);
  assert.notEqual(premium, standard);
  assert.ok(discounted < standard && standard < premium);
});

test("rounds to whole cents", () => {
  // pick a basis/rate that doesn't divide evenly
  const v = computeCommissionCents(12345, 0.15);
  assert.equal(v, Math.round(12345 * 0.15));
  assert.equal(Number.isInteger(v), true);
});

test("zero / invalid basis yields zero (never NaN, never negative)", () => {
  assert.equal(computeCommissionCents(0, COMMISSION_RATES.LEVEL_1), 0);
  assert.equal(computeCommissionCents(-100, COMMISSION_RATES.LEVEL_1), 0);
  assert.equal(computeCommissionCents(Number.NaN, COMMISSION_RATES.LEVEL_1), 0);
});

test("level rates differ (L1 > L2/L3 share of the same basis)", () => {
  const basis = 49900;
  const l1 = computeCommissionCents(basis, COMMISSION_RATES.LEVEL_1);
  const l2 = computeCommissionCents(basis, COMMISSION_RATES.LEVEL_2);
  assert.ok(l1 >= l2);
});
