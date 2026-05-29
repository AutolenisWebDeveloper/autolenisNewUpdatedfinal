// /admin/prequal/[id] — Admin prequal detail + review page.
//
// Full single-record view of a PreQualification with all risk detail and the
// manual-decision action panel (Approve / Decline / Override) for records in
// MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED / PENDING.
//
// Routed to from:
//   - /admin/buyers/[buyerId] "View Prequal" link
//   - /admin/manual-reviews "Review" button
//   - /admin/prequal list rows

import { notFound } from "next/navigation";
import { requireAdminRole } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import PrequalDetailClient from "./PrequalDetailClient";
import type { PrequalDetailData } from "./PrequalDetailClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminPrequalDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requireAdminRole(["SUPER_ADMIN", "COMPLIANCE_ADMIN", "OPERATIONS_ADMIN"]);

  const prequal = await prisma.preQualification.findUnique({
    where: { id },
    include: {
      buyer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          user: { select: { email: true } },
        },
      },
      consents: {
        orderBy: { acceptedAt: "desc" },
        take: 1,
      },
      complianceEvents: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
  });

  if (!prequal) notFound();

  const isSuperAdmin = admin.role === "SUPER_ADMIN";
  const rawResponseSnippet =
    isSuperAdmin && prequal.rawResponse
      ? {
          length: prequal.rawResponse.length,
          preview: prequal.rawResponse.slice(0, 100),
        }
      : null;

  const data: PrequalDetailData = {
    id: prequal.id,
    buyer: {
      id: prequal.buyer.id,
      firstName: prequal.buyer.firstName,
      lastName: prequal.buyer.lastName,
      email: prequal.buyer.user.email,
      phone: prequal.buyer.phone,
    },
    decision: prequal.decision,
    tier: prequal.tier,
    maxOtdAmountCents: prequal.maxOtdAmountCents,
    expiresAt: prequal.expiresAt.toISOString(),
    createdAt: prequal.createdAt.toISOString(),
    updatedAt: prequal.updatedAt.toISOString(),
    isExternal: prequal.isExternal,
    hasRawResponse: !!prequal.rawResponse,
    checkOfacAlert: prequal.checkOfacAlert,
    rawResponseSnippet,
    canViewRawResponse: isSuperAdmin,
    risk: {
      creditScore: prequal.creditScore,
      idvScore: prequal.idvScore,
      mlaCovered: prequal.mlaCovered,
      fraudWarning: prequal.fraudWarning,
      deceasedFlag: prequal.deceasedFlag,
      bankruptcyFlag: prequal.bankruptcyFlag,
      adverseReasonCodes: prequal.adverseReasonCodes,
    },
    financial: {
      housingStatus: prequal.housingStatus,
      monthlyHousingPaymentCents: prequal.monthlyHousingPaymentCents,
      monthlyOtherDebtCents: prequal.monthlyOtherDebtCents,
      effectiveIncomeCents: prequal.effectiveIncomeCents,
      monthlyIncomeCents: prequal.monthlyIncomeCents,
      frontEndDtiBps: prequal.frontEndDtiBps,
      backEndDtiBps: prequal.backEndDtiBps,
      benchmarkAprBps: prequal.benchmarkAprBps,
    },
    employment: {
      employmentStatus: prequal.employmentStatus,
      employerName: prequal.employerName,
      lengthOfEmployment: prequal.lengthOfEmployment,
      monthlyIncomeCents: prequal.monthlyIncomeCents,
    },
    consent: prequal.consents[0]
      ? {
          acceptedAt: prequal.consents[0].acceptedAt.toISOString(),
          userAgent: prequal.consents[0].userAgent,
          ipAddress: prequal.consents[0].ipAddress,
          termsVersion: prequal.consents[0].termsVersion,
          consentText: prequal.consents[0].consentText,
        }
      : null,
    complianceEvents: prequal.complianceEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt.toISOString(),
    })),
  };

  return <PrequalDetailClient data={data} />;
}
