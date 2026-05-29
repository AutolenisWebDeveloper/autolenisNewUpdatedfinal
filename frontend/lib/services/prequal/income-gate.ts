// lib/services/prequal/income-gate.ts
//
// Income-based auto loan capacity calculator.
// Mirrors underwriting logic used by:
//   - Capital One Auto Finance
//   - Chase Auto
//   - Bank of America Auto Finance
//   - Credit union auto loan departments (NCUA guidelines)
//   - Dealer F&I departments (Dealertrack / RouteOne)
//
// This gate runs BEFORE the MicroBilt call (PASS 1, UNKNOWN tier APR) and is
// RE-RUN AFTER MicroBilt returns a tier (PASS 2, tier-specific APR).
// The PASS 1 output (requestedAmtCents) becomes the RequestedAmt sent to
// iPredict. MicroBilt may approve less — final budget = min(income gate,
// credit gate).
//
// Two-DTI model (institutional-grade):
//   FRONT-END auto-only DTI  — auto payment ≤ 20% of effective income.
//   BACK-END total DTI       — auto + housing + other debt ≤ 45% of income.
//   Final max payment        — the more conservative (minimum) of the two.

// ─── Benchmark tier / APR ───────────────────────────────────────────────────────

export type BenchmarkTier = "STRONG" | "GOOD" | "FAIR" | "WEAK" | "UNKNOWN";

// Benchmark APR by credit tier — used both for initial sizing (PASS 1, UNKNOWN)
// and for the final, accurate payment estimate (PASS 2, derived tier).
// Same income, dramatically different buying power — matches real lenders.
export const BENCHMARK_APR_BY_TIER: Record<BenchmarkTier, number> = {
  STRONG: 0.065, // 6.5% — prime
  GOOD: 0.085, // 8.5% — near-prime
  FAIR: 0.115, // 11.5% — subprime
  WEAK: 0.165, // 16.5% — deep subprime
  UNKNOWN: 0.105, // 10.5% — conservative default (pre-MicroBilt)
};

