// lib/services/admin/admin-buyer-command-center.service.ts
// Admin Buyer Command Center — service layer for all buyer admin operations
// V4 requirement: Admin console is command-and-control, not passive reporting.

import { prisma } from "@/lib/prisma";
import { DealStatus } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuyerListFilters {
  q?: string;
  status?: string;
  prequalStatus?: string;
  onboardingStatus?: string;
  dealStatus?: string;
  paymentStatus?: string;
  exceptionOnly?: boolean;
  /** "active" | "archived" | "disabled" | "purged" | "all" — default "active" */
  lifecycleStatus?: string;
  page?: number;
  perPage?: number;
}

export interface AdminBuyerKpis {
  total: number;
  active: number;
  pendingOnboarding: number;
  prequalified: number;
  withActiveDeals: number;
  needingAction: number;
  paymentIssues: number;
  exceptionCases: number;
}

export interface BuyerActionAvailability {
  canInvite: boolean;
  canStartOnboarding: boolean;
  canPauseWorkflow: boolean;
  canResumeWorkflow: boolean;
  canCancelWorkflow: boolean;
  canMoveWorkflow: boolean;
  canMarkException: boolean;
  canResolveException: boolean;
  currentExceptionActive: boolean;
  hasActiveDeal: boolean;
  hasActiveAuction: boolean;
  activeDealId: string | null;
  activeAuctionId: string | null;
  activeDealStatus: string | null;
  // Lifecycle
  isArchived: boolean;
  isDisabled: boolean;
  isPurged: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canDisable: boolean;
  canReactivate: boolean;
}

// ─── KPI Aggregation ─────────────────────────────────────────────────────────

