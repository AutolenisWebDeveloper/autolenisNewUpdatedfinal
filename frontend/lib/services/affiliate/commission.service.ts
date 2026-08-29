// lib/services/affiliate/commission.service.ts
// 3-level commission model — rates sourced from COMMISSION_RATES in lib/constants.ts
// D2: COMMISSION_RATES from lib/constants.ts ONLY — never inline
// Commission walk depth: maximum 3 levels — no L4 or L5

import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { emitDomainEvent } from "@/lib/events/emit";
import { logger } from "@/lib/logger";
import { computeCommissionCents } from "@/lib/services/affiliate/commission-math";

// Re-export so existing importers (and tests) can reach the pure helper.
export { computeCommissionCents };

// Walk affiliate tree up to 3 levels and create commissions (idempotent).
// feeBasisCents is the actual fee the buyer paid (from the Stripe PaymentIntent);
// commissions are a percentage of THAT, not of a hardcoded $499 constant (F-004).
export async function walkCommissionTree(
  dealId: string,
  buyerAffiliateId: string | null | undefined,
  qualifyingEventId: string,
  feeBasisCents: number = PREMIUM_FEE_REMAINING_CENTS,
): Promise<void> {
  if (!buyerAffiliateId) return;

  // Defend against a missing/zero basis: fall back to the configured premium
  // fee so a metadata gap never silently zeroes out earned commissions.
  // M4: the fallback is the CAPTURED amount ($400 after the $99 deposit
  // credit), not the $499 sticker — the old fallback overpaid ~25%.
  const basisCents = feeBasisCents > 0 ? feeBasisCents : PREMIUM_FEE_REMAINING_CENTS;

  const affiliate = await prisma.affiliate.findUnique({
    where: { id: buyerAffiliateId },
    include: { parent: { include: { parent: true } } },
  });
  if (!affiliate) return;

  // M14 — a SUSPENDED/REJECTED affiliate does not accrue new money; its level
  // is skipped while other levels of the tree still earn (PENDING stays
  // quasi-active under the auto-ACTIVE activation model).
  const canEarn = (a: { status?: string } | null | undefined) =>
    !!a && a.status !== "SUSPENDED" && a.status !== "REJECTED";

  const levels = [
    canEarn(affiliate) ? { affiliate, rate: COMMISSION_RATES.LEVEL_1, level: 1 } : null,
    canEarn(affiliate.parent) ? { affiliate: affiliate.parent!, rate: COMMISSION_RATES.LEVEL_2, level: 2 } : null,
    canEarn(affiliate.parent?.parent) ? { affiliate: affiliate.parent!.parent!, rate: COMMISSION_RATES.LEVEL_3, level: 3 } : null,
  ].filter(Boolean) as Array<{ affiliate: { id: string }; rate: number; level: number }>;

  // Commission is idempotent — check before creating
  for (const entry of levels) {
    const key = `${qualifyingEventId}-L${entry.level}`;
    const existing = await prisma.commission.findUnique({ where: { qualifyingEventId: key } });
    if (existing) continue;

    const amountCents = computeCommissionCents(basisCents, entry.rate);
    await prisma.commission.create({
      data: {
        affiliateId: entry.affiliate.id,
        dealId,
        level: entry.level,
        rate: entry.rate,
        basisCents,
        amountCents,
        status: "PENDING",
        qualifyingEventId: key,
      },
    });

    // CRM spine: affiliate earned a commission → timeline + Make (non-blocking,
    // never throws; forward no-ops until MAKE_WEBHOOK_URL is set). Keyed on the
    // commission's qualifying event so retries collapse. Best-effort: a lookup
    // failure must never break commission creation in the payment path.
    try {
      const earner = await prisma.affiliate.findUnique({
        where: { id: entry.affiliate.id },
        include: { user: { select: { email: true } }, profile: { select: { firstName: true, lastName: true } } },
      });
      if (earner?.user?.email) {
        await emitDomainEvent("affiliate_commission", {
          domainEntityId: key,
          contact: {
            email: earner.user.email,
            firstName: earner.profile?.firstName ?? undefined,
            lastName: earner.profile?.lastName ?? undefined,
            source: "affiliate_signup",
          },
          data: {
            affiliate_id: entry.affiliate.id,
            deal_id: dealId,
            level: entry.level,
            amount_cents: amountCents,
          },
        });
      }
    } catch (err) {
      logger.error("[commission] affiliate_commission emit failed:", err);
    }
  }
}

