// lib/services/admin/admin-dealer-command-center.service.ts
// Admin Dealer Command Center — service layer for all dealer admin operations

import { prisma } from "@/lib/prisma";
import { DealerStatus } from "@prisma/client";
import { addSupportNote } from "@/lib/services/admin/admin-support.service";
import type { SupportNoteType } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DealerListFilters {
  q?: string;
  status?: string;
  tier?: string;
  inventoryStatus?: string;
  /** Filter to dealers holding active inventory of this condition (New / Used / Certified) */
  inventoryType?: string;
  /** Filter by dealer service area — matched against the dealer's state code */
  serviceArea?: string;
  auctionParticipation?: boolean;
  complianceIssue?: boolean;
  page?: number;
  perPage?: number;
}

// Deal statuses that count as a "won" deal for a dealer (offer accepted and
// the deal carried forward). Mirrors the won-deal definition used in KPIs.
const WON_DEAL_STATUSES = ["COMPLETED", "PICKUP_COMPLETE", "SIGNED"] as const;

export interface AdminDealerKpis {
  total: number;
  pending: number;
  active: number;
  suspended: number;
  terminated: number;
  withActiveAuctions: number;
  withSubmittedOffers: number;
  withWonDeals: number;
  totalInventory: number;
  complianceIssues: number;
}

export interface DealerActionAvailability {
  canApprove: boolean;
  canSuspend: boolean;
  canReactivate: boolean;
  canTerminate: boolean;
  currentStatus: string;
  hasInventory: boolean;
  hasActiveOffers: boolean;
  hasActiveAuctions: boolean;
  hasComplianceFlag: boolean;
}

// ─── KPI Aggregation ─────────────────────────────────────────────────────────