export async function getAdminBuyerKpis(): Promise<AdminBuyerKpis> {
  const ACTIVE_DEAL_STATUSES: DealStatus[] = [
    DealStatus.ACTIVE,
    DealStatus.FINANCING_PENDING,
    DealStatus.FEE_PENDING,
    DealStatus.FEE_PAID,
    DealStatus.INSURANCE_PENDING,
    DealStatus.CONTRACT_PENDING,
    DealStatus.CONTRACT_REVIEW,
    DealStatus.CONTRACT_APPROVED,
    DealStatus.SIGNING_PENDING,
    DealStatus.SIGNED,
    DealStatus.PICKUP_SCHEDULED,
    DealStatus.PICKUP_COMPLETE,
  ];

  const [
    total,
    active,
    pendingOnboarding,
    prequalified,
    buyersWithActiveDeals,
    paymentIssues,
    exceptionAuditLogs,
    resolvedExceptions,
  ] = await Promise.all([
    prisma.buyer.count(),
    prisma.buyer.count({ where: { onboardingComplete: true } }),
    prisma.buyer.count({ where: { onboardingComplete: false } }),
    prisma.preQualification.count(),
    prisma.deal.groupBy({
      by: ["buyerId"],
      where: { status: { in: ACTIVE_DEAL_STATUSES } },
    }).then((rows) => rows.length),
    prisma.deposit.count({ where: { status: "FAILED" } }),
    prisma.adminAuditLog.findMany({
      where: { action: "BUYER_EXCEPTION_FLAGGED", entityType: "Buyer" },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "BUYER_EXCEPTION_RESOLVED", entityType: "Buyer" },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
  ]);

  const resolvedIds = new Set(resolvedExceptions.map((r) => r.entityId));
  const exceptionCases = exceptionAuditLogs.filter(
    (e) => !resolvedIds.has(e.entityId)
  ).length;

  // "Needing action" = unresolved exceptions + payment issues signal
  const needingAction = exceptionCases + (paymentIssues > 0 ? 1 : 0);

  return {
    total,
    active,
    pendingOnboarding,
    prequalified,
    withActiveDeals: buyersWithActiveDeals,
    needingAction,
    paymentIssues,
    exceptionCases,
  };
}

// ─── Buyer List ───────────────────────────────────────────────────────────────

export async function getAdminBuyerListData(filters: BuyerListFilters = {}) {
  const { q, onboardingStatus, exceptionOnly, lifecycleStatus = "active", page = 1, perPage = 50 } = filters;

  // Build where clause
  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }
  if (onboardingStatus === "complete") where.onboardingComplete = true;
  if (onboardingStatus === "pending") where.onboardingComplete = false;

  // Lifecycle filter
  if (lifecycleStatus === "active") {
    where.archivedAt = null;
    where.disabledAt = null;
    where.purgedAt   = null;
  } else if (lifecycleStatus === "archived") {
    where.archivedAt = { not: null };
  } else if (lifecycleStatus === "disabled") {
    where.disabledAt = { not: null };
  } else if (lifecycleStatus === "purged") {
    where.purgedAt = { not: null };
  }
  // lifecycleStatus === "all" → no extra filter

  const [buyers, total] = await Promise.all([
    prisma.buyer.findMany({
      where,
      include: {
        user: { select: { email: true, createdAt: true } },
        preQualification: { select: { decision: true, maxOtdAmountCents: true, expiresAt: true } },
        deals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
        deposits: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
        auctions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.buyer.count({ where }),
  ]);

  // Fetch exception status for each buyer efficiently
  const buyerIds = buyers.map((b) => b.id);
  const [flaggedLogs, resolvedLogs, assignedLogs] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where: { action: "BUYER_EXCEPTION_FLAGGED", entityType: "Buyer", entityId: { in: buyerIds } },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "BUYER_EXCEPTION_RESOLVED", entityType: "Buyer", entityId: { in: buyerIds } },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "BUYER_ASSIGNED", entityType: "Buyer", entityId: { in: buyerIds } },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, adminEmail: true, metadata: true },
    }),
  ]);

  const resolvedIds = new Set(resolvedLogs.map((r) => r.entityId));
  const flaggedIds = new Set(
    flaggedLogs.filter((f) => !resolvedIds.has(f.entityId)).map((f) => f.entityId)
  );
  const assignedMap = new Map<string, string>();
  for (const log of assignedLogs) {
    if (!assignedMap.has(log.entityId)) {
      const meta = log.metadata as Record<string, string> | null;
      const assignedTo = meta?.assignedTo;
      if (assignedTo) assignedMap.set(log.entityId, assignedTo);
    }
  }

  const rows = buyers.map((b) => ({
    id: b.id,
    firstName: b.firstName,
    lastName: b.lastName,
    email: b.user.email,
    phone: b.phone ?? null,
    onboardingComplete: b.onboardingComplete,
    plan: b.plan,
    prequalDecision: b.preQualification?.decision ?? null,
    maxOtdAmountCents: b.preQualification?.maxOtdAmountCents ?? null,
    prequalExpiresAt: b.preQualification?.expiresAt?.toISOString() ?? null,
    activeDealStatus: b.deals[0]?.status ?? null,
    activeDealId: b.deals[0]?.id ?? null,
    activeAuctionStatus: b.auctions[0]?.status ?? null,
    latestDepositStatus: b.deposits[0]?.status ?? null,
    isException: flaggedIds.has(b.id),
    assignedAdmin: assignedMap.get(b.id) ?? null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    disabledAt: b.disabledAt?.toISOString() ?? null,
    purgedAt: b.purgedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  // Apply exception filter after enrichment if needed
  const filtered = exceptionOnly ? rows.filter((r) => r.isException) : rows;

  return {
    buyers: filtered,
    total: exceptionOnly ? filtered.length : total,
    page,
    perPage,
  };
}

// ─── Buyer Detail ─────────────────────────────────────────────────────────────

export async function getAdminBuyerDetailData(buyerId: string) {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      user: { select: { email: true, createdAt: true, supabaseId: true } },
      preQualification: true,
      externalPreApprovals: { orderBy: { createdAt: "desc" }, take: 3 },
      deals: {
        orderBy: { createdAt: "desc" },
        include: {
          offer: {
            select: {
              otdPriceCents: true,
              dealerId: true,
              dealer: { select: { dealershipName: true, city: true, state: true } },
            },
          },
          eSignEnvelope: true,
          pickup: true,
          financing: true,
          contractVersions: { orderBy: { uploadedAt: "desc" }, take: 1 },
          contractScans: { orderBy: { scannedAt: "desc" }, take: 1 },
        },
      },
      auctions: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          offers: { select: { id: true, status: true, otdPriceCents: true } },
          _count: { select: { invitations: true } },
        },
      },
      deposits: { orderBy: { createdAt: "desc" } },
      notifications: { orderBy: { createdAt: "desc" }, take: 10 },
      vehicleRequests: { orderBy: { createdAt: "desc" }, take: 5 },
      shortlists: { include: { items: { select: { id: true } } } },
      activityEvents: { orderBy: { createdAt: "desc" }, take: 30 },
      insurancePolicies: { orderBy: { createdAt: "desc" }, take: 3 },
      insuranceQuotes: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });

  if (!buyer) return null;

  // Fetch documents
  const documents = await prisma.document.findMany({
    where: { buyerId },
    orderBy: { uploadedAt: "desc" },
    take: 20,
  });

  // Fetch audit logs
  const auditLogs = await prisma.adminAuditLog.findMany({
    where: { entityType: "Buyer", entityId: buyerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Fetch support notes
  const supportNotes = await prisma.adminSupportNote.findMany({
    where: { targetUserId: buyer.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Fetch deal payment history (concierge fees)
  const dealIds = buyer.deals.map((d) => d.id);
  const serviceFeePayments =
    dealIds.length > 0
      ? await prisma.serviceFeePayment.findMany({
          where: { dealId: { in: dealIds } },
        })
      : [];

  // Derive exception status from audit logs
  const exceptionLogs = auditLogs.filter(
    (l) =>
      l.action === "BUYER_EXCEPTION_FLAGGED" || l.action === "BUYER_EXCEPTION_RESOLVED"
  );
  let currentExceptionActive = false;
  let currentExceptionReason: string | null = null;
  if (exceptionLogs.length > 0) {
    const latest = exceptionLogs[0];
    currentExceptionActive = latest.action === "BUYER_EXCEPTION_FLAGGED";
    currentExceptionReason = currentExceptionActive ? (latest.reason ?? null) : null;
  }

  // Derive assigned admin — metadata.assignedTo is the assigned admin email/ID
  const assignLog = auditLogs.find((l) => l.action === "BUYER_ASSIGNED");
  const assignedAdmin = assignLog
    ? ((assignLog.metadata as Record<string, string> | null)?.assignedTo ?? null)
    : null;

  return {
    buyer: {
      id: buyer.id,
      firstName: buyer.firstName,
      lastName: buyer.lastName,
      phone: buyer.phone,
      address: buyer.address,
      city: buyer.city,
      state: buyer.state,
      zip: buyer.zip,
      email: buyer.user.email,
      supabaseId: buyer.user.supabaseId,
      plan: buyer.plan,
      planUpgradedAt: buyer.planUpgradedAt?.toISOString() ?? null,
      onboardingComplete: buyer.onboardingComplete,
      termsAcceptedAt: buyer.termsAcceptedAt?.toISOString() ?? null,
      employmentStatus: buyer.employmentStatus,
      incomeRange: buyer.incomeRange,
      affiliateId: buyer.affiliateId,
      // Lifecycle
      archivedAt: buyer.archivedAt?.toISOString() ?? null,
      disabledAt: buyer.disabledAt?.toISOString() ?? null,
      purgedAt: buyer.purgedAt?.toISOString() ?? null,
      // Suspension
      isSuspended: buyer.isSuspended,
      suspendedAt: buyer.suspendedAt?.toISOString() ?? null,
      suspendedReason: buyer.suspendedReason ?? null,
      createdAt: buyer.createdAt.toISOString(),
      updatedAt: buyer.updatedAt.toISOString(),
    },
    preQualification: buyer.preQualification
      ? {
          id: buyer.preQualification.id,
          decision: buyer.preQualification.decision,
          tier: buyer.preQualification.tier,
          maxOtdAmountCents: buyer.preQualification.maxOtdAmountCents,
          expiresAt: buyer.preQualification.expiresAt.toISOString(),
          checkOfacAlert: buyer.preQualification.checkOfacAlert,
          isExternal: buyer.preQualification.isExternal,
          createdAt: buyer.preQualification.createdAt.toISOString(),
          updatedAt: buyer.preQualification.updatedAt.toISOString(),
        }
      : null,
    externalPreApprovals: buyer.externalPreApprovals.map((e) => ({
      id: e.id,
      status: e.status,
      lenderName: e.lenderName,
      approvedAmountCents: e.approvedAmountCents,
      aprRate: e.aprRate,
      termMonths: e.termMonths,
      expiryDate: e.expiryDate?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    deals: buyer.deals.map((d) => ({
      id: d.id,
      status: d.status,
      financingPath: d.financingPath,
      insuranceStatus: d.insuranceStatus,
      feePaidAt: d.feePaidAt?.toISOString() ?? null,
      feeAmountCents: d.feeAmountCents,
      stripeFeePIId: d.stripeFeePIId,
      feeRefundedAt: d.feeRefundedAt?.toISOString() ?? null,
      feeRefundedAmountCents: d.feeRefundedAmountCents,
      contractShieldScore: d.contractShieldScore,
      contractShieldStatus: d.contractShieldStatus,
      riskScore: d.riskScore,
      riskTier: d.riskTier,
      createdAt: d.createdAt.toISOString(),
      offer: d.offer
        ? {
            otdPriceCents: d.offer.otdPriceCents,
            dealerId: d.offer.dealerId,
            dealerName: d.offer.dealer.dealershipName,
            dealerCity: d.offer.dealer.city,
            dealerState: d.offer.dealer.state,
          }
        : null,
      eSignEnvelope: d.eSignEnvelope
        ? {
            status: d.eSignEnvelope.status,
            docusignEnvelopeId: d.eSignEnvelope.docusignEnvelopeId,
            sentAt: d.eSignEnvelope.sentAt?.toISOString() ?? null,
            completedAt: d.eSignEnvelope.completedAt?.toISOString() ?? null,
          }
        : null,
      pickup: d.pickup
        ? {
            status: d.pickup.status,
            scheduledAt: d.pickup.scheduledAt?.toISOString() ?? null,
            completedAt: d.pickup.completedAt?.toISOString() ?? null,
            location: d.pickup.location,
            qrCodeImage: d.pickup.qrCodeImage,
          }
        : null,
      financing: d.financing
        ? {
            path: d.financing.path,
            lenderName: d.financing.lenderName,
            approvedAmountCents: d.financing.approvedAmountCents,
            aprRate: d.financing.aprRate,
            termMonths: d.financing.termMonths,
            monthlyPaymentCents: d.financing.monthlyPaymentCents,
            status: d.financing.status,
          }
        : null,
      latestContractVersion: d.contractVersions[0]
        ? {
            status: d.contractVersions[0].status,
            version: d.contractVersions[0].version,
            uploadedAt: d.contractVersions[0].uploadedAt.toISOString(),
          }
        : null,
      latestContractScan: d.contractScans[0]
        ? {
            status: d.contractScans[0].status,
            score: d.contractScans[0].score,
            fixListCount: Array.isArray(d.contractScans[0].fixList)
              ? (d.contractScans[0].fixList as unknown[]).length
              : 0,
          }
        : null,
      serviceFeePayment: (() => {
        const sfp = serviceFeePayments.find((s) => s.dealId === d.id);
        return sfp
          ? { amountCents: sfp.amountCents, netAmountCents: sfp.netAmountCents, paidAt: sfp.paidAt?.toISOString() ?? null }
          : null;
      })(),
    })),
    auctions: buyer.auctions.map((a) => ({
      id: a.id,
      status: a.status,
      startedAt: a.startedAt?.toISOString() ?? null,
      endsAt: a.endsAt?.toISOString() ?? null,
      closedAt: a.closedAt?.toISOString() ?? null,
      offerCount: a.offers.length,
      invitationCount: a._count.invitations,
      createdAt: a.createdAt.toISOString(),
    })),
    deposits: buyer.deposits.map((d) => ({
      id: d.id,
      amountCents: d.amountCents,
      status: d.status,
      stripePaymentIntentId: d.stripePaymentIntentId,
      refundedAt: d.refundedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
    documents: documents.map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      isVerified: d.isVerified,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    insurancePolicies: buyer.insurancePolicies.map((p) => ({
      id: p.id,
      status: p.status,
      providerName: p.providerName,
      policyNumber: p.policyNumber,
      proofUrl: p.proofUrl,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
    })),
    insuranceQuotes: buyer.insuranceQuotes.map((q) => ({
      id: q.id,
      status: q.status,
      providerName: q.providerName,
      premiumCents: q.premiumCents,
      createdAt: q.createdAt.toISOString(),
    })),
    shortlistCount: buyer.shortlists?.items?.length ?? 0,
    vehicleRequests: buyer.vehicleRequests.map((r) => ({
      id: r.id,
      status: r.status,
      makePreference: r.makePreference,
      modelPreference: r.modelPreference,
      createdAt: r.createdAt.toISOString(),
    })),
    activityEvents: buyer.activityEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      title: e.title,
      createdAt: e.createdAt.toISOString(),
    })),
    auditLogs: auditLogs.map((l) => ({
      id: l.id,
      action: l.action,
      adminEmail: l.adminEmail,
      reason: l.reason,
      metadata: l.metadata,
      createdAt: l.createdAt.toISOString(),
    })),
    supportNotes: supportNotes.map((n) => ({
      id: n.id,
      type: n.type,
      content: n.content,
      adminId: n.adminId,
      createdAt: n.createdAt.toISOString(),
    })),
    exceptionStatus: {
      isActive: currentExceptionActive,
      reason: currentExceptionReason,
    },
    assignedAdmin,
  };
}

// ─── Action Availability ──────────────────────────────────────────────────────

export async function getAdminBuyerActionAvailability(
  buyerId: string
): Promise<BuyerActionAvailability> {
  const [buyer, activeAuction, activeDeal, exceptionFlagged, exceptionResolved] =
    await Promise.all([
      prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { onboardingComplete: true, archivedAt: true, disabledAt: true, purgedAt: true },
      }),
      prisma.auction.findFirst({
        where: { buyerId, status: { in: ["PENDING", "ACTIVE"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      }),
      prisma.deal.findFirst({
        where: {
          buyerId,
          status: {
            notIn: [DealStatus.CANCELLED, DealStatus.COMPLETED, DealStatus.REFUNDED],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      }),
      prisma.adminAuditLog.findFirst({
        where: { action: "BUYER_EXCEPTION_FLAGGED", entityType: "Buyer", entityId: buyerId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.adminAuditLog.findFirst({
        where: { action: "BUYER_EXCEPTION_RESOLVED", entityType: "Buyer", entityId: buyerId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
    ]);

  const currentExceptionActive =
    !!exceptionFlagged &&
    (!exceptionResolved || exceptionFlagged.createdAt > exceptionResolved.createdAt);

  const isArchived = !!buyer?.archivedAt;
  const isDisabled = !!buyer?.disabledAt;
  const isPurged   = !!buyer?.purgedAt;

  return {
    canInvite: true, // Always available
    canStartOnboarding: !buyer?.onboardingComplete,
    canPauseWorkflow: !!activeAuction && activeAuction.status === "ACTIVE",
    canResumeWorkflow: !!activeAuction && activeAuction.status === "PENDING",
    canCancelWorkflow: !!activeDeal,
    canMoveWorkflow: !!activeDeal,
    canMarkException: !currentExceptionActive,
    canResolveException: currentExceptionActive,
    currentExceptionActive,
    hasActiveDeal: !!activeDeal,
    hasActiveAuction: !!activeAuction,
    activeDealId: activeDeal?.id ?? null,
    activeAuctionId: activeAuction?.id ?? null,
    activeDealStatus: activeDeal?.status ?? null,
    // Lifecycle
    isArchived,
    isDisabled,
    isPurged,
    canArchive:     !isArchived && !isPurged,
    canRestore:     isArchived,
    canDisable:     !isDisabled && !isPurged,
    canReactivate:  isDisabled && !isPurged,
  };
}

// ─── Action Functions ─────────────────────────────────────────────────────────

export async function updateBuyerProfileByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    employmentStatus?: string;
    incomeRange?: string;
    reason: string;
  }
) {
  const { reason, ...profileData } = data;
  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: profileData,
  });
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_PROFILE_UPDATED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: profileData as object,
    },
  });
  return updated;
}

export async function assignBuyerToAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  assignedTo: string,
  reason: string
) {
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_ASSIGNED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { assignedTo },
    },
  });
  return { assignedTo };
}

export async function triggerBuyerReminder(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  message: string,
  reason: string
) {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { userId: true },
  });
  if (!buyer) throw new Error("Buyer not found");

  await prisma.notification.create({
    data: {
      buyerId,
      type: "ADMIN_MESSAGE",
      title: "Message from AutoLenis Team",
      body: message,
      actionUrl: "/buyer/dashboard",
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_REMINDER_SENT",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { message },
    },
  });

  return { notified: true };
}

export async function markBuyerException(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_EXCEPTION_FLAGGED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { flaggedAt: new Date().toISOString() },
    },
  });
  return { flagged: true };
}

export async function resolveBuyerException(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_EXCEPTION_RESOLVED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { resolvedAt: new Date().toISOString() },
    },
  });
  return { resolved: true };
}

