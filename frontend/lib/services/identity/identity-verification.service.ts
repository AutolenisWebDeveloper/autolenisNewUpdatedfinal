// lib/services/identity/identity-verification.service.ts
import { prisma } from "@/lib/prisma";

export async function recordCreditInquiry(buyerId: string, prequalId: string, resultSummary?: string) {
  return prisma.buyerCreditHistory.create({
    data: { buyerId, prequalId, inquiryType: "SOFT_PULL", provider: "MicroBilt", resultSummary },
  });
}

export async function getBuyerCreditHistory(buyerId: string) {
  return prisma.buyerCreditHistory.findMany({ where: { buyerId }, orderBy: { conductedAt: "desc" } });
}
