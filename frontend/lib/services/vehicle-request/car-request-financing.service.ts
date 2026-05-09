// System 4C — Vehicle Request Financing Service
// Lead quality scoring and admin badge assignment are computed server-side only.
// Client-submitted values for leadQualityScore and adminBadge are ALWAYS ignored.
// Dealer surface shows ONLY paymentMethod category (Cash/Finance/Lease/Undecided).

import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaymentMethod =
  | "FINANCE_AUTOLENIS"
  | "FINANCE_OUTSIDE"
  | "CASH"
  | "LEASE"
  | "UNDECIDED";

export type PreApprovalStatus =
  | "APPROVED"
  | "WANTS_HELP"
  | "SELF_ARRANGE"
  | "CASH"
  | "LEASE";

export type EstimatedCreditRange =
  | "EXCELLENT"
  | "GOOD"
  | "FAIR"
  | "BUILDING"
  | "PREFER_NOT_TO_SAY";

export type PurchaseTimeframe =
  | "ASAP"
  | "WITHIN_7_DAYS"
  | "WITHIN_30_DAYS"
  | "WITHIN_60_DAYS_PLUS";

export type AdminBadge =
  | "NEEDS_PREQUAL"
  | "OUTSIDE_APPROVAL"
  | "CASH_BUYER"
  | "LEASE_PROSPECT"
  | "FINANCING_OPPORTUNITY";

export interface VehicleRequestFinancingInput {
  paymentMethod?: PaymentMethod;
  preApprovalStatus?: PreApprovalStatus;
  // APPROVED branch — never shown to dealers
  lenderName?: string;
  approvedAmountCents?: number;
  quotedApr?: number;
  approvalExpiresAt?: Date | string;
  downPaymentCents?: number;
  monthlyPaymentTargetCents?: number;
  preApprovalLetterUrl?: string;
  // WANTS_HELP branch — never shown to dealers
  estimatedCreditRange?: EstimatedCreditRange;
  estimatedAnnualIncomeCents?: number;
  // CASH branch
  proofOfFundsAvailable?: boolean;
  maxBudgetCents?: number;
  // LEASE branch
  leaseTermMonths?: 24 | 36 | 48;
  leaseMilesPerYear?: number;
  // Universal
  tradeIn?: boolean;
  purchaseTimeframe?: PurchaseTimeframe;
}

// ─── Lead Quality Scoring ────────────────────────────────────────────────────

/**
 * Compute the lead quality score (0–100) from financing input.
 * Returns null if preApprovalStatus is not present (financing section was skipped).
 * This must only be called server-side; never let the client submit this value.
 */
export function computeLeadScore(
  financing: VehicleRequestFinancingInput
): number | null {
  // If financing section was skipped (no preApprovalStatus), score is null
  if (!financing.preApprovalStatus) return null;

  let score = 0;

  // Pre-approval status scoring
  if (financing.preApprovalStatus === "APPROVED") {
    if (financing.approvalExpiresAt) {
      const expiry = new Date(financing.approvalExpiresAt);
      if (expiry > new Date()) {
        score += 40; // Approved with future expiry
      } else {
        score += 25; // Approved but expired — treat same as no expiry
      }
    } else {
      score += 25; // Approved, no expiry provided
    }
  } else if (financing.preApprovalStatus === "CASH") {
    if (financing.proofOfFundsAvailable === true) {
      score += 40;
    } else if (financing.proofOfFundsAvailable === false) {
      score += 20;
    }
  } else if (financing.preApprovalStatus === "WANTS_HELP") {
    if (financing.estimatedCreditRange === "EXCELLENT") score += 25;
    else if (financing.estimatedCreditRange === "GOOD") score += 20;
    else if (financing.estimatedCreditRange === "FAIR") score += 10;
    else if (financing.estimatedCreditRange === "BUILDING") score += 5;
  }

  // Purchase timeframe scoring
  if (financing.purchaseTimeframe === "ASAP") score += 20;
  else if (financing.purchaseTimeframe === "WITHIN_7_DAYS") score += 15;
  else if (financing.purchaseTimeframe === "WITHIN_30_DAYS") score += 10;
  else if (financing.purchaseTimeframe === "WITHIN_60_DAYS_PLUS") score += 5;

  // Trade-in bonus
  if (financing.tradeIn === true) score += 10;

  // Down payment bonus (>= $3,000)
  if ((financing.downPaymentCents ?? 0) >= 300000) score += 10;

  return Math.min(score, 100);
}

