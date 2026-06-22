// lib/services/affiliate/affiliate-payout.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

// F-002/F-003 — the self-serve batch payout rail is DISABLED.
//
// It previously created an AffiliatePayout(PENDING) that nothing could ever
// advance to PAID (no settle route exists; processPayouts is a stub) AND
// prematurely stamped Commission.paidAt while leaving status APPROVED —
// corrupting balances and orphaning payouts forever. Until a real processor
// (Stripe Connect / ACH — F-049) is integrated, settlement happens ONLY through
// the admin per-commission mark-paid rail, which records a real
// AffiliatePayout(PAID) and links it via Commission.payoutId in one transaction.
export class PayoutsUnavailableError extends Error {
  constructor() {
    super(
      "Self-serve payouts are not yet available. Approved commissions are settled by AutoLenis and paid out directly.",
    );
    this.name = "PayoutsUnavailableError";
  }
}

// Disabled: never creates an orphaned payout or mutates commission state. Any
// caller gets a clear, typed error so the route can surface a clean message.
export async function requestPayout(_affiliateId: string): Promise<never> {
  throw new PayoutsUnavailableError();
}

export async function getPayoutHistory(affiliateId: string) {
  return prisma.affiliatePayout.findMany({ where: { affiliateId }, orderBy: { requestedAt: "desc" } });
}

export async function processPayouts(): Promise<number> {
  // TODO [POST-LAUNCH / F-049]: Integrate a payment processor (Stripe Connect / ACH).
  // Until then settlement is recorded per-commission via the admin rail
  // POST /api/admin/affiliates/commissions/[commissionId]/mark-paid.
  logger.warn("[processPayouts] Payment processor not integrated. Settlement is recorded per-commission via the admin mark-paid rail.");
  return 0;
}
