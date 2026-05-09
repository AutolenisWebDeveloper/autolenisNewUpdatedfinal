// lib/services/affiliate/affiliate.service.ts
import { prisma } from "@/lib/prisma";
import { AffiliateStatus } from "@prisma/client";
import crypto from "crypto";

export async function registerAffiliate(userId: string, parentReferralCode?: string) {
  const referralCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  let parentId: string | undefined;

  if (parentReferralCode) {
    const parent = await prisma.affiliate.findFirst({ where: { referralCode: parentReferralCode, status: "ACTIVE" } });
    if (parent) parentId = parent.id;
  }

  return prisma.affiliate.create({
    data: { userId, referralCode, status: AffiliateStatus.PENDING, level: parentId ? 2 : 1, parentId },
  });
}

export async function activateAffiliate(affiliateId: string) {
  return prisma.affiliate.update({ where: { id: affiliateId }, data: { status: AffiliateStatus.ACTIVE } });
}

export async function getAffiliateWithStats(affiliateId: string) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    include: { user: true, commissions: { select: { amountCents: true, status: true, level: true } }, children: { select: { id: true } } },
  });
  if (!affiliate) return null;
  const totalEarned = affiliate.commissions.filter(c => c.status !== "REVERSED").reduce((s, c) => s + c.amountCents, 0);
  const pending = affiliate.commissions.filter(c => c.status === "PENDING" || c.status === "APPROVED").reduce((s, c) => s + c.amountCents, 0);
  return { ...affiliate, totalEarned, pendingPayout: pending, networkCount: affiliate.children.length };
}