export async function pauseBuyerWorkflow(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  auctionId: string,
  reason: string
) {
  // Pausing workflow = setting auction to CANCELLED (temporarily)
  // Only ACTIVE auctions can be paused
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId, status: "ACTIVE" },
  });
  if (!auction) throw new Error("No active auction found for this buyer");

  await prisma.auction.update({
    where: { id: auctionId },
    data: { status: "CANCELLED" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_WORKFLOW_PAUSED",
      entityType: "Auction",
      entityId: auctionId,
      reason,
      metadata: { buyerId, previousStatus: "ACTIVE" },
    },
  });

  return { paused: true };
}

export async function resumeBuyerWorkflow(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  auctionId: string,
  reason: string
) {
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId, status: "PENDING" },
  });
  if (!auction) throw new Error("No pending auction found for this buyer");

  await prisma.auction.update({
    where: { id: auctionId },
    data: { status: "ACTIVE", startedAt: new Date() },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_WORKFLOW_RESUMED",
      entityType: "Auction",
      entityId: auctionId,
      reason,
      metadata: { buyerId },
    },
  });

  return { resumed: true };
}

export async function cancelBuyerWorkflow(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  dealId: string,
  reason: string
) {
  const deal = await prisma.deal.findFirst({
    where: {
      id: dealId,
      buyerId,
      status: {
        notIn: [DealStatus.CANCELLED, DealStatus.COMPLETED, DealStatus.REFUNDED],
      },
    },
  });
  if (!deal) throw new Error("No active deal found for this buyer");

  const previousStatus = deal.status;
  await prisma.deal.update({
    where: { id: dealId },
    data: { status: DealStatus.CANCELLED },
  });

  await prisma.dealStatusHistory.create({
    data: {
      dealId,
      fromStatus: previousStatus,
      toStatus: DealStatus.CANCELLED,
      actorId: adminId,
      actorRole: "ADMIN",
      reason,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "CANCEL",
      entityType: "Deal",
      entityId: dealId,
      reason,
      metadata: { buyerId, previousStatus },
    },
  });

  return { cancelled: true };
}

