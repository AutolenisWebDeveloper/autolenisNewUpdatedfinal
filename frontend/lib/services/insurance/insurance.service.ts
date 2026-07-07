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

// Bind a platform-sourced policy with the insurer. There is NO real insurance
// provider integration yet, so this must NOT fabricate a POLICY_BOUND status —
// a bound policy is a real financial/coverage fact and cannot be asserted
// without an actual bind confirmation. Fail closed: record the buyer's selected
// quote and route the deal to manual admin binding rather than silently
// marking it bound.
export async function bindPolicy(dealId: string, quoteId: string): Promise<void> {
  // Record the buyer's selection (safe, truthful) …
  await prisma.insuranceQuote.update({ where: { id: quoteId }, data: { status: "SELECTED" } });
  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.POLICY_SELECTED },
  });

  // … but do NOT assert POLICY_BOUND without a real provider bind confirmation.
  // Fail closed so no automated path can fabricate coverage; an admin binds the
  // policy manually (markInsuranceBound) once the insurer confirms.
  throw new Error(
    "Insurance provider binding is not configured — quote recorded as SELECTED and " +
    "flagged for manual admin binding. POLICY_BOUND must not be set automatically.",
  );
}

// Record a buyer's uploaded external proof of insurance as PENDING admin
// verification. Fail closed: the policy row is created UNVERIFIED (no verifiedAt
// / verifiedBy) and the deal is set to EXTERNAL_UPLOADED ("under review") — it
// is NEVER auto-marked VERIFIED. An admin must review the proof and call
// verifyExternalPolicy() to complete verification (human-in-the-loop).
export async function verifyExternalProof(buyerId: string, dealId: string, proofUrl: string): Promise<string> {
  const policy = await prisma.insurancePolicy.create({
    data: { buyerId, dealId, proofUrl, isExternal: true, status: "ACTIVE", verifiedAt: null, verifiedBy: null },
  });

  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.EXTERNAL_UPLOADED },
  });

  return policy.id;
}

// Human-in-the-loop verification of an uploaded external proof. Stamps the
// verifying admin + timestamp on the policy and advances the deal to VERIFIED.
// Only an authenticated admin action should reach this.
export async function verifyExternalPolicy(policyId: string, dealId: string, adminEmail: string): Promise<void> {
  await prisma.insurancePolicy.update({
    where: { id: policyId },
    data: { verifiedAt: new Date(), verifiedBy: adminEmail },
  });
  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.VERIFIED },
  });
}

// Explicit admin action to record a real insurer-confirmed bind. Separate from
// bindPolicy so the only path to POLICY_BOUND is a deliberate human action with
// the insurer's confirmation in hand — never an automated flip.
export async function markInsuranceBound(dealId: string): Promise<void> {
  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.POLICY_BOUND },
  });
}

export async function markInsuranceVerified(dealId: string): Promise<void> {
  await prisma.deal.update({
    where: { id: dealId },
    data: { insuranceStatus: InsuranceStatus.VERIFIED },
  });
}
