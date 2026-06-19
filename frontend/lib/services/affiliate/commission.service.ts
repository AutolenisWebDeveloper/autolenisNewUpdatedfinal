// lib/services/affiliate/commission.service.ts
// 3-level commission model — rates sourced from COMMISSION_RATES in lib/constants.ts
// D2: COMMISSION_RATES from lib/constants.ts ONLY — never inline
// Commission walk depth: maximum 3 levels — no L4 or L5

import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";
import { emitDomainEvent } from "@/lib/events/emit";
import { logger } from "@/lib/logger";

// Walk affiliate tree up to 3 levels and create commissions (idempotent)
export async function walkCommissionTree(
  dealId: string,
  buyerAffiliateId: string | null | undefined,
  qualifyingEventId: string
): Promise<void> {
  if (!buyerAffiliateId) return;

  const affiliate = await prisma.affiliate.findUnique({
    where: { id: buyerAffiliateId },
    include: { parent: { include: { parent: true } } },
  });
  if (!affiliate) return;

  const levels = [
    { affiliate, rate: COMMISSION_RATES.LEVEL_1, level: 1 },
    affiliate.parent ? { affiliate: affiliate.parent, rate: COMMISSION_RATES.LEVEL_2, level: 2 } : null,
    affiliate.parent?.parent ? { affiliate: affiliate.parent.parent, rate: COMMISSION_RATES.LEVEL_3, level: 3 } : null,
  ].filter(Boolean) as Array<{ affiliate: { id: string }; rate: number; level: number }>;

  // Commission is idempotent — check before creating
  for (const entry of levels) {
    const key = `${qualifyingEventId}-L${entry.level}`;
    const existing = await prisma.commission.findUnique({ where: { qualifyingEventId: key } });
    if (existing) continue;

    const amountCents = Math.round(PREMIUM_FEE_CENTS * entry.rate);
    await prisma.commission.create({
      data: {
        affiliateId: entry.affiliate.id,
        dealId,
        level: entry.level,
        rate: entry.rate,
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

// Commission summary for an affiliate
export async function getCommissionSummary(affiliateId: string) {
  const [paid, approved, pendingReview, total] = await Promise.all([
    prisma.commission.aggregate({ where: { affiliateId, status: "PAID" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({ where: { affiliateId, status: "APPROVED" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({ where: { affiliateId, status: "PENDING" }, _sum: { amountCents: true } }),
    prisma.commission.aggregate({ where: { affiliateId }, _sum: { amountCents: true } }),
  ]);

  const approvedCents = approved._sum.amountCents ?? 0;
  const pendingReviewCents = pendingReview._sum.amountCents ?? 0;

  return {
    paidCents: paid._sum.amountCents ?? 0,
    // approvedCents: admin-approved commissions ready to be requested as a payout
    approvedCents,
    // pendingCents: combined APPROVED + PENDING — used for dashboard/earnings "awaiting payout" display
    pendingCents: approvedCents + pendingReviewCents,
    // pendingReviewCents: commissions awaiting admin approval (not yet payable)
    pendingReviewCents,
    totalCents: total._sum.amountCents ?? 0,
  };
}

// Network tree size — max 3 levels
export async function getNetworkSize(affiliateId: string): Promise<{ l1: number; l2: number; l3: number }> {
  const l1 = await prisma.affiliate.findMany({
    where: { parentId: affiliateId },
    select: { id: true },
  });

  const l2Promises = l1.map(a => prisma.affiliate.count({ where: { parentId: a.id } }));
  const l2Counts = await Promise.all(l2Promises);
  const l2Total = l2Counts.reduce((s, c) => s + c, 0);

  const l2Ids = await prisma.affiliate.findMany({
    where: { parentId: { in: l1.map(a => a.id) } },
    select: { id: true },
  });
  const l3 = await prisma.affiliate.count({ where: { parentId: { in: l2Ids.map(a => a.id) } } });

  return { l1: l1.length, l2: l2Total, l3 };
}
