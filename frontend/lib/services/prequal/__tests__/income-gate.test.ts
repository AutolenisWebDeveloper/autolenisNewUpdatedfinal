// Unit tests for the institutional-grade income gate.
// Run with:  npx tsx --test lib/services/prequal/__tests__/income-gate.test.ts
//
// Covers the two-DTI model (front-end auto-only 20% vs back-end total 45%),
// the tier-based benchmark APR, and the three verification scenarios from the
// upgrade spec.

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeIncomeGate,
  getPaymentFactor,
  getBenchmarkApr,
  BENCHMARK_APR_BY_TIER,
  FRONT_END_AUTO_DTI,
  BACK_END_TOTAL_DTI,
} from "../income-gate";

const D = (dollars: number) => Math.round(dollars * 100); // dollars → cents

// ─── Benchmark APR / payment factor ─────────────────────────────────────────

test("BENCHMARK_APR_BY_TIER uses the documented rate ladder", () => {
  assert.equal(BENCHMARK_APR_BY_TIER.STRONG, 0.065);
  assert.equal(BENCHMARK_APR_BY_TIER.GOOD, 0.085);
  assert.equal(BENCHMARK_APR_BY_TIER.FAIR, 0.115);
  assert.equal(BENCHMARK_APR_BY_TIER.WEAK, 0.165);
  assert.equal(BENCHMARK_APR_BY_TIER.UNKNOWN, 0.105);
});

test("getBenchmarkApr defaults to UNKNOWN for null/undefined", () => {
  assert.equal(getBenchmarkApr(null), 0.105);
  assert.equal(getBenchmarkApr(undefined), 0.105);
  assert.equal(getBenchmarkApr("STRONG"), 0.065);
});

test("getPaymentFactor: lower APR yields a lower payment factor", () => {
  const strong = getPaymentFactor(0.065, 72);
  const weak = getPaymentFactor(0.165, 72);
  assert.ok(strong > 0 && weak > 0);
  assert.ok(weak > strong, "deep-subprime APR must cost more per $ financed");
});

test("getPaymentFactor: same payment buys more at a stronger tier", () => {
  const monthly = 1000;
  const strongLoan = monthly / getPaymentFactor(0.065, 72);
  const weakLoan = monthly / getPaymentFactor(0.165, 72);
  assert.ok(
    strongLoan > weakLoan + 5000,
    "strong tier buying power should dwarf weak tier for the same payment",
  );
});

test("getPaymentFactor handles 0% APR without NaN", () => {
  assert.equal(getPaymentFactor(0, 72), 1 / 72);
});

// ─── Verification case 1 — high income, low debt ────────────────────────────

test("case 1: high income / low debt → front-end binding, capped at platform max", () => {
  const r = computeIncomeGate({
    monthlyIncomeCents: D(8000),
    employmentStatus: "Full-time Employed",
    lengthOfEmployment: "5+ years",
    statedBudgetCents: null,
    monthlyHousingPaymentCents: D(1200),
    monthlyOtherDebtCents: 0,
    benchmarkTier: "STRONG",
  });

  assert.equal(r.belowMinimum, false);
  assert.equal(r.stabilityFactor, 1.0);
  // Front-end (20% of $8000 = $1600) is more conservative than back-end
  // ($8000×45% - $1200 = $2400) → max auto payment = $1600.
  assert.equal(r.estimatedMonthlyPayment, D(1600));
  assert.equal(r.frontEndDtiBps, 2000); // 1600 / 8000
  assert.equal(r.backEndDtiBps, 3500); // (1600 + 1200) / 8000
  // Strong tier buying power exceeds the $85,000 platform cap.
  assert.equal(r.incomeBasedMaxCents, 8_500_000);
  assert.equal(r.totalMonthlyObligationsCents, D(1200));
});

// ─── Verification case 2 — moderate income, high debt ───────────────────────

test("case 2: moderate income / high debt → negative back-end room → declined", () => {
  const r = computeIncomeGate({
    monthlyIncomeCents: D(6000),
    employmentStatus: "Full-time Employed",
    lengthOfEmployment: "3–5 years",
    statedBudgetCents: null,
    monthlyHousingPaymentCents: D(2000),
    monthlyOtherDebtCents: D(800),
    benchmarkTier: "UNKNOWN",
  });

  // Back-end room: $6000×45% - $2000 - $800 = -$100/mo → below minimum.
  assert.equal(r.belowMinimum, true);
  assert.equal(r.estimatedMonthlyPayment, 0);
});

// ─── Verification case 3 — moderate income, moderate debt ───────────────────