export async function moveBuyerWorkflowStage(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  dealId: string,
  targetStatus: DealStatus,
  reason: string
) {
  const deal = await prisma.deal.findFirst({
    where: {
      id: dealId,
      buyerId,
      status: {
        notIn: [DealStatus.CANCELLED, DealStatus.COMPLETED, DealStatus.REFUNDED],
      },
    },
  });
  if (!deal) throw new Error("No active deal found for this buyer");

  const previousStatus = deal.status;
  await prisma.deal.update({
    where: { id: dealId },
    data: { status: targetStatus },
  });

  await prisma.dealStatusHistory.create({
    data: {
      dealId,
      fromStatus: previousStatus,
      toStatus: targetStatus,
      actorId: adminId,
      actorRole: "ADMIN",
      reason,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "STAGE_ADVANCE",
      entityType: "Deal",
      entityId: dealId,
      reason,
      metadata: { buyerId, previousStatus, targetStatus },
    },
  });

  return { moved: true, newStatus: targetStatus };
}

// ─── Lifecycle Management ─────────────────────────────────────────────────────

export async function archiveBuyerByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { purgedAt: true } });
  if (!buyer) throw new Error("Buyer not found");
  if (buyer.purgedAt) throw new Error("Cannot archive a purged buyer profile");

  await prisma.buyer.update({ where: { id: buyerId }, data: { archivedAt: new Date() } });
  await prisma.adminAuditLog.create({
    data: { adminId, adminEmail, action: "BUYER_ARCHIVED", entityType: "Buyer", entityId: buyerId, reason },
  });
  return { archived: true };
}

