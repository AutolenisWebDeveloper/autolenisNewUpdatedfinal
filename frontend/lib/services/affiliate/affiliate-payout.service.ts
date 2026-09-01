// lib/services/affiliate/affiliate-payout.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isCommissionSettled } from "@/lib/services/affiliate/payout-invariants";
import { AFFILIATE_PAYOUT_MINIMUM_CENTS, formatCentsAsUsd } from "@/lib/constants";

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

// ─── Self-serve payout request rail (decision 3 — rebuilt, not re-enabled) ───
//
// The old rail was disabled because it created orphaned PENDING payouts and
// stamped Commission.paidAt at request time. The rebuild follows the proven
// settlement pattern: one transaction, compare-and-set claims, and commissions
// stay APPROVED until an admin settles the request. Settlement remains
// recorded-only — no real money movement until a processor is integrated
// (Stripe Connect / ACH — F-049, unchanged TODO).

export class PayoutRequestError extends Error {
  constructor(
    public readonly code:
      | "NO_PAYOUT_METHOD"
      | "TAX_REQUIRED"
      | "REQUEST_PENDING"
      | "NOTHING_TO_PAY"
      | "BELOW_MINIMUM",
    message: string,
  ) {
    super(message);
    this.name = "PayoutRequestError";
  }
}

export interface RequestPayoutResult {
  payoutId: string;
  amountCents: number;
  commissionCount: number;
}

export async function requestPayout(affiliateId: string): Promise<RequestPayoutResult> {
  return prisma.$transaction(async (tx) => {
    // APPROVAL GATE REMOVED (owner decision): a payout never waits on an admin
    // approving onboarding. The only remaining prerequisites are the data the
    // payment itself cannot proceed without — both self-service:
    //   • a payout method (somewhere to send the money);
    //   • a certified W-9 (1099 reporting; recorded payouts over $600/yr
    //     without one are a compliance gap).
    const method = await tx.affiliatePayoutMethod.findUnique({ where: { affiliateId } });
    if (!method?.method) {
      throw new PayoutRequestError("NO_PAYOUT_METHOD", "Add a payout method in the Finance Hub first.");
    }
    const tax = await tx.affiliateTaxProfile.findUnique({
      where: { affiliateId },
      select: { certified: true },
    });
    if (!tax?.certified) {
      throw new PayoutRequestError(
        "TAX_REQUIRED",
        "Complete and certify your tax information (W-9) in the Finance Hub before requesting a payout.",
      );
    }

    // One open request at a time — a second request cannot race the first.
    const open = await tx.affiliatePayout.findFirst({
      where: { affiliateId, status: "PENDING" },
      select: { id: true },
    });
    if (open) {
      throw new PayoutRequestError(
        "REQUEST_PENDING",
        "You already have a payout request awaiting settlement.",
      );
    }

    const claimable = await tx.commission.findMany({
      where: { affiliateId, status: "APPROVED", payoutId: null },
      select: { id: true, amountCents: true, createdAt: true },
    });
    if (claimable.length === 0) {
      throw new PayoutRequestError("NOTHING_TO_PAY", "No approved commissions are ready for payout yet.");
    }
    const amountCents = claimable.reduce((s, c) => s + c.amountCents, 0);
    if (amountCents < AFFILIATE_PAYOUT_MINIMUM_CENTS) {
      throw new PayoutRequestError(
        "BELOW_MINIMUM",
        `Payouts start at ${formatCentsAsUsd(AFFILIATE_PAYOUT_MINIMUM_CENTS)} — keep earning and request once your approved balance reaches it.`,
      );
    }

    const requestedAt = new Date();
    const periodStart = claimable.reduce(
      (min, c) => (c.createdAt < min ? c.createdAt : min),
      claimable[0].createdAt,
    );
    const payout = await tx.affiliatePayout.create({
      data: {
        affiliateId,
        amountCents,
        status: "PENDING",
        method: method.method,
        periodStart,
        periodEnd: requestedAt,
      },
    });

    // Compare-and-set claim: only rows that are STILL approved and unclaimed
    // attach. A concurrent claimant makes the count mismatch and the whole
    // request (payout row included) rolls back — the same commission can
    // never belong to two payouts.
    const claimed = await tx.commission.updateMany({
      where: { id: { in: claimable.map((c) => c.id) }, status: "APPROVED", payoutId: null },
      data: { payoutId: payout.id },
    });
    if (claimed.count !== claimable.length) {
      throw new CommissionNotClaimableError(
        `payout request for ${affiliateId}: claimed ${claimed.count}/${claimable.length}`,
      );
    }

    return { payoutId: payout.id, amountCents, commissionCount: claimable.length };
  });
}