test("case 3: moderate income / moderate debt → back-end binding at 45%", () => {
  const r = computeIncomeGate({
    monthlyIncomeCents: D(5000),
    employmentStatus: "Full-time Employed",
    lengthOfEmployment: "5+ years",
    statedBudgetCents: null,
    monthlyHousingPaymentCents: D(1500),
    monthlyOtherDebtCents: D(300),
    benchmarkTier: "GOOD",
  });

  assert.equal(r.belowMinimum, false);
  // Back-end: $5000×45% - $1500 - $300 = $450/mo (binding, < front-end $1000).
  assert.equal(r.estimatedMonthlyPayment, D(450));
  assert.equal(r.frontEndDtiBps, 900); // 450 / 5000
  assert.equal(r.backEndDtiBps, 4500); // (450 + 1800) / 5000 → exactly the 45% cap
  assert.equal(r.benchmarkAprBps, 850); // GOOD tier 8.5%
  // Good tier, 8.5% / 72mo on $450/mo lands in the high-$20k range.
  assert.ok(
    r.incomeBasedMaxCents > 2_300_000 && r.incomeBasedMaxCents < 2_800_000,
    `expected ~$25k, got ${r.incomeBasedMaxCents}`,
  );
});

// ─── Two-DTI minimum + tier re-pricing ──────────────────────────────────────

test("the more conservative of the two DTI limits always wins", () => {
  // Identical income/debt; only the binding constraint differs.
  const frontBinding = computeIncomeGate({
    monthlyIncomeCents: D(10000),
    employmentStatus: "Full-time Employed",
    lengthOfEmployment: "5+ years",
    statedBudgetCents: null,
    monthlyHousingPaymentCents: 0,
    monthlyOtherDebtCents: 0,
    benchmarkTier: "STRONG",
  });
  // No existing debt → front-end (20%) is the binding limit, not back-end (45%).
  assert.equal(frontBinding.estimatedMonthlyPayment, D(2000));
  assert.equal(frontBinding.frontEndDtiBps, 2000);
});

test("same buyer, stronger tier → larger income-based max", () => {
  const base = {
    monthlyIncomeCents: D(4000),
    employmentStatus: "Full-time Employed",
    lengthOfEmployment: "5+ years",
    statedBudgetCents: null,
    monthlyHousingPaymentCents: D(900),
    monthlyOtherDebtCents: D(100),
  } as const;
  const strong = computeIncomeGate({ ...base, benchmarkTier: "STRONG" });
  const weak = computeIncomeGate({ ...base, benchmarkTier: "WEAK" });
  assert.equal(strong.estimatedMonthlyPayment, weak.estimatedMonthlyPayment);
  assert.ok(
    strong.incomeBasedMaxCents > weak.incomeBasedMaxCents,
    "stronger tier (lower APR) must yield more buying power for the same payment",
  );
});

test("unemployed → no income → below minimum", () => {
  const r = computeIncomeGate({
    monthlyIncomeCents: D(5000),
    employmentStatus: "Unemployed",
    lengthOfEmployment: null,
    statedBudgetCents: null,
    monthlyHousingPaymentCents: D(500),
    monthlyOtherDebtCents: 0,
  });
  assert.equal(r.stabilityFactor, 0);
  assert.equal(r.belowMinimum, true);
});

test("constants match the spec", () => {
  assert.equal(FRONT_END_AUTO_DTI, 0.2);
  assert.equal(BACK_END_TOTAL_DTI, 0.45);
});

// ─── Storage-field coverage — all persisted/transparency fields present ─────

test("result exposes effectiveIncomeCents + DTI/APR storage fields with correct types/values", () => {
  const r = computeIncomeGate({
    monthlyIncomeCents: D(5000),
    employmentStatus: "Full-time Employed",
    lengthOfEmployment: "5+ years", // stability 1.0
    statedBudgetCents: null,
    monthlyHousingPaymentCents: D(1500),
    monthlyOtherDebtCents: D(300),
    benchmarkTier: "GOOD",
  });

  // All five storage/transparency fields must be present and numeric.
  for (const field of [
    "effectiveIncomeCents",
    "frontEndDtiBps",
    "backEndDtiBps",
    "benchmarkAprBps",
    "totalMonthlyObligationsCents",
  ] as const) {
    assert.ok(field in r, `${field} must be present on IncomeGateResult`);
    assert.equal(typeof r[field], "number", `${field} must be a number`);
  }

  // Concrete values for this scenario.
  assert.equal(r.effectiveIncomeCents, D(5000)); // $5000 × stability 1.0
  assert.equal(r.totalMonthlyObligationsCents, D(1800)); // $1500 housing + $300 debt
  assert.equal(r.frontEndDtiBps, 900); // $450 auto ÷ $5000
  assert.equal(r.backEndDtiBps, 4500); // ($450 + $1800) ÷ $5000 → 45% cap
  assert.equal(r.benchmarkAprBps, 850); // GOOD tier 8.5% (Pass 2 APR)
});

test("effectiveIncomeCents reflects the stability haircut (part-time = 60%)", () => {
  const r = computeIncomeGate({
    monthlyIncomeCents: D(5000),
    employmentStatus: "Part-time Employed",
    lengthOfEmployment: null,
    statedBudgetCents: null,
    monthlyHousingPaymentCents: 0,
    monthlyOtherDebtCents: 0,
    benchmarkTier: "UNKNOWN",
  });
  assert.equal(r.stabilityFactor, 0.6);
  assert.equal(r.effectiveIncomeCents, D(3000)); // $5000 × 0.60
});