export async function restoreBuyerByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { archivedAt: true } });
  if (!buyer) throw new Error("Buyer not found");
  if (!buyer.archivedAt) throw new Error("Buyer is not archived");

  await prisma.buyer.update({ where: { id: buyerId }, data: { archivedAt: null } });
  await prisma.adminAuditLog.create({
    data: { adminId, adminEmail, action: "BUYER_RESTORED", entityType: "Buyer", entityId: buyerId, reason },
  });
  return { restored: true };
}

export async function disableBuyerAccessByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { purgedAt: true } });
  if (!buyer) throw new Error("Buyer not found");
  if (buyer.purgedAt) throw new Error("Cannot disable a purged buyer profile");

  await prisma.buyer.update({ where: { id: buyerId }, data: { disabledAt: new Date() } });
  await prisma.adminAuditLog.create({
    data: { adminId, adminEmail, action: "BUYER_DISABLED", entityType: "Buyer", entityId: buyerId, reason,
      metadata: { note: "Supabase auth ban requires separate Supabase Admin API call (documented gap)" } },
  });
  return { disabled: true };
}

export async function reactivateBuyerAccessByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { disabledAt: true } });
  if (!buyer) throw new Error("Buyer not found");
  if (!buyer.disabledAt) throw new Error("Buyer access is not disabled");

  await prisma.buyer.update({ where: { id: buyerId }, data: { disabledAt: null } });
  await prisma.adminAuditLog.create({
    data: { adminId, adminEmail, action: "BUYER_REACTIVATED", entityType: "Buyer", entityId: buyerId, reason },
  });
  return { reactivated: true };
}

