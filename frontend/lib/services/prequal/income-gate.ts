// lib/services/prequal/income-gate.ts
//
// Income-based auto loan capacity calculator.
// Mirrors underwriting logic used by:
//   - Capital One Auto Finance
//   - Chase Auto
//   - Bank of America Auto Finance
//   - Credit union auto loan departments
//   - Dealer F&I departments (Dealertrack / RouteOne)
//
// This gate runs BEFORE the MicroBilt call.
// The output (requestedAmtCents) becomes the RequestedAmt sent to iPredict.
// MicroBilt may approve less — final budget = min(income gate, credit gate).

export interface IncomeGateInput {
  monthlyIncomeCents:  number;
  employmentStatus:    string | null;
  lengthOfEmployment:  string | null;
  statedBudgetCents:   number | null;
}

export interface IncomeGateResult {
  requestedAmtCents:       number;   // send to MicroBilt as RequestedAmt
  incomeBasedMaxCents:     number;   // income ceiling before credit check
  stabilityFactor:         number;   // employment stability multiplier (0–1.0)
  estimatedMonthlyPayment: number;   // at benchmark rate — shown to buyer
  belowMinimum:            boolean;  // income too low for any viable auto loan
}

// ─── Industry constants ────────────────────────────────────────────────────────

// Front-end auto loan DTI (payment as % of gross monthly income)
// Source: CFPB, NADA, credit union NCUA guidelines
//   Standard prime lenders:  10–15%
//   Alternative/iPredict:    up to 20% (non-prime applicants)
// We use 20% because iPredict is designed for non-prime consumers.
// iPredict will constrain further based on actual credit profile.
const FRONT_END_DTI = 0.20;

// Benchmark loan parameters for income gate calculation
// 72 months (most common term for vehicles $25k+)
// 7.0% APR (conservative benchmark — actual rate set by lender after approval)
const BENCHMARK_APR_ANNUAL  = 0.07;
const BENCHMARK_TERM_MONTHS = 72;

// Payment factor = r × (1+r)^n / ((1+r)^n - 1)
// At 7% APR / 72 months = 0.015222
// Meaning: to finance $1,000, the monthly payment is $15.22
// This formula is identical to what banks use in their loan calculators.
const PAYMENT_FACTOR = (() => {
  const r = BENCHMARK_APR_ANNUAL / 12;
  return (r * Math.pow(1 + r, BENCHMARK_TERM_MONTHS)) /
         (Math.pow(1 + r, BENCHMARK_TERM_MONTHS) - 1);
})();

// Platform bounds
const PLATFORM_MAX_CENTS = 8_500_000; // $85,000 hard cap
const PLATFORM_MIN_CENTS =   800_000; // $8,000 — below this, auto loan not viable

// ─── Employment stability factor ──────────────────────────────────────────────
// Banks apply income haircuts for employment instability.
// A self-employed buyer reporting $10,000/month gets treated as $7,500
// because income may be variable (25% haircut is standard).
// Source: NADA dealer F&I guidelines, credit union underwriting standards.

function getStabilityFactor(status: string | null, length: string | null): number {
  const s = (status ?? "").toUpperCase();

  if (s.includes("UNEMPLOYED") || s.includes("NOT_EMPLOYED") || s === "NONE") {
    return 0; // No income → not viable
  }

  if (s.includes("SELF") || s.includes("FREELANCE") || s.includes("CONTRACT")) {
    // Self-employed: variable income — lenders apply 25% haircut
    return 0.75;
  }

  if (s.includes("PART")) {
    // Part-time: apply 40% haircut (no guaranteed hours)
    return 0.60;
  }

  // Full-time employed: apply tenure haircut
  // Matches the canonical values from the prequal form:
  //   "Less than 6 months", "6–12 months", "1–2 years", "3–5 years", "5+ years"
  const l = (length ?? "").toLowerCase();
  if (l.includes("less than 6") || l.includes("< 6") || l.includes("0-6")) {
    return 0.70; // < 6 months: 30% haircut (high turnover risk)
  }
  if (l.includes("6–12") || l.includes("6-12") || (l.startsWith("6") && l.includes("month"))) {
    return 0.80; // 6–12 months: 20% haircut
  }
  if (l.includes("1–2") || l.includes("1-2")) {
    return 0.90; // 1–2 years: 10% haircut
  }

  // 3+ years, 5+ years, or unspecified full-time: full income, no haircut
  return 1.00;
}

// ─── Core calculation ──────────────────────────────────────────────────────────

export function computeIncomeGate(input: IncomeGateInput): IncomeGateResult {
  const { monthlyIncomeCents, employmentStatus, lengthOfEmployment, statedBudgetCents } = input;

  const stabilityFactor = getStabilityFactor(employmentStatus, lengthOfEmployment);

  // Adjusted income after employment stability haircut
  const effectiveIncomeCents = Math.round(monthlyIncomeCents * stabilityFactor);

  // Max monthly auto payment (20% front-end DTI)
  const maxMonthlyPaymentCents   = Math.round(effectiveIncomeCents * FRONT_END_DTI);
  const maxMonthlyPaymentDollars = maxMonthlyPaymentCents / 100;

  // Income-based maximum loan amount
  // Formula: max loan = max monthly payment / payment factor
  // At 7% / 72mo: $1,000/mo ÷ 0.015222 = $65,695
  const incomeBasedMaxDollars = maxMonthlyPaymentDollars / PAYMENT_FACTOR;
  const incomeBasedMaxCents   = Math.round(incomeBasedMaxDollars * 100);

  // Check minimum viability
  const belowMinimum = incomeBasedMaxCents < PLATFORM_MIN_CENTS || stabilityFactor === 0;

  // Apply platform cap
  const cappedMaxCents = Math.min(incomeBasedMaxCents, PLATFORM_MAX_CENTS);

  // RequestedAmt = min(income-based max, stated budget)
  // If buyer says they want $25k but income supports $60k, request $25k.
  // If buyer says they want $80k but income only supports $50k, request $50k.
  let requestedAmtCents = cappedMaxCents;
  if (statedBudgetCents && statedBudgetCents > 0) {
    requestedAmtCents = Math.min(requestedAmtCents, statedBudgetCents);
  }

  // Enforce platform minimum on the request
  requestedAmtCents = Math.max(requestedAmtCents, PLATFORM_MIN_CENTS);

  return {
    requestedAmtCents,
    incomeBasedMaxCents:     cappedMaxCents,
    stabilityFactor,
    estimatedMonthlyPayment: maxMonthlyPaymentCents,
    belowMinimum,
  };
}
