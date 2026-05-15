// lib/services/admin/admin-affiliate-command-center.service.ts
// Admin Affiliate Command Center — service layer for all affiliate admin operations

import { prisma } from "@/lib/prisma";
import { AffiliateStatus } from "@prisma/client";
import { addSupportNote } from "@/lib/services/admin/admin-support.service";
import type { SupportNoteType } from "@prisma/client";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AffiliateListFilters {
  q?: string;
  status?: string;
  level?: number;
  conversionStatus?: string;
  commissionStatus?: string;
  page?: number;
  perPage?: number;
}

export interface AdminAffiliateKpis {
  total: number;
  pending: number;
  active: number;
  suspended: number;
  rejected: number;
  totalReferrals: number;
  convertedReferrals: number;
  commissionsPendingCents: number;
  commissionsPaidCents: number;
  highPerforming: number;
  complianceIssues: number;
}

export interface AffiliateActionAvailability {
  canApprove: boolean;
  canReject: boolean;
  canSuspend: boolean;
  canReactivate: boolean;
  currentStatus: string;
  hasReferrals: boolean;
  hasCommissions: boolean;
  hasComplianceFlag: boolean;
}

// ─── KPI Aggregation ─────────────────────────────────────────────────────────

export async function getAdminAffiliateKpis(): Promise<AdminAffiliateKpis> {
  const [
    total,
    pending,
    active,
    suspended,
    rejected,
    totalReferrals,
    commissionAgg,
    complianceFlagged,
    complianceResolved,
  ] = await Promise.all([
    prisma.affiliate.count(),
    prisma.affiliate.count({ where: { status: AffiliateStatus.PENDING } }),
    prisma.affiliate.count({ where: { status: AffiliateStatus.ACTIVE } }),
    prisma.affiliate.count({ where: { status: AffiliateStatus.SUSPENDED } }),
    prisma.affiliate.count({ where: { status: AffiliateStatus.REJECTED } }),
    prisma.buyer.count({ where: { affiliateId: { not: null } } }),
    prisma.commission.groupBy({
      by: ["status"],
      _sum: { amountCents: true },
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "AFFILIATE_COMPLIANCE_FLAGGED", entityType: "Affiliate" },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "AFFILIATE_COMPLIANCE_RESOLVED", entityType: "Affiliate" },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
  ]);

  // Count converted referrals — buyers with affiliateId that have completed deals
  const convertedReferrals = await prisma.buyer.count({
    where: {
      affiliateId: { not: null },
      deals: { some: { status: { in: ["COMPLETED", "PICKUP_COMPLETE"] } } },
    },
  });

  const commissionsPendingCents =
    commissionAgg.find((c) => c.status === "PENDING")?._sum?.amountCents ?? 0;
  const commissionsPaidCents =
    commissionAgg.find((c) => c.status === "PAID")?._sum?.amountCents ?? 0;

  // High-performing: affiliates with any commissions
  const highPerforming = await prisma.affiliate.count({
    where: { commissions: { some: {} } },
  });

  const resolvedIds = new Set(complianceResolved.map((r) => r.entityId));
  const complianceIssues = complianceFlagged.filter(
    (f) => !resolvedIds.has(f.entityId)
  ).length;

  return {
    total,
    pending,
    active,
    suspended,
    rejected,
    totalReferrals,
    convertedReferrals,
    commissionsPendingCents,
    commissionsPaidCents,
    highPerforming,
    complianceIssues,
  };
}

// ─── Affiliate List ───────────────────────────────────────────────────────────

