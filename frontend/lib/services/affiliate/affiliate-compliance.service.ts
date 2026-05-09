// lib/services/affiliate/affiliate-compliance.service.ts
import { prisma } from "@/lib/prisma";
import { AffiliateComplianceStatus } from "@prisma/client";

export async function recordAcknowledgment(affiliateId: string, disclosureVersion: string) {
  return prisma.affiliateComplianceRecord.upsert({
    where: { affiliateId },
    create: { affiliateId, status: AffiliateComplianceStatus.COMPLIANT, acknowledgedAt: new Date(), disclosureVersion },
    update: { status: AffiliateComplianceStatus.COMPLIANT, acknowledgedAt: new Date(), disclosureVersion },
  });
}

export async function getComplianceStatus(affiliateId: string) {
  return prisma.affiliateComplianceRecord.findUnique({ where: { affiliateId } });
}

export async function isComplianceComplete(affiliateId: string): Promise<boolean> {
  const record = await getComplianceStatus(affiliateId);
  return record?.status === AffiliateComplianceStatus.COMPLIANT;
}
