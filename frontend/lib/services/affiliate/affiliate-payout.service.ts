// lib/services/affiliate/affiliate-payout.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isCommissionSettled } from "@/lib/services/affiliate/payout-invariants";

// F-002/F-003 — a commission that could not be claimed for settlement: it was
// missing, already settled, or lost the compare-and-set race to a concurrent
// settlement. Typed so the route can map it to a clean 409.
export class CommissionNotClaimableError extends Error {
  constructor(commissionId: string) {
    super(
      `Commission ${commissionId} is not claimable for settlement (missing, already settled, or concurrently claimed).`,
    );
    this.name = "CommissionNotClaimableError";
  }
}

export interface SettleCommissionResult {
  commissionId: string;
  payoutId: string;
  affiliateId: string;
  amountCents: number;
  settledAt: Date;
}

// F-002/F-003 — the single, concurrency-safe settlement unit for one APPROVED
// commission. It runs ONE interactive transaction that:
//   1. reads the commission (to source the affiliate + amount for the payout);
//   2. creates a real AffiliatePayout(PAID);
//   3. flips the commission APPROVED→PAID and links payoutId via a
//      compare-and-set (`updateMany where status = APPROVED`).
//
// The compare-and-set is the correctness guarantee, NOT the initial read: under
// Postgres READ COMMITTED two concurrent settlements both read APPROVED and both
// create a payout row, but only one `updateMany` matches — the second blocks on
// the row lock, re-evaluates `status = APPROVED` against the now-committed PAID
// row, matches 0, and we throw to roll the loser's payout back. So one commission
// can never be linked to two payouts and a retry/double-click can never double-pay
// (invariants: eligible commission settles exactly once; no double payout).
export async function settleApprovedCommission(input: {
  commissionId: string;
  paymentMethod: string;
  paymentReference: string;
}): Promise<SettleCommissionResult> {
  const { commissionId, paymentMethod, paymentReference } = input;
  const settledAt = new Date();

  return prisma.$transaction(async (tx) => {
    const commission = await tx.commission.findUnique({ where: { id: commissionId } });
    if (!commission || commission.status !== "APPROVED") {
      // Fast fail before any write; the compare-and-set below is the real guard
      // against the concurrent case the read cannot see.
      throw new CommissionNotClaimableError(commissionId);
    }

    const payout = await tx.affiliatePayout.create({
      data: {
        affiliateId: commission.affiliateId,
        amountCents: commission.amountCents,
        status: "PAID",
        method: paymentMethod,
        reference: paymentReference,
        periodStart: commission.createdAt,
        periodEnd: settledAt,
        processedAt: settledAt,
      },
    });

    const claimed = await tx.commission.updateMany({
      where: { id: commissionId, status: "APPROVED" },
      data: { status: "PAID", paidAt: settledAt, payoutId: payout.id },
    });
    if (claimed.count !== 1) {
      // Another settlement won the race between our read and our claim. Throwing
      // rolls back the payout we just created — no orphaned money-out record.
      throw new CommissionNotClaimableError(commissionId);
    }

    // M11 — assert the settled invariant against the row we just wrote, inside
    // the transaction: status PAID + paidAt + payoutId must all agree, or the
    // whole settlement rolls back. This turns payout-invariants from test-only
    // documentation into an enforced write-path guard.
    const settled = await tx.commission.findUnique({
      where: { id: commissionId },
      select: { status: true, paidAt: true, payoutId: true },
    });
    if (!settled || !isCommissionSettled(settled)) {
      throw new Error(
        `Settlement invariant violated for commission ${commissionId} — rolling back (status=${settled?.status}, paidAt=${String(settled?.paidAt)}, payoutId=${String(settled?.payoutId)})`,
      );
    }

    return {
      commissionId,
      payoutId: payout.id,
      affiliateId: commission.affiliateId,
      amountCents: commission.amountCents,
      settledAt,
    };
  });
}

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

// D15 — bounded: the admin settlement rail creates one payout per settled
// commission, so this table scales with commissions; an unbounded read grew
// without limit. Callers page with `cursor` (a payout id) when needed.
export async function getPayoutHistory(
  affiliateId: string,
  opts: { take?: number; cursor?: string } = {},
) {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  return prisma.affiliatePayout.findMany({
    where: { affiliateId },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take,
    ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
  });
}

export async function processPayouts(): Promise<number> {
  // TODO [POST-LAUNCH / F-049]: Integrate a payment processor (Stripe Connect / ACH).
  // Until then settlement is recorded per-commission via the admin rail
  // POST /api/admin/affiliates/commissions/[commissionId]/mark-paid.
  logger.warn("[processPayouts] Payment processor not integrated. Settlement is recorded per-commission via the admin mark-paid rail.");
  return 0;
}