export async function getAdminDealerKpis(): Promise<AdminDealerKpis> {
  const [
    total,
    pending,
    active,
    suspended,
    terminated,
    dealersWithActiveAuctions,
    dealersWithSubmittedOffers,
    dealersWithWonDeals,
    totalInventory,
    complianceFlagged,
    complianceResolved,
  ] = await Promise.all([
    prisma.dealer.count(),
    prisma.dealer.count({ where: { status: DealerStatus.PENDING } }),
    prisma.dealer.count({ where: { status: DealerStatus.ACTIVE } }),
    prisma.dealer.count({ where: { status: DealerStatus.SUSPENDED } }),
    prisma.dealer.count({ where: { status: DealerStatus.TERMINATED } }),
    prisma.dealer.count({
      where: {
        invitations: {
          some: {
            auction: { status: { in: ["PENDING", "ACTIVE"] } },
          },
        },
      },
    }),
    prisma.dealer.count({
      where: { offers: { some: { status: "SUBMITTED" } } },
    }),
    prisma.deal.groupBy({
      by: ["offerId"],
      where: { status: { in: ["COMPLETED", "PICKUP_COMPLETE", "SIGNED"] } },
    }).then(async (rows) => {
      if (rows.length === 0) return 0;
      const offerIds = rows.map((r) => r.offerId).filter((id): id is string => id !== null);
      const dealerGroups = await prisma.offer.groupBy({
        by: ["dealerId"],
        where: { id: { in: offerIds } },
      });
      return dealerGroups.length;
    }),
    prisma.inventoryItem.count({ where: { isActive: true } }),
    prisma.adminAuditLog.findMany({
      where: { action: "DEALER_COMPLIANCE_FLAGGED", entityType: "Dealer" },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "DEALER_COMPLIANCE_RESOLVED", entityType: "Dealer" },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
  ]);

  const resolvedIds = new Set(complianceResolved.map((r) => r.entityId));
  const complianceIssues = complianceFlagged.filter(
    (f) => !resolvedIds.has(f.entityId)
  ).length;

  return {
    total,
    pending,
    active,
    suspended,
    terminated,
    withActiveAuctions: dealersWithActiveAuctions,
    withSubmittedOffers: dealersWithSubmittedOffers,
    withWonDeals: dealersWithWonDeals,
    totalInventory,
    complianceIssues,
  };
}

// ─── Dealer List ──────────────────────────────────────────────────────────────

export async function getAdminDealerListData(filters: DealerListFilters = {}) {
  const { q, status, tier, inventoryType, serviceArea, page = 1, perPage = 50 } = filters;

  const where: Record<string, unknown> = {};

  if (q) {
    where.OR = [
      { dealershipName: { contains: q, mode: "insensitive" } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { phone: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }
  if (status) where.status = status;
  if (tier) where.tier = tier;

  // Service area = dealer state (exact 2-letter match, case-insensitive).
  if (serviceArea) where.state = { equals: serviceArea, mode: "insensitive" };

  // Inventory type = dealer holds at least one active inventory item of the
  // given condition.
  if (inventoryType) {
    where.inventory = { some: { isActive: true, condition: { equals: inventoryType, mode: "insensitive" } } };
  }

  const [dealers, total] = await Promise.all([
    prisma.dealer.findMany({
      where,
      include: {
        user: { select: { email: true, createdAt: true } },
        _count: {
          select: {
            inventory: true,
            offers: true,
            invitations: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.dealer.count({ where }),
  ]);

  const dealerIds = dealers.map((d) => d.id);

  // Compliance status, active bids, won deals, and approval dates are resolved
  // in batch over the current page rather than via per-row N+1 queries.
  const [flaggedLogs, resolvedLogs, approvedLogs, submittedOfferGroups, wonDealOffers] = await Promise.all([
    dealerIds.length > 0
      ? prisma.adminAuditLog.findMany({
          where: { action: "DEALER_COMPLIANCE_FLAGGED", entityType: "Dealer", entityId: { in: dealerIds } },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
    dealerIds.length > 0
      ? prisma.adminAuditLog.findMany({
          where: { action: "DEALER_COMPLIANCE_RESOLVED", entityType: "Dealer", entityId: { in: dealerIds } },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
    dealerIds.length > 0
      ? prisma.adminAuditLog.findMany({
          where: { action: "DEALER_APPROVED", entityType: "Dealer", entityId: { in: dealerIds } },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
    dealerIds.length > 0
      ? prisma.offer.groupBy({
          by: ["dealerId"],
          where: { dealerId: { in: dealerIds }, status: "SUBMITTED" },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ dealerId: string; _count: { _all: number } }>),
    dealerIds.length > 0
      ? prisma.offer.findMany({
          where: { dealerId: { in: dealerIds }, deal: { is: { status: { in: [...WON_DEAL_STATUSES] } } } },
          select: { dealerId: true },
        })
      : Promise.resolve([] as Array<{ dealerId: string }>),
  ]);

  const latestFlaggedMap = new Map<string, Date>();
  for (const log of flaggedLogs) {
    if (!latestFlaggedMap.has(log.entityId)) latestFlaggedMap.set(log.entityId, log.createdAt);
  }
  const latestResolvedMap = new Map<string, Date>();
  for (const log of resolvedLogs) {
    if (!latestResolvedMap.has(log.entityId)) latestResolvedMap.set(log.entityId, log.createdAt);
  }
  const approvalDateMap = new Map<string, Date>();
  for (const log of approvedLogs) {
    if (!approvalDateMap.has(log.entityId)) approvalDateMap.set(log.entityId, log.createdAt);
  }
  const activeBidsMap = new Map<string, number>();
  for (const g of submittedOfferGroups) {
    if (g.dealerId) activeBidsMap.set(g.dealerId, g._count._all);
  }
  const wonDealsMap = new Map<string, number>();
  for (const o of wonDealOffers) {
    if (o.dealerId) wonDealsMap.set(o.dealerId, (wonDealsMap.get(o.dealerId) ?? 0) + 1);
  }

  const rows = dealers.map((d) => {
    const flaggedAt = latestFlaggedMap.get(d.id);
    const resolvedAt = latestResolvedMap.get(d.id);
    const hasComplianceFlag =
      !!flaggedAt && (!resolvedAt || flaggedAt > resolvedAt);

    return {
      id: d.id,
      dealershipName: d.dealershipName,
      email: d.user.email,
      phone: d.phone ?? null,
      city: d.city ?? null,
      state: d.state ?? null,
      status: d.status,
      tier: d.tier,
      scorecardTier: d.scorecardTier ?? null,
      onboardingStep: d.onboardingStep,
      inventoryCount: d._count.inventory,
      offerCount: d._count.offers,
      invitationCount: d._count.invitations,
      activeBids: activeBidsMap.get(d.id) ?? 0,
      dealsWon: wonDealsMap.get(d.id) ?? 0,
      approvalDate: approvalDateMap.get(d.id)?.toISOString() ?? null,
      hasComplianceFlag,
      createdAt: d.createdAt.toISOString(),
    };
  });

  return { dealers: rows, total, page, perPage };
}

// ─── Dealer Detail ────────────────────────────────────────────────────────────

export async function getAdminDealerDetailData(dealerId: string) {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    include: {
      user: { select: { email: true, createdAt: true, supabaseId: true } },
      inventory: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      offers: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          deal: { select: { id: true, status: true } },
          auction: {
            select: { id: true, status: true, startedAt: true, endsAt: true },
          },
        },
      },
      invitations: {
        orderBy: { sentAt: "desc" },
        take: 20,
        include: {
          auction: {
            select: {
              id: true,
              status: true,
              startedAt: true,
              endsAt: true,
            },
          },
        },
      },
      scorecardSnapshots: {
        orderBy: { snapshotDate: "desc" },
        take: 5,
      },
      notifications: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      feedConfig: true,
    },
  });

  if (!dealer) return null;

  const [deals, auditLogs, supportNotes, documents, dealerPayments, dealerApplication, dealerLicenses] = await Promise.all([
    prisma.deal.findMany({
      where: { offer: { dealerId } },
      include: {
        offer: { select: { id: true, status: true, otdPriceCents: true } },
        contractScans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.adminAuditLog.findMany({
      where: { entityType: "Dealer", entityId: dealerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.adminSupportNote.findMany({
      where: { targetUserId: dealer.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.document.findMany({
      where: { dealerId },
      orderBy: { uploadedAt: "desc" },
      take: 30,
    }),
    prisma.dealerPayment.findMany({
      where: { dealerId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.dealerApplication.findFirst({
      where: { dealerId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dealerLicense.findMany({
      where: { dealerId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Derive compliance status
  const complianceLogs = auditLogs.filter(
    (l) =>
      l.action === "DEALER_COMPLIANCE_FLAGGED" ||
      l.action === "DEALER_COMPLIANCE_RESOLVED"
  );
  let hasComplianceFlag = false;
  let complianceReason: string | null = null;
  if (complianceLogs.length > 0) {
    const latest = complianceLogs[0];
    hasComplianceFlag = latest.action === "DEALER_COMPLIANCE_FLAGGED";
    complianceReason = hasComplianceFlag ? (latest.reason ?? null) : null;
  }

  return {
    dealer: {
      id: dealer.id,
      dealershipName: dealer.dealershipName,
      email: dealer.user.email,
      supabaseId: dealer.user.supabaseId,
      phone: dealer.phone ?? null,
      address: dealer.address ?? null,
      city: dealer.city ?? null,
      state: dealer.state ?? null,
      zip: dealer.zip ?? null,
      status: dealer.status,
      tier: dealer.tier,
      scorecardTier: dealer.scorecardTier ?? null,
      onboardingStep: dealer.onboardingStep,
      licenseNumber: dealer.licenseNumber ?? null,
      agreedToTermsAt: dealer.agreedToTermsAt?.toISOString() ?? null,
      currentAuctionLoad: dealer.currentAuctionLoad,
      createdAt: dealer.createdAt.toISOString(),
      updatedAt: dealer.updatedAt.toISOString(),
    },
    inventory: dealer.inventory.map((item) => ({
      id: item.id,
      year: item.year,
      make: item.make,
      model: item.model,
      trim: item.trim ?? null,
      priceCents: item.priceCents,
      condition: item.condition ?? null,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
    })),
    offers: dealer.offers.map((o) => ({
      id: o.id,
      status: o.status,
      otdPriceCents: o.otdPriceCents,
      vehiclePriceCents: o.vehiclePriceCents,
      submittedAt: o.submittedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      dealStatus: o.deal?.status ?? null,
      dealId: o.deal?.id ?? null,
      auctionId: o.auction?.id ?? null,
      auctionStatus: o.auction?.status ?? null,
    })),
    invitations: dealer.invitations.map((inv) => ({
      id: inv.id,
      auctionId: inv.auctionId,
      sentAt: inv.sentAt.toISOString(),
      viewedAt: inv.viewedAt?.toISOString() ?? null,
      respondedAt: inv.respondedAt?.toISOString() ?? null,
      auction: inv.auction
        ? {
            id: inv.auction.id,
            status: inv.auction.status,
            startedAt: inv.auction.startedAt?.toISOString() ?? null,
            endsAt: inv.auction.endsAt?.toISOString() ?? null,
          }
        : null,
    })),
    deals: deals.map((d) => ({
      id: d.id,
      status: d.status,
      offerId: d.offerId,
      offerStatus: d.offer?.status ?? null,
      otdPriceCents: d.offer?.otdPriceCents ?? null,
      createdAt: d.createdAt.toISOString(),
      latestContractScan: d.contractScans[0]
        ? {
            id: d.contractScans[0].id,
            score: d.contractScans[0].score,
            status: d.contractScans[0].status,
            // fixList is a JSON array of Contract Shield rule violations
            fixList: (Array.isArray(d.contractScans[0].fixList)
              ? d.contractScans[0].fixList
              : []) as Array<{ description?: string; rule?: string; severity?: string; [key: string]: unknown }>,
            scannedAt: d.contractScans[0].scannedAt.toISOString(),
          }
        : null,
    })),
    scorecardSnapshots: dealer.scorecardSnapshots.map((s) => ({
      tier: s.tier,
      offerWinRate: s.offerWinRate,
      dealCompletionRate: s.dealCompletionRate,
      auctionResponseRate: s.auctionResponseRate,
      avgResponseHours: s.avgResponseHours,
      junkFeeRatio: s.junkFeeRatio,
      snapshotDate: s.snapshotDate.toISOString(),
    })),
    notifications: dealer.notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    feedConfig: dealer.feedConfig
      ? {
          id: dealer.feedConfig.id,
          isActive: dealer.feedConfig.isActive,
          feedUrl: dealer.feedConfig.feedUrl,
          format: dealer.feedConfig.format,
          lastSyncAt: dealer.feedConfig.lastSyncAt?.toISOString() ?? null,
          createdAt: dealer.feedConfig.createdAt.toISOString(),
        }
      : null,
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
    complianceStatus: {
      hasFlag: hasComplianceFlag,
      reason: complianceReason,
    },
    documents: documents.map((doc) => ({
      id: doc.id,
      type: doc.type,
      name: doc.name,
      url: doc.url,
      mimeType: doc.mimeType ?? null,
      sizeBytes: doc.sizeBytes ?? null,
      isVerified: doc.isVerified,
      verifiedAt: doc.verifiedAt?.toISOString() ?? null,
      uploadedAt: doc.uploadedAt.toISOString(),
    })),
    dealerPayments: dealerPayments.map((p) => ({
      id: p.id,
      dealId: p.dealId ?? null,
      amountCents: p.amountCents,
      type: p.type,
      status: p.status,
      processedAt: p.processedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    dealerApplication: dealerApplication
      ? {
          id: dealerApplication.id,
          dealershipName: dealerApplication.dealershipName,
          dealershipType: dealerApplication.dealershipType,
          state: dealerApplication.state,
          city: dealerApplication.city,
          zip: dealerApplication.zip,
          licenseNumber: dealerApplication.licenseNumber,
          contactName: dealerApplication.contactName,
          contactEmail: dealerApplication.contactEmail,
          contactPhone: dealerApplication.contactPhone ?? null,
          annualVolume: dealerApplication.annualVolume ?? null,
          notes: dealerApplication.notes ?? null,
          status: dealerApplication.status,
          reviewedBy: dealerApplication.reviewedBy ?? null,
          reviewedAt: dealerApplication.reviewedAt?.toISOString() ?? null,
          rejectReason: dealerApplication.rejectReason ?? null,
          createdAt: dealerApplication.createdAt.toISOString(),
        }
      : null,
    dealerLicenses: dealerLicenses.map((lic) => ({
      id: lic.id,
      licenseNum: lic.licenseNum,
      state: lic.state,
      expiresAt: lic.expiresAt?.toISOString() ?? null,
      documentUrl: lic.documentUrl ?? null,
      isActive: lic.isActive,
      createdAt: lic.createdAt.toISOString(),
    })),
  };
}

// ─── Action Availability ──────────────────────────────────────────────────────

export async function getAdminDealerActionAvailability(
  dealerId: string
): Promise<DealerActionAvailability> {
  const [
    dealer,
    inventoryCount,
    activeOffersCount,
    activeAuctionCount,
    complianceFlagged,
    complianceResolved,
  ] = await Promise.all([
    prisma.dealer.findUnique({
      where: { id: dealerId },
      select: { status: true },
    }),
    prisma.inventoryItem.count({ where: { dealerId, isActive: true } }),
    prisma.offer.count({
      where: { dealerId, status: { in: ["SUBMITTED", "DRAFT"] } },
    }),
    prisma.auctionInvitation.count({
      where: {
        dealerId,
        auction: { status: { in: ["PENDING", "ACTIVE"] } },
      },
    }),
    prisma.adminAuditLog.findFirst({
      where: {
        action: "DEALER_COMPLIANCE_FLAGGED",
        entityType: "Dealer",
        entityId: dealerId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    prisma.adminAuditLog.findFirst({
      where: {
        action: "DEALER_COMPLIANCE_RESOLVED",
        entityType: "Dealer",
        entityId: dealerId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
  ]);

  const currentStatus = dealer?.status ?? "UNKNOWN";
  const hasComplianceFlag =
    !!complianceFlagged &&
    (!complianceResolved ||
      complianceFlagged.createdAt > complianceResolved.createdAt);

  return {
    canApprove: currentStatus === "PENDING",
    canSuspend: currentStatus === "ACTIVE",
    canReactivate: currentStatus === "SUSPENDED",
    canTerminate:
      currentStatus === "ACTIVE" || currentStatus === "SUSPENDED",
    currentStatus,
    hasInventory: inventoryCount > 0,
    hasActiveOffers: activeOffersCount > 0,
    hasActiveAuctions: activeAuctionCount > 0,
    hasComplianceFlag,
  };
}

// ─── Action Functions ─────────────────────────────────────────────────────────

export async function approveDealerByAdmin(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) throw new Error("Dealer not found");
  if (dealer.status !== DealerStatus.PENDING) {
    throw new Error("Dealer is not in PENDING status");
  }

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: DealerStatus.ACTIVE },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_APPROVED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: { previousStatus: dealer.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function suspendDealerByAdmin(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) throw new Error("Dealer not found");
  if (dealer.status !== DealerStatus.ACTIVE) {
    throw new Error("Dealer is not in ACTIVE status");
  }

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: DealerStatus.SUSPENDED },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_SUSPENDED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: { previousStatus: dealer.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function reactivateDealerByAdmin(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) throw new Error("Dealer not found");
  if (dealer.status !== DealerStatus.SUSPENDED) {
    throw new Error("Dealer is not in SUSPENDED status");
  }

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: DealerStatus.ACTIVE },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_REACTIVATED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: { previousStatus: dealer.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function terminateDealerByAdmin(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) throw new Error("Dealer not found");
  if (
    dealer.status !== DealerStatus.ACTIVE &&
    dealer.status !== DealerStatus.SUSPENDED
  ) {
    throw new Error("Dealer cannot be terminated from current status");
  }

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: DealerStatus.TERMINATED },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_TERMINATED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: { previousStatus: dealer.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function updateDealerProfileByAdmin(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  data: {
    dealershipName?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    licenseNumber?: string;
    tier?: string;
    reason: string;
  }
) {
  const { reason, ...profileData } = data;

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: profileData,
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_PROFILE_UPDATED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: profileData as object,
    },
  });

  return updated;
}

export async function addDealerAdminNote(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  content: string,
  type: SupportNoteType
) {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { userId: true },
  });
  if (!dealer) throw new Error("Dealer not found");

  const note = await addSupportNote(adminId, dealer.userId, content, type);

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_NOTE_ADDED",
      entityType: "Dealer",
      entityId: dealerId,
      metadata: { noteId: note.id, type },
    },
  });

  return note;
}

export async function flagDealerComplianceIssue(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { id: true },
  });
  if (!dealer) throw new Error("Dealer not found");

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_COMPLIANCE_FLAGGED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: { flaggedAt: new Date().toISOString() },
    },
  });

  return { flagged: true };
}

export async function resolveDealerComplianceIssue(
  dealerId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { id: true },
  });
  if (!dealer) throw new Error("Dealer not found");

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "DEALER_COMPLIANCE_RESOLVED",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      metadata: { resolvedAt: new Date().toISOString() },
    },
  });

  return { resolved: true };
}