// ─── Deletion Eligibility ─────────────────────────────────────────────────────

export interface BuyerDeletionEligibility {
  eligible: boolean;
  /** true = hard delete is safe; false = only privacy purge is safe */
  hardDeleteSafe: boolean;
  blockers: string[];
}

export async function evaluateBuyerDeletionEligibility(
  buyerId: string
): Promise<BuyerDeletionEligibility> {
  const [
    activeDeal,
    completedDeal,
    paidDeposit,
    activeAuction,
    pendingAuction,
    complianceEvents,
    signedEnvelope,
    completedPickup,
  ] = await Promise.all([
    prisma.deal.findFirst({
      where: {
        buyerId,
        status: { notIn: [DealStatus.CANCELLED, DealStatus.COMPLETED, DealStatus.REFUNDED] },
      },
      select: { id: true, status: true },
    }),
    prisma.deal.findFirst({
      where: { buyerId, status: { in: [DealStatus.COMPLETED, DealStatus.PICKUP_COMPLETE] } },
      select: { id: true },
    }),
    prisma.deposit.findFirst({
      where: { buyerId, status: "PAID" },
      select: { id: true },
    }),
    prisma.auction.findFirst({
      where: { buyerId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.auction.findFirst({
      where: { buyerId, status: "PENDING" },
      select: { id: true },
    }),
    prisma.complianceEvent.findFirst({
      where: { buyerId },
      select: { id: true },
    }),
    prisma.eSignEnvelope.findFirst({
      where: { deal: { buyerId }, status: "COMPLETED" },
      select: { id: true },
    }),
    prisma.pickup.findFirst({
      where: { deal: { buyerId }, completedAt: { not: null } },
      select: { id: true },
    }),
  ]);

  const blockers: string[] = [];
  if (activeDeal) blockers.push(`Active deal in progress (ID: ${activeDeal.id}, status: ${activeDeal.status})`);
  if (activeAuction) blockers.push("Active auction in progress");
  if (pendingAuction) blockers.push("Pending auction exists");

  // These make hard delete unsafe but allow privacy purge
  const retentionFlags: string[] = [];
  if (completedDeal) retentionFlags.push("Completed deal record exists (financial retention required)");
  if (paidDeposit) retentionFlags.push("Paid deposit on record (payment retention required)");
  if (signedEnvelope) retentionFlags.push("Signed contract/envelope on record (legal retention required)");
  if (completedPickup) retentionFlags.push("Completed vehicle pickup on record (operational retention required)");
  if (complianceEvents) retentionFlags.push("Compliance event record exists (compliance retention required)");

  const eligible = blockers.length === 0;
  const hardDeleteSafe = eligible && retentionFlags.length === 0;

  return {
    eligible,
    hardDeleteSafe,
    blockers: [...blockers, ...retentionFlags],
  };
}

// ─── Delete Buyer ─────────────────────────────────────────────────────────────

export async function deleteBuyerByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
): Promise<{ deleted: boolean }> {
  const eligibility = await evaluateBuyerDeletionEligibility(buyerId);
  if (!eligibility.eligible) {
    throw new Error(
      "Delete blocked: " + eligibility.blockers.join("; ")
    );
  }
  if (!eligibility.hardDeleteSafe) {
    throw new Error(
      "Hard delete not safe due to retention requirements. Use privacy purge instead. Blockers: " +
        eligibility.blockers.join("; ")
    );
  }

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { userId: true },
  });
  if (!buyer) throw new Error("Buyer not found");

  // Audit log before deletion so we preserve the record
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_DELETED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: {
        userId: buyer.userId,
        deletedAt: new Date().toISOString(),
        note: "Hard delete — cascades to Buyer and all related records. Supabase user deletion requires separate call (documented gap).",
      },
    },
  });

  // Delete the User record; onDelete: Cascade propagates to Buyer and its relations
  await prisma.user.delete({ where: { id: buyer.userId } });

  return { deleted: true };
}