// Resolve the buyer's referring affiliate from a paid fee and walk the tree.
// This is the single idempotent recovery unit for fee-driven commissions: it is
// called inline by the Stripe fee webhook AND replayed by the DLQ drainer
// (autolenis/affiliate.commission_walk) if the inline call fails after the fee
// PaymentIntent was captured. Every step is safe to repeat — the buyer/referral
// lookups are reads and walkCommissionTree dedupes on qualifyingEventId — so a
// replay after a partial success never double-pays and a replay for a
// non-referred buyer is a clean no-op.
export async function processFeeCommission(params: {
  dealId: string;
  buyerId: string;
  qualifyingEventId: string;
  feeBasisCents?: number;
}): Promise<void> {
  const { dealId, buyerId, qualifyingEventId, feeBasisCents } = params;
  if (!dealId || !buyerId || !qualifyingEventId) return;

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { userId: true },
  });
  if (!buyer) return;

  const referral = await prisma.affiliateReferral.findFirst({
    where: { referredUserId: buyer.userId },
    // D6 — deterministic payee when one user somehow holds referral rows under
    // two affiliates: first-touch wins (earliest signup), never planner order.
    // The referred_user_id UNIQUE in migration 001 makes this structural; the
    // orderBy is belt-and-braces until that migration is applied.
    orderBy: { signedUpAt: "asc" },
    select: { id: true, affiliateId: true, firstDealAt: true },
  });
  if (!referral) return; // buyer was not referred — nothing to pay

  // D12 — replay guard for the conversion stamps below: if any commission for
  // this qualifying event already exists, this event was already processed and
  // a DLQ replay must not re-increment totalDeals. (Edge: a tree whose every
  // level is SUSPENDED creates no commissions, so a replay after a stamp
  // failure could re-increment — accepted; stats-only, no money impact.)
  const alreadyProcessed = await prisma.commission.findFirst({
    where: { qualifyingEventId: { startsWith: `${qualifyingEventId}-L` } },
    select: { id: true },
  });

  await walkCommissionTree(dealId, referral.affiliateId, qualifyingEventId, feeBasisCents);

  if (!alreadyProcessed) {
    // D12 — the conversion columns analytics read were never written anywhere:
    // stamp first-deal-at once and count this deal.
    await prisma.affiliateReferral
      .update({
        where: { id: referral.id },
        data: {
          ...(referral.firstDealAt ? {} : { firstDealAt: new Date() }),
          totalDeals: { increment: 1 },
        },
      })
      .catch((err) => logger.error("[commission] conversion stamp failed (stats only):", err));
  }
}

// ─── The single ledger rule for "earned" money (M1 / decision 4) ─────────────
// Two reversal mechanisms coexist and must net correctly everywhere:
//   • in-place reverse flips a PENDING/APPROVED row to REVERSED, amount stays
//     POSITIVE → it stops counting as earned;
//   • clawback leaves the PAID original PAID and appends a NEGATIVE REVERSED
//     offset row → the offset must count, netting the original out.
// So: earned = PENDING + APPROVED + PAID rows, plus REVERSED rows whose amount
// is negative. REJECTED never counts. Every affiliate/admin/leaderboard/digest
// aggregation uses this rule — via ledgerEarnedWhere for queries or
// countsTowardEarned for row filters — never an ad-hoc status filter.

export const EARNED_STATUSES = ["PENDING", "APPROVED", "PAID"] as const;

export function countsTowardEarned(c: { status: string; amountCents: number }): boolean {
  if ((EARNED_STATUSES as readonly string[]).includes(c.status)) return true;
  return c.status === "REVERSED" && c.amountCents < 0;
}

export function ledgerEarnedWhere(affiliateId?: string) {
  return {
    ...(affiliateId ? { affiliateId } : {}),
    OR: [
      { status: { in: [...EARNED_STATUSES] } },
      { status: "REVERSED" as const, amountCents: { lt: 0 } },
    ],
  };
}

