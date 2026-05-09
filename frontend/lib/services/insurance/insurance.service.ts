// lib/services/insurance/insurance.service.ts
// System 7 — Insurance quote, bind, external proof
// Mock gated behind NODE_ENV !== 'production' (D5)

import { prisma } from "@/lib/prisma";
import { InsuranceStatus } from "@prisma/client";

export async function requestQuote(buyerId: string, dealId: string): Promise<{ quoteId: string; premiumCents: number; isMock: boolean }> {
  const isMock = process.env.NODE_ENV !== "production";

  if (isMock) {
    // Mock quote — only in development (D5 gate)
    const quote = await prisma.insuranceQuote.create({
      data: {
        buyerId,
        dealId,
        status: "RECEIVED",
        providerName: "MockCoverage Inc.",
        premiumCents: 12000, // $120/month mock
        coverageType: "Full Coverage",
        deductibleCents: 50000,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isMock: true,
      },
    });

    await prisma.deal.update({
      where: { id: dealId },
      data: { insuranceStatus: InsuranceStatus.QUOTE_RECEIVED },
    });

    return { quoteId: quote.id, premiumCents: quote.premiumCents!, isMock: true };
  }

  // Production: call real insurance provider API
  // TODO: integrate with real insurance API
  throw new Error("Insurance API not configured for production");
}

export async function bindPolicy(dealId: string, quoteId: string): Promise<void> {
  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.POLICY_BOUND },
  });
  await prisma.insuranceQuote.update({ where: { id: quoteId }, data: { status: "SELECTED" } });
}

export async function verifyExternalProof(buyerId: string, dealId: string, proofUrl: string): Promise<void> {
  await prisma.insurancePolicy.create({
    data: { buyerId, dealId, proofUrl, isExternal: true, status: "ACTIVE", verifiedAt: new Date() },
  });

  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.EXTERNAL_UPLOADED },
  });
}

export async function markInsuranceVerified(dealId: string): Promise<void> {
  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.VERIFIED },
  });
}