// ─── Privacy Purge ────────────────────────────────────────────────────────────

export async function privacyPurgeBuyerByAdmin(
  buyerId: string,
  adminId: string,
  adminEmail: string,
  reason: string,
  ipAddress?: string | null
): Promise<{ purged: boolean }> {
  const eligibility = await evaluateBuyerDeletionEligibility(buyerId);
  if (!eligibility.eligible) {
    // Allow purge even if retention records exist, but not if active deals/auctions block it
    const hardBlockers = eligibility.blockers.filter((b) =>
      b.includes("Active deal") || b.includes("Active auction") || b.includes("Pending auction")
    );
    if (hardBlockers.length > 0) {
      throw new Error("Privacy purge blocked: " + hardBlockers.join("; "));
    }
  }

  // Anonymize PII fields — preserve record shell for financial/legal retention
  await prisma.buyer.update({
    where: { id: buyerId },
    data: {
      firstName: "PURGED",
      lastName: "USER",
      phone: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      employmentStatus: null,
      incomeRange: null,
      profilePictureUrl: null,
      disabledAt: new Date(),
      purgedAt: new Date(),
      archivedAt: new Date(),
    },
  });

  // Anonymize the linked User email to prevent re-use or identification
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { userId: true } });
  if (buyer) {
    await prisma.user.update({
      where: { id: buyer.userId },
      data: { email: `purged-${buyerId}@deleted.autolenis.local` },
    });
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "BUYER_PRIVACY_PURGED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: {
        purgedAt: new Date().toISOString(),
        preserved: "Financial records, audit logs, contracts, deposits, deals retained for compliance",
        note: "PII anonymized. Login disabled. Supabase auth ban requires separate call (documented gap).",
      },
    },
  });

  return { purged: true };
}