// Commission summary for an affiliate
export async function getCommissionSummary(affiliateId: string) {
  const [paid, approved, pendingReview, clawbackOffsets] = await Promise.all([
    prisma.commission.aggregate({ where: { affiliateId, status: "PAID" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({ where: { affiliateId, status: "APPROVED" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({ where: { affiliateId, status: "PENDING" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({
      where: { affiliateId, status: "REVERSED", amountCents: { lt: 0 } },
      _sum: { amountCents: true },
    }),
  ]);

  const paidCents = paid._sum.amountCents ?? 0;
  const approvedCents = approved._sum.amountCents ?? 0;
  const pendingReviewCents = pendingReview._sum.amountCents ?? 0;
  const clawbackOffsetCents = clawbackOffsets._sum.amountCents ?? 0; // ≤ 0

  return {
    paidCents,
    // approvedCents: admin-approved commissions ready to be requested as a payout
    approvedCents,
    // pendingCents: combined APPROVED + PENDING — used for dashboard/earnings "awaiting payout" display
    pendingCents: approvedCents + pendingReviewCents,
    // pendingReviewCents: commissions awaiting admin approval (not yet payable)
    pendingReviewCents,
    // totalCents: lifetime earned under the shared ledger rule above — live rows
    // net of clawback offsets; in-place-reversed and REJECTED rows excluded.
    totalCents: paidCents + approvedCents + pendingReviewCents + clawbackOffsetCents,
  };
}

// Per-level lifetime breakdown for the earnings page (M15) — a DB-side groupBy
// over the WHOLE ledger under the shared earned rule, so the level bars always
// sum to the same universe as the summary cards (the old version reduced the
// latest 50 rows client-side and drifted once an affiliate passed 50).
export async function getCommissionLevelBreakdown(
  affiliateId: string,
): Promise<Array<{ level: number; total: number; count: number }>> {
  const groups = await prisma.commission.groupBy({
    by: ["level"],
    where: ledgerEarnedWhere(affiliateId),
    _sum: { amountCents: true },
    _count: { id: true },
  });
  const byLevel = new Map(groups.map((g) => [g.level, g]));
  return [1, 2, 3].map((level) => {
    const g = byLevel.get(level);
    return { level, total: g?._sum.amountCents ?? 0, count: g?._count.id ?? 0 };
  });
}

// ─── Refund/approval safety for fee-driven commissions (M2/M16) ──────────────

// Fee-walk commissions are keyed `${paymentIntentId}-L${level}`.
const FEE_EVENT_KEY = /^(pi_[A-Za-z0-9]+)-L[1-3]$/;

// Called from the Stripe `charge.refunded` fee branch: flip this PI's
// PENDING/APPROVED commissions to REVERSED via a status-guarded compare-and-set.
// PAID commissions are NEVER auto-reversed — paying money back is a human
// clawback decision — so their ids are returned for the caller to alert on.
// NOTE (M16): the webhook has never recorded a production event, so in
// production this is currently inert; approveMaturePendingCommissions below is
// the effective guard until webhook delivery is fixed.
export async function reverseCommissionsForPaymentIntent(
  piId: string,
): Promise<{ reversed: number; paidNeedingReview: string[] }> {
  if (!piId) return { reversed: 0, paidNeedingReview: [] };
  const keyPrefix = `${piId}-L`;

  const reversed = await prisma.commission.updateMany({
    where: { qualifyingEventId: { startsWith: keyPrefix }, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "REVERSED", reversedAt: new Date() },
  });

  const paid = await prisma.commission.findMany({
    where: { qualifyingEventId: { startsWith: keyPrefix }, status: "PAID" },
    select: { id: true },
  });

  return { reversed: reversed.count, paidNeedingReview: paid.map((c) => c.id) };
}

export interface ApproveMatureResult {
  candidates: number;
  approved: number;
  skippedPaymentState: number;
  skippedDealState: number;
  skippedUnverifiable: number;
}

// Hourly auto-approval (cron `affiliates`). A commission is approved only when
// it is ≥7 days old AND the money it derives from is verifiably still good:
//   • the fee PaymentIntent's charge is not refunded, partially refunded, or
//     disputed — read from Stripe directly, per the deposit reconciler pattern,
//     because webhook-delivered refund events have never been recorded in
//     production (M16);
//   • the linked deal is not CANCELLED/REFUNDED.
// Unverifiable payment state (Stripe unreachable, no charge on the intent,
// missing deal) fails CLOSED — the commission stays PENDING for a later run.
export async function approveMaturePendingCommissions(now: Date = new Date()): Promise<ApproveMatureResult> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 3600000);
  const candidates = await prisma.commission.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: { id: true, dealId: true, qualifyingEventId: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const result: ApproveMatureResult = {
    candidates: candidates.length,
    approved: 0,
    skippedPaymentState: 0,
    skippedDealState: 0,
    skippedUnverifiable: 0,
  };
  if (candidates.length === 0) return result;

  const dealIds = [...new Set(candidates.map((c) => c.dealId))];
  const deals = await prisma.deal.findMany({
    where: { id: { in: dealIds } },
    select: { id: true, status: true },
  });
  const dealStatusById = new Map(deals.map((d) => [d.id, d.status]));

  // One Stripe read per unique PI; levels of the same fee share the verdict.
  // true = money pulled back (block), false = clean, null = unverifiable.
  const { retrievePaymentIntent } = await import("@/lib/services/payment/stripe.service");
  const piVerdicts = new Map<string, boolean | null>();
  const piIds = [...new Set(
    candidates
      .map((c) => FEE_EVENT_KEY.exec(c.qualifyingEventId)?.[1])
      .filter((v): v is string => Boolean(v)),
  )];
  for (const piId of piIds) {
    try {
      const intent = (await retrievePaymentIntent(piId, { expand: ["latest_charge"] })) as {
        latest_charge?: { refunded?: boolean; amount_refunded?: number; disputed?: boolean } | string | null;
      };
      const charge = intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
      if (!charge) {
        piVerdicts.set(piId, null);
        continue;
      }
      piVerdicts.set(
        piId,
        Boolean(charge.refunded) || (charge.amount_refunded ?? 0) > 0 || Boolean(charge.disputed),
      );
    } catch (err) {
      logger.warn("[commission] payment-state check unavailable — leaving PENDING (fail closed):", { piId, err });
      piVerdicts.set(piId, null);
    }
  }

  const approveIds: string[] = [];
  for (const c of candidates) {
    const dealStatus = dealStatusById.get(c.dealId);
    if (!dealStatus) {
      result.skippedUnverifiable += 1;
      continue;
    }
    if (dealStatus === "CANCELLED" || dealStatus === "REFUNDED") {
      result.skippedDealState += 1;
      continue;
    }
    const piId = FEE_EVENT_KEY.exec(c.qualifyingEventId)?.[1];
    if (piId) {
      const verdict = piVerdicts.get(piId);
      if (verdict === null || verdict === undefined) {
        result.skippedUnverifiable += 1;
        continue;
      }
      if (verdict) {
        result.skippedPaymentState += 1;
        continue;
      }
    }
    approveIds.push(c.id);
  }

  if (approveIds.length > 0) {
    const updated = await prisma.commission.updateMany({
      where: { id: { in: approveIds }, status: "PENDING" },
      // D13 — stamp the actor on the row itself (migration 001).
      data: { status: "APPROVED", approvedAt: now, approvedBy: "system:cron" },
    });
    result.approved = updated.count;
  }
  return result;
}

// Network tree size — max 3 levels. Three bounded queries total: the previous
// version also issued one count() PER L1 child (N+1) whose results were fully
// redundant with the L2 `in` query below.
export async function getNetworkSize(affiliateId: string): Promise<{ l1: number; l2: number; l3: number }> {
  const l1 = await prisma.affiliate.findMany({
    where: { parentId: affiliateId },
    select: { id: true },
  });

  const l2Ids = await prisma.affiliate.findMany({
    where: { parentId: { in: l1.map(a => a.id) } },
    select: { id: true },
  });
  const l3 = await prisma.affiliate.count({ where: { parentId: { in: l2Ids.map(a => a.id) } } });

  return { l1: l1.length, l2: l2Ids.length, l3 };
}
