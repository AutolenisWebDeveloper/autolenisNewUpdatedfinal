// GET /api/admin/buyers/[buyerId]/prequal/history
// Returns ComplianceEvent + AdminAuditLog history for this buyer's prequal.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ buyerId: string }> }

const PREQUAL_AUDIT_ACTIONS = [
  "PREQUAL_IPREDICT_RUN",
  "PREQUAL_MANUAL_OVERRIDE",
  // Decisions made on the /admin/prequal/[id] decide rail — previously
  // omitted, so detail-page approvals/declines never appeared in this history.
  "PREQUAL_MANUAL_APPROVE",
  "PREQUAL_MANUAL_DECLINE",
  "PREQUAL_IPREDICT_RUN_BLOCKED_NO_CONSENT",
  "PREQUAL_APPROVAL_EMAIL_RESENT",
  "PREQUAL_ADVERSE_ACTION_EMAIL_RESENT",
  // OFAC dispositions are part of the prequal story too.
  "OFAC_CLEAR",
  "OFAC_ESCALATE",
];

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const [compliance, audits] = await Promise.all([
    prisma.complianceEvent.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.adminAuditLog.findMany({
      where: { action: { in: PREQUAL_AUDIT_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // Filter audit logs to this buyer (metadata.buyerId or entityId == prequal id
  // for this buyer). Cheaper than joining on every call.
  const buyerAudits = audits.filter((a) => {
    const meta = a.metadata as { buyerId?: string } | null;
    return meta?.buyerId === buyerId;
  });

  return adminSuccess({
    complianceEvents: compliance.map((c) => ({
      id: c.id,
      eventType: c.eventType,
      prequalApplicationId: c.prequalApplicationId,
      metadata: c.metadata,
      createdAt: c.createdAt.toISOString(),
    })),
    adminAuditLogs: buyerAudits.map((a) => ({
      id: a.id,
      action: a.action,
      adminEmail: a.adminEmail,
      reason: a.reason,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}