export async function getAdminAffiliateListData(
  filters: AffiliateListFilters = {}
) {
  const { q, status, level, page = 1, perPage = 50 } = filters;

  const where: Record<string, unknown> = {};

  if (q) {
    where.OR = [
      { user: { email: { contains: q, mode: "insensitive" } } },
      { referralCode: { contains: q, mode: "insensitive" } },
      { website: { contains: q, mode: "insensitive" } },
    ];
  }
  if (status) where.status = status;
  if (level !== undefined) where.level = level;

  const [affiliates, total] = await Promise.all([
    prisma.affiliate.findMany({
      where,
      include: {
        user: { select: { email: true, createdAt: true } },
        _count: {
          select: {
            commissions: true,
            payouts: true,
            children: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.affiliate.count({ where }),
  ]);

  const affiliateIds = affiliates.map((a) => a.id);

  // Get compliance status
  const [flaggedLogs, resolvedLogs, referralCounts] = await Promise.all([
    affiliateIds.length > 0
      ? prisma.adminAuditLog.findMany({
          where: {
            action: "AFFILIATE_COMPLIANCE_FLAGGED",
            entityType: "Affiliate",
            entityId: { in: affiliateIds },
          },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
    affiliateIds.length > 0
      ? prisma.adminAuditLog.findMany({
          where: {
            action: "AFFILIATE_COMPLIANCE_RESOLVED",
            entityType: "Affiliate",
            entityId: { in: affiliateIds },
          },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
    affiliateIds.length > 0
      ? prisma.buyer.groupBy({
          by: ["affiliateId"],
          where: { affiliateId: { in: affiliateIds } },
          _count: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const latestFlaggedMap = new Map<string, Date>();
  for (const log of flaggedLogs) {
    if (!latestFlaggedMap.has(log.entityId)) {
      latestFlaggedMap.set(log.entityId, log.createdAt);
    }
  }
  const latestResolvedMap = new Map<string, Date>();
  for (const log of resolvedLogs) {
    if (!latestResolvedMap.has(log.entityId)) {
      latestResolvedMap.set(log.entityId, log.createdAt);
    }
  }
  const referralCountMap = new Map<string, number>();
  for (const row of referralCounts) {
    if (row.affiliateId) {
      referralCountMap.set(row.affiliateId, row._count.id);
    }
  }

  const rows = affiliates.map((a) => {
    const flaggedAt = latestFlaggedMap.get(a.id);
    const resolvedAt = latestResolvedMap.get(a.id);
    const hasComplianceFlag =
      !!flaggedAt && (!resolvedAt || flaggedAt > resolvedAt);

    return {
      id: a.id,
      email: a.user.email,
      referralCode: a.referralCode,
      status: a.status,
      level: a.level,
      website: a.website ?? null,
      promotionMethod: a.promotionMethod ?? null,
      commissionsCount: a._count.commissions,
      payoutsCount: a._count.payouts,
      childrenCount: a._count.children,
      referralsCount: referralCountMap.get(a.id) ?? 0,
      hasComplianceFlag,
      createdAt: a.createdAt.toISOString(),
    };
  });

  return { affiliates: rows, total, page, perPage };
}

// ─── Affiliate Detail ─────────────────────────────────────────────────────────

export async function getAdminAffiliateDetailData(affiliateId: string) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    include: {
      user: { select: { email: true, createdAt: true, supabaseId: true } },
      commissions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      payouts: {
        orderBy: { requestedAt: "desc" },
        take: 20,
      },
      children: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          user: { select: { email: true } },
        },
      },
      parent: {
        include: {
          user: { select: { email: true } },
        },
      },
      // notifications fetched separately below — isolate failure
      documents: {
        orderBy: { uploadedAt: "desc" },
      },
    },
  });

  if (!affiliate) return null;

  // Fetch notifications separately so a failure doesn't kill the whole page
  type NotificationRow = {
    id: string; type: string; title: string; body: string;
    readAt: Date | null; createdAt: Date;
  };
  let notifications: NotificationRow[] = [];
  try {
    notifications = await prisma.notification.findMany({
      where: { affiliateId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  } catch {
    notifications = [];
  }

  type AuditLogRow = {
    id: string; action: string; adminEmail: string;
    reason: string | null; metadata: unknown; createdAt: Date;
  };
  type SupportNoteRow = {
    id: string; type: string; content: string; adminId: string; createdAt: Date;
  };

  let auditLogs: AuditLogRow[] = [];
  let supportNotes: SupportNoteRow[] = [];
  let referralCount = 0;
  let convertedCount = 0;

  try {
    auditLogs = await prisma.adminAuditLog.findMany({
      where: { entityType: "Affiliate", entityId: affiliateId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } catch { auditLogs = []; }

  try {
    supportNotes = await prisma.adminSupportNote.findMany({
      where: { targetUserId: affiliate.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  } catch { supportNotes = []; }

  try { referralCount = await prisma.buyer.count({ where: { affiliateId } }); } catch { referralCount = 0; }

  try {
    convertedCount = await prisma.buyer.count({
      where: {
        affiliateId,
        deals: { some: { status: { in: ["COMPLETED", "PICKUP_COMPLETE"] } } },
      },
    });
  } catch { convertedCount = 0; }

  // Derive compliance status from audit logs
  const complianceLogs = auditLogs.filter(
    (l) =>
      l.action === "AFFILIATE_COMPLIANCE_FLAGGED" ||
      l.action === "AFFILIATE_COMPLIANCE_RESOLVED"
  );
  let hasComplianceFlag = false;
  let complianceReason: string | null = null;
  if (complianceLogs.length > 0) {
    const latest = complianceLogs[0]!;
    hasComplianceFlag = latest.action === "AFFILIATE_COMPLIANCE_FLAGGED";
    complianceReason = hasComplianceFlag ? (latest.reason ?? null) : null;
  }

  return {
    affiliate: {
      id: affiliate.id,
      email: affiliate.user.email,
      supabaseId: affiliate.user.supabaseId,
      referralCode: affiliate.referralCode,
      status: affiliate.status,
      level: affiliate.level,
      parentId: affiliate.parentId ?? null,
      website: affiliate.website ?? null,
      promotionMethod: affiliate.promotionMethod ?? null,
      ftcAcknowledgedAt: affiliate.ftcAcknowledgedAt?.toISOString() ?? null,
      weeklyDigestEnabled: affiliate.weeklyDigestEnabled,
      lastDigestSentAt: affiliate.lastDigestSentAt?.toISOString() ?? null,
      createdAt: affiliate.createdAt.toISOString(),
      updatedAt: affiliate.updatedAt.toISOString(),
    },
    parent: affiliate.parent
      ? {
          id: affiliate.parent.id,
          email: affiliate.parent.user.email,
          referralCode: affiliate.parent.referralCode,
          status: affiliate.parent.status,
          level: affiliate.parent.level,
        }
      : null,
    children: affiliate.children.map((c) => ({
      id: c.id,
      email: c.user.email,
      referralCode: c.referralCode,
      status: c.status,
      level: c.level,
      createdAt: c.createdAt.toISOString(),
    })),
    commissions: affiliate.commissions.map((c) => ({
      id: c.id,
      dealId: c.dealId,
      level: c.level,
      rate: c.rate,
      amountCents: c.amountCents,
      status: c.status,
      paidAt: c.paidAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    payouts: affiliate.payouts.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      status: p.status,
      method: p.method ?? null,
      reference: p.reference ?? null,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      requestedAt: p.requestedAt.toISOString(),
      processedAt: p.processedAt?.toISOString() ?? null,
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    referralCount,
    convertedCount,
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
    documents: affiliate.documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      fileSizeBytes: d.fileSizeBytes,
      status: d.status,
      uploadedAt: d.uploadedAt.toISOString(),
      reviewedAt: d.reviewedAt?.toISOString() ?? null,
      notes: d.notes ?? null,
    })),
  };
}

// ─── Action Availability ──────────────────────────────────────────────────────

export async function getAdminAffiliateActionAvailability(
  affiliateId: string
): Promise<AffiliateActionAvailability> {
  const [
    affiliate,
    referralsCount,
    commissionsCount,
    complianceFlagged,
    complianceResolved,
  ] = await Promise.all([
    prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { status: true },
    }),
    prisma.buyer.count({ where: { affiliateId } }),
    prisma.commission.count({ where: { affiliateId } }),
    prisma.adminAuditLog.findFirst({
      where: {
        action: "AFFILIATE_COMPLIANCE_FLAGGED",
        entityType: "Affiliate",
        entityId: affiliateId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    prisma.adminAuditLog.findFirst({
      where: {
        action: "AFFILIATE_COMPLIANCE_RESOLVED",
        entityType: "Affiliate",
        entityId: affiliateId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
  ]);

  const currentStatus = affiliate?.status ?? "UNKNOWN";
  const hasComplianceFlag =
    !!complianceFlagged &&
    (!complianceResolved ||
      complianceFlagged.createdAt > complianceResolved.createdAt);

  return {
    canApprove:
      currentStatus === "PENDING" ||
      currentStatus === "SUSPENDED" ||
      currentStatus === "REJECTED",
    canReject: currentStatus === "PENDING",
    canSuspend: currentStatus === "ACTIVE",
    canReactivate: currentStatus === "SUSPENDED",
    currentStatus,
    hasReferrals: referralsCount > 0,
    hasCommissions: commissionsCount > 0,
    hasComplianceFlag,
  };
}

// ─── Action Functions ─────────────────────────────────────────────────────────

export async function approveAffiliateByAdmin(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
  });
  if (!affiliate) throw new Error("Affiliate not found");
  if (affiliate.status === AffiliateStatus.ACTIVE) {
    throw new Error("Affiliate is already active");
  }
  // Backfill referral code if missing
  let referralCode = affiliate.referralCode;
  if (!referralCode) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const MAX_REFERRAL_CODE_GENERATION_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_REFERRAL_CODE_GENERATION_ATTEMPTS; attempt++) {
      let code = "AL";
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        code += alphabet[bytes[i] % alphabet.length];
      }
      const existing = await prisma.affiliate.findUnique({
        where: { referralCode: code },
      });
      if (!existing) {
        referralCode = code;
        break;
      }
    }
    if (!referralCode) throw new Error("Failed to generate unique referral code");
  }

  const updated = await prisma.affiliate.update({
    where: { id: affiliateId },
    data: { status: AffiliateStatus.ACTIVE, referralCode },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_APPROVED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: { previousStatus: affiliate.status },
    },
  });

  return { id: updated.id, status: updated.status, referralCode: updated.referralCode };
}

export async function rejectAffiliateByAdmin(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
  });
  if (!affiliate) throw new Error("Affiliate not found");
  if (affiliate.status !== AffiliateStatus.PENDING) {
    throw new Error("Only PENDING affiliates can be rejected");
  }

  const updated = await prisma.affiliate.update({
    where: { id: affiliateId },
    data: { status: AffiliateStatus.REJECTED },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_REJECTED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: { previousStatus: affiliate.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function suspendAffiliateByAdmin(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
  });
  if (!affiliate) throw new Error("Affiliate not found");
  if (affiliate.status !== AffiliateStatus.ACTIVE) {
    throw new Error("Only ACTIVE affiliates can be suspended");
  }

  const updated = await prisma.affiliate.update({
    where: { id: affiliateId },
    data: { status: AffiliateStatus.SUSPENDED },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_SUSPENDED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: { previousStatus: affiliate.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function reactivateAffiliateByAdmin(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
  });
  if (!affiliate) throw new Error("Affiliate not found");
  if (affiliate.status !== AffiliateStatus.SUSPENDED) {
    throw new Error("Only SUSPENDED affiliates can be reactivated");
  }

  const updated = await prisma.affiliate.update({
    where: { id: affiliateId },
    data: { status: AffiliateStatus.ACTIVE },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_REACTIVATED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: { previousStatus: affiliate.status },
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function updateAffiliateProfileByAdmin(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  data: {
    website?: string;
    promotionMethod?: string;
    level?: number;
    weeklyDigestEnabled?: boolean;
    reason: string;
  }
) {
  const { reason, ...profileData } = data;

  const updated = await prisma.affiliate.update({
    where: { id: affiliateId },
    data: profileData,
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_PROFILE_UPDATED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: profileData as object,
    },
  });

  return updated;
}

export async function addAffiliateAdminNote(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  content: string,
  type: SupportNoteType
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { userId: true },
  });
  if (!affiliate) throw new Error("Affiliate not found");

  const note = await addSupportNote(adminId, affiliate.userId, content, type);

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_NOTE_ADDED",
      entityType: "Affiliate",
      entityId: affiliateId,
      metadata: { noteId: note.id, type },
    },
  });

  return note;
}

export async function flagAffiliateComplianceIssue(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { id: true },
  });
  if (!affiliate) throw new Error("Affiliate not found");

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_COMPLIANCE_FLAGGED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: { flaggedAt: new Date().toISOString() },
    },
  });

  return { flagged: true };
}

export async function resolveAffiliateComplianceIssue(
  affiliateId: string,
  adminId: string,
  adminEmail: string,
  reason: string
) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { id: true },
  });
  if (!affiliate) throw new Error("Affiliate not found");

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "AFFILIATE_COMPLIANCE_RESOLVED",
      entityType: "Affiliate",
      entityId: affiliateId,
      reason,
      metadata: { resolvedAt: new Date().toISOString() },
    },
  });

  return { resolved: true };
}
