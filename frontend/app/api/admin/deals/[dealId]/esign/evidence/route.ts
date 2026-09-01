// GET /api/admin/deals/[dealId]/esign/evidence
// Admin-only export of the COMPLETE e-sign evidence package (§11/§12): the current
// envelope plus every archived attempt, including raw forensic evidence (IP,
// user-agent, consent snapshot). This is the ONLY surface that returns that raw
// data — buyer/dealer endpoints return safe summaries. Authorization is OPS-gated
// (same role that governs esign admin actions) and every export is audit-logged.
import { NextRequest } from "next/server";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { toAdminEvidencePackage } from "@/lib/services/esign/esign-dto";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const adminCheck = await requirePermissionStrict(request, "deals.esign.void");
  // Enforced directly (not via the shadow flag): this route had no role
  // check at all, so every authenticated admin could reach it.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope) return adminError("NOT_FOUND", "No signing record for this deal", 404);

  const history = await prisma.eSignEnvelopeHistory.findMany({
    where: { dealId },
    orderBy: { attemptNumber: "asc" },
  });

  // Audit the forensic export itself (who exported the full package, when).
  await createAuditLog(admin, request, {
    action: "ESIGN_EVIDENCE_EXPORTED",
    entityType: "ESignEnvelope",
    entityId: envelope.id,
    metadata: { dealId, attempts: history.length + 1 },
  });

  return adminSuccess(toAdminEvidencePackage(envelope, history));
}
