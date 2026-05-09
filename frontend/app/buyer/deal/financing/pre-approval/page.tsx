// Feature 18 — Financing Pre-Approval Display (Phase 3 — Buyer Deal Confidence)
// Shows real financing data from DB: ExternalPreApproval records, Financing record on active deal.
// If no pre-approval data exists, shows an informative empty state + monthly payment calculator.
// RULE: No fake lender approvals. No claimed approval if not in DB.

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import FinancingPreApprovalClient from "./FinancingPreApprovalClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Financing Pre-Approval — AutoLenis" };
export const dynamic = "force-dynamic";

export default async function FinancingPreApprovalPage() {
  const buyer = await requireBuyer();

  // Fetch external pre-approvals (buyer-uploaded bank/CU letters)
  const preApprovals = await prisma.externalPreApproval.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, lenderName: true,
      approvedAmountCents: true, aprRate: true, termMonths: true,
      expiryDate: true, createdAt: true, rejectionReason: true,
    },
  });

  // Fetch Financing record on the active deal (dealer-side confirmed financing)
  const activeDeal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id, status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, financingPath: true,
      financing: {
        select: {
          id: true, path: true, status: true, lenderName: true,
          approvedAmountCents: true, aprRate: true, termMonths: true,
          monthlyPaymentCents: true,
        },
      },
      offer: {
        select: { otdPriceCents: true },
      },
    },
  });

  // Fetch saved financing scenarios (buyer-computed scenarios)
  const scenarios = await prisma.financingScenario.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true, name: true, vehiclePriceCents: true, downPaymentCents: true,
      loanAmountCents: true, aprRate: true, termMonths: true,
      monthlyPaymentCents: true, totalCostCents: true, createdAt: true,
    },
  });

  const serialized = {
    preApprovals: preApprovals.map(p => ({
      ...p,
      expiryDate: p.expiryDate?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    activeDeal: activeDeal ? {
      ...activeDeal,
      financing: activeDeal.financing ?? null,
    } : null,
    scenarios: scenarios.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
    dealPriceCents: activeDeal?.offer?.otdPriceCents ?? null,
  };

  return <FinancingPreApprovalClient data={serialized} />;
}