export interface SettleRequestedPayoutResult {
  payoutId: string;
  affiliateId: string;
  /** What actually settled — recomputed from surviving claims, never the stale request amount. */
  amountCents: number;
  commissionCount: number;
  settledAt: Date;
  /** True when every claimed commission had been reversed: the payout was
   *  cancelled (REVERSED), no money instruction exists, and the affiliate can
   *  request again. */
  cancelled: boolean;
}

// Admin settlement of a requested payout.
//
// P1-1 (review) — commissions can be REVERSED *after* being claimed by a
// pending request (fee refund → in-place reversal; admin reverse). Settling at
// the amount frozen at request time would over-instruct payment, and an
// all-reversed payout would be forever unsettleable while blocking the
// affiliate's next request. So settlement recomputes from the SURVIVING
// attached APPROVED rows inside the transaction:
//   • some survive → payout PENDING→PAID CAS with amountCents re-stamped to
//     the surviving sum; those rows APPROVED→PAID (count-verified); invariant
//     asserted per row;
//   • none survive → payout PENDING→REVERSED CAS (cancelled — terminal, so
//     the one-open-request rule frees up), reversed rows stay attached for the
//     audit trail, `cancelled: true` returned.
export async function settleRequestedPayout(input: {
  payoutId: string;
  paymentMethod: string;
  paymentReference: string;
}): Promise<SettleRequestedPayoutResult> {
  const { payoutId, paymentMethod, paymentReference } = input;
  const settledAt = new Date();

  return prisma.$transaction(async (tx) => {
    const payout = await tx.affiliatePayout.findUnique({ where: { id: payoutId } });
    if (!payout || payout.status !== "PENDING") {
      throw new CommissionNotClaimableError(`payout ${payoutId} is not awaiting settlement`);
    }

    const attached = await tx.commission.findMany({
      where: { payoutId, status: "APPROVED" },
      select: { id: true, amountCents: true },
    });

    if (attached.length === 0) {
      // Every claim was reversed since the request — cancel, never pay.
      const cancelled = await tx.affiliatePayout.updateMany({
        where: { id: payoutId, status: "PENDING" },
        data: { status: "REVERSED", processedAt: settledAt },
      });
      if (cancelled.count !== 1) {
        throw new CommissionNotClaimableError(`payout ${payoutId} was settled concurrently`);
      }
      return {
        payoutId,
        affiliateId: payout.affiliateId,
        amountCents: 0,
        commissionCount: 0,
        settledAt,
        cancelled: true,
      };
    }

    const survivingCents = attached.reduce((s, c) => s + c.amountCents, 0);
    const flipped = await tx.affiliatePayout.updateMany({
      where: { id: payoutId, status: "PENDING" },
      data: {
        status: "PAID",
        amountCents: survivingCents,
        method: paymentMethod,
        reference: paymentReference,
        processedAt: settledAt,
      },
    });
    if (flipped.count !== 1) {
      throw new CommissionNotClaimableError(`payout ${payoutId} was settled concurrently`);
    }

    const paid = await tx.commission.updateMany({
      where: { payoutId, status: "APPROVED" },
      data: { status: "PAID", paidAt: settledAt },
    });
    if (paid.count !== attached.length || paid.count === 0) {
      throw new CommissionNotClaimableError(
        `payout ${payoutId}: settled ${paid.count}/${attached.length} attached commissions`,
      );
    }

    // M11 — assert the settled invariant against each written row.
    for (const { id } of attached) {
      const settled = await tx.commission.findUnique({
        where: { id },
        select: { status: true, paidAt: true, payoutId: true },
      });
      if (!settled || !isCommissionSettled(settled)) {
        throw new Error(`Settlement invariant violated for commission ${id} — rolling back`);
      }
    }

    return {
      payoutId,
      affiliateId: payout.affiliateId,
      amountCents: survivingCents,
      commissionCount: attached.length,
      settledAt,
      cancelled: false,
    };
  });
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