// Payment factor = r × (1+r)^n / ((1+r)^n - 1)
// Meaning: to finance $1,000, the monthly payment is $1,000 × factor.
// This formula is identical to what banks use in their loan calculators.
export function getPaymentFactor(apr: number, termMonths = 72): number {
  const r = apr / 12;
  if (r === 0) return 1 / termMonths;
  return (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

// Resolve the benchmark APR for a given tier hint (defaults to UNKNOWN).
export function getBenchmarkApr(tier: BenchmarkTier | null | undefined): number {
  return BENCHMARK_APR_BY_TIER[tier ?? "UNKNOWN"] ?? BENCHMARK_APR_BY_TIER.UNKNOWN;
}

export interface IncomeGateInput {
  monthlyIncomeCents: number;
  employmentStatus: string | null;
  lengthOfEmployment: string | null;
  statedBudgetCents: number | null;
  // Back-end DTI inputs (optional — when absent, treated as $0).
  monthlyHousingPaymentCents?: number | null;
  monthlyOtherDebtCents?: number | null;
  // Benchmark tier hint for APR selection. PASS 1 omits this (UNKNOWN);
  // PASS 2 supplies the MicroBilt-derived tier for an accurate estimate.
  benchmarkTier?: BenchmarkTier | null;
}

export interface IncomeGateResult {
  requestedAmtCents: number; // send to MicroBilt as RequestedAmt
  incomeBasedMaxCents: number; // income ceiling before credit check
  stabilityFactor: number; // employment stability multiplier (0–1.0)
  estimatedMonthlyPayment: number; // conservative max auto payment (cents)
  belowMinimum: boolean; // income too low / debt too high for any viable loan
  // Decision detail (basis points — 1850 = 18.50%) for storage + transparency.
  frontEndDtiBps: number; // auto payment ÷ effective income
  backEndDtiBps: number; // (auto + housing + other debt) ÷ effective income
  totalMonthlyObligationsCents: number; // existing housing + other debt (cents)
  benchmarkAprBps: number; // APR used in this calculation (1050 = 10.50%)
}

// ─── Industry constants ────────────────────────────────────────────────────────

// Front-end auto-only DTI (payment as % of gross monthly income).
// Source: CFPB, NADA, credit union NCUA guidelines.
// We use 20% because iPredict is designed for non-prime consumers; iPredict
// constrains further based on the actual credit profile.
export const FRONT_END_AUTO_DTI = 0.2;

// Back-end total DTI limit (auto + housing + other debt as % of income).
// Mirrors Capital One Auto Finance, Ally, and credit union NCUA underwriting.
export const BACK_END_TOTAL_DTI = 0.45;

// Benchmark term (months) — 72 is the most common term for vehicles $25k+.
const BENCHMARK_TERM_MONTHS = 72;

// Platform bounds
const PLATFORM_MAX_CENTS = 8_500_000; // $85,000 hard cap
const PLATFORM_MIN_CENTS = 800_000; // $8,000 — below this, auto loan not viable

// Minimum back-end room for an auto payment. If existing debt consumes the
// available capacity down to under $150/mo, no viable auto loan remains.
const MIN_BACK_END_PAYMENT_CENTS = 15_000; // $150/mo

// ─── Employment stability factor ──────────────────────────────────────────────
// Banks apply income haircuts for employment instability.
// A self-employed buyer reporting $10,000/month gets treated as $7,500
// because income may be variable (25% haircut is standard).
// Source: NADA dealer F&I guidelines, credit union underwriting standards.

export function getStabilityFactor(status: string | null, length: string | null): number {
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
    return 0.6;
  }

  // Full-time employed: apply tenure haircut
  // Matches the canonical values from the prequal form:
  //   "Less than 6 months", "6–12 months", "1–2 years", "3–5 years", "5+ years"
  const l = (length ?? "").toLowerCase();
  if (l.includes("less than 6") || l.includes("< 6") || l.includes("0-6")) {
    return 0.7; // < 6 months: 30% haircut (high turnover risk)
  }
  if (l.includes("6–12") || l.includes("6-12") || (l.startsWith("6") && l.includes("month"))) {
    return 0.8; // 6–12 months: 20% haircut
  }
  if (l.includes("1–2") || l.includes("1-2")) {
    return 0.9; // 1–2 years: 10% haircut
  }

  // 3+ years, 5+ years, or unspecified full-time: full income, no haircut
  return 1.0;
}

// ─── Core calculation ──────────────────────────────────────────────────────────

export function computeIncomeGate(input: IncomeGateInput): IncomeGateResult {
  const {
    monthlyIncomeCents,
    employmentStatus,
    lengthOfEmployment,
    statedBudgetCents,
    monthlyHousingPaymentCents,
    monthlyOtherDebtCents,
    benchmarkTier,
  } = input;

  const stabilityFactor = getStabilityFactor(employmentStatus, lengthOfEmployment);

  // 1. Adjusted income after employment stability haircut
  const effectiveIncomeCents = Math.round(monthlyIncomeCents * stabilityFactor);

  // Existing monthly debt obligations (housing + other debt)
  const housingCents = Math.max(0, monthlyHousingPaymentCents ?? 0);
  const otherDebtCents = Math.max(0, monthlyOtherDebtCents ?? 0);
  const existingDebtCents = housingCents + otherDebtCents;

  // 2. Front-end max auto payment (20% of effective income)
  const frontEndMaxPaymentCents = Math.round(effectiveIncomeCents * FRONT_END_AUTO_DTI);

  // 3. Back-end max auto payment (45% of income minus existing obligations)
  const totalDebtCapacityCents = Math.round(effectiveIncomeCents * BACK_END_TOTAL_DTI);
  const backEndMaxPaymentCents = totalDebtCapacityCents - existingDebtCents;

  // 4. Final monthly payment = the more conservative of the two
  const maxMonthlyPaymentCents = Math.min(frontEndMaxPaymentCents, backEndMaxPaymentCents);

  // Benchmark APR + payment factor for this tier hint
  const benchmarkApr = getBenchmarkApr(benchmarkTier);
  const paymentFactor = getPaymentFactor(benchmarkApr, BENCHMARK_TERM_MONTHS);

  // 6. Convert to max loan amount using the rate-tier-aware payment factor.
  //    Negative/zero capacity → $0 (declined below).
  const usableMonthlyPaymentDollars = Math.max(maxMonthlyPaymentCents, 0) / 100;
  const incomeBasedMaxDollars = usableMonthlyPaymentDollars / paymentFactor;
  const incomeBasedMaxCents = Math.round(incomeBasedMaxDollars * 100);

  // 5. Viability checks:
  //    - No income (stabilityFactor 0)
  //    - Existing debt consumes available capacity (back-end ≤ $150)
  //    - Income-based max below the platform floor ($8,000)
  const belowMinimum =
    stabilityFactor === 0 ||
    backEndMaxPaymentCents < MIN_BACK_END_PAYMENT_CENTS ||
    incomeBasedMaxCents < PLATFORM_MIN_CENTS;

  // Apply platform cap
  const cappedMaxCents = Math.min(incomeBasedMaxCents, PLATFORM_MAX_CENTS);

  // RequestedAmt = min(income-based max, stated budget), floored at platform min.
  // If buyer says they want $25k but income supports $60k, request $25k.
  // If buyer says they want $80k but income only supports $50k, request $50k.
  let requestedAmtCents = cappedMaxCents;
  if (statedBudgetCents && statedBudgetCents > 0) {
    requestedAmtCents = Math.min(requestedAmtCents, statedBudgetCents);
  }
  requestedAmtCents = Math.max(requestedAmtCents, PLATFORM_MIN_CENTS);

  // Decision detail — actual DTI ratios for this buyer, in basis points.
  const autoPaymentForDti = Math.max(maxMonthlyPaymentCents, 0);
  const frontEndDtiBps =
    effectiveIncomeCents > 0
      ? Math.round((autoPaymentForDti / effectiveIncomeCents) * 10000)
      : 0;
  const backEndDtiBps =
    effectiveIncomeCents > 0
      ? Math.round(((autoPaymentForDti + existingDebtCents) / effectiveIncomeCents) * 10000)
      : 0;

  return {
    requestedAmtCents,
    incomeBasedMaxCents: cappedMaxCents,
    stabilityFactor,
    estimatedMonthlyPayment: autoPaymentForDti,
    belowMinimum,
    frontEndDtiBps,
    backEndDtiBps,
    totalMonthlyObligationsCents: existingDebtCents,
    benchmarkAprBps: Math.round(benchmarkApr * 10000),
  };
}
