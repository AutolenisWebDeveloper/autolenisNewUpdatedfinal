// F-002/F-003 — settlement invariants for the consolidated payout rail.
// Dependency-free so they are unit-testable and can be asserted anywhere.

export interface CommissionSettlementState {
  status: string;            // CommissionStatus
  paidAt: Date | null;
  payoutId: string | null;
}

// A commission is genuinely settled ONLY when all three agree: status PAID, a
// paidAt timestamp, AND a link to the AffiliatePayout that paid it. This rejects
// the corruption the old self-serve rail produced (paidAt stamped at request
// time while status stayed APPROVED and no payout ever settled).
export function isCommissionSettled(c: CommissionSettlementState): boolean {
  return c.status === "PAID" && c.paidAt != null && c.payoutId != null;
}