/**
 * Assign an admin badge based on financing input.
 * This must only be called server-side; never let the client submit this value.
 */
export function computeAdminBadge(
  financing: VehicleRequestFinancingInput
): AdminBadge {
  if (financing.approvedAmountCents != null) return "OUTSIDE_APPROVAL";
  if (financing.paymentMethod === "CASH") return "CASH_BUYER";
  if (financing.paymentMethod === "LEASE") return "LEASE_PROSPECT";
  if (financing.preApprovalStatus === "WANTS_HELP") return "FINANCING_OPPORTUNITY";
  if (financing.preApprovalStatus === "SELF_ARRANGE") return "OUTSIDE_APPROVAL";
  return "NEEDS_PREQUAL";
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Create a VehicleRequestFinancing record for a given vehicleRequestId.
 * Computes leadQualityScore and adminBadge server-side — never accepts them from input.
 */
export async function createVehicleRequestFinancing(
  vehicleRequestId: string,
  input: VehicleRequestFinancingInput
) {
  const leadQualityScore = computeLeadScore(input);
  const adminBadge = computeAdminBadge(input);

  return prisma.vehicleRequestFinancing.create({
    data: {
      vehicleRequestId,
      paymentMethod: input.paymentMethod ?? null,
      preApprovalStatus: input.preApprovalStatus ?? null,
      lenderName: input.lenderName ?? null,
      approvedAmountCents: input.approvedAmountCents ?? null,
      quotedApr: input.quotedApr != null ? input.quotedApr : null,
      approvalExpiresAt: input.approvalExpiresAt
        ? new Date(input.approvalExpiresAt)
        : null,
      downPaymentCents: input.downPaymentCents ?? null,
      monthlyPaymentTargetCents: input.monthlyPaymentTargetCents ?? null,
      preApprovalLetterUrl: input.preApprovalLetterUrl ?? null,
      estimatedCreditRange: input.estimatedCreditRange ?? null,
      estimatedAnnualIncomeCents: input.estimatedAnnualIncomeCents ?? null,
      proofOfFundsAvailable: input.proofOfFundsAvailable ?? null,
      maxBudgetCents: input.maxBudgetCents ?? null,
      leaseTermMonths: input.leaseTermMonths ?? null,
      leaseMilesPerYear: input.leaseMilesPerYear ?? null,
      tradeIn: input.tradeIn ?? null,
      purchaseTimeframe: input.purchaseTimeframe ?? null,
      leadQualityScore,
      adminBadge,
    },
  });
}

// ─── Human-readable labels ───────────────────────────────────────────────────

export function paymentMethodLabel(method: string | null | undefined): string {
  const labels: Record<string, string> = {
    FINANCE_AUTOLENIS: "Finance through AutoLenis",
    FINANCE_OUTSIDE: "Use outside lender",
    CASH: "Cash",
    LEASE: "Lease",
    UNDECIDED: "Undecided",
  };
  return method ? (labels[method] ?? method) : "Not specified";
}

export function preApprovalStatusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    APPROVED: "Already pre-approved",
    WANTS_HELP: "Would like financing help",
    SELF_ARRANGE: "Will arrange own financing",
    CASH: "Paying cash",
    LEASE: "Looking to lease",
  };
  return status ? (labels[status] ?? status) : "Not specified";
}

export function purchaseTimeframeLabel(timeframe: string | null | undefined): string {
  const labels: Record<string, string> = {
    ASAP: "As soon as possible",
    WITHIN_7_DAYS: "Within 7 days",
    WITHIN_30_DAYS: "Within 30 days",
    WITHIN_60_DAYS_PLUS: "60+ days",
  };
  return timeframe ? (labels[timeframe] ?? timeframe) : "Not specified";
}
