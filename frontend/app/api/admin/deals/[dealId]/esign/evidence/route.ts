// GET /api/admin/deals/[dealId]/esign/evidence
// Admin-only export of the COMPLETE e-sign evidence package (§11/§12): the current
// envelope plus every archived attempt, including raw forensic evidence (IP,
// user-agent, consent snapshot). This is the ONLY surface that returns that raw
// data — buyer/dealer endpoints return safe summaries. Authorization is OPS-gated
// (same role that governs esign admin actions) and every export is audit-logged.
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/permissions";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { toAdminEvidencePackage } from "@/lib/services/esign/esign-dto";
import { readEnvelopeForDeal } from "@/lib/services/esign/buyer-signing.service";
import { isExecutedArtifactEnabled } from "@/lib/services/esign/esign-schema-gate";

interface Props { params: Promise<{ dealId: string }> }

// requirePermission is shadow-only (it records a would-be denial and allows), so
// exporting the raw forensic package (IP, user-agent, consent snapshot) needs this
// hard check to be the OPS gate the header above describes.
const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "OPERATIONS_ADMIN"]);

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await requirePermission(request, "deals.esign.void");
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);

  const envelope = await readEnvelopeForDeal(dealId);
  if (!envelope) return adminError("NOT_FOUND", "No signing record for this deal", 404);

  // e_sign_envelope_history only exists once migration 20261014 is applied and the
  // gate is opened. While it is closed the archive is genuinely absent, so the
  // export reports `historyAvailable: false` rather than presenting an empty array
  // as "this deal has no superseded attempts" — an admin reading a forensic export
  // must be able to tell an empty archive from an absent one.
  const historyAvailable = isExecutedArtifactEnabled();
  const history = historyAvailable
    ? await prisma.eSignEnvelopeHistory.findMany({ where: { dealId }, orderBy: { attemptNumber: "asc" } })
    : [];

  // Audit the forensic export itself (who exported the full package, when).
  await createAuditLog(admin, request, {
    action: "ESIGN_EVIDENCE_EXPORTED",
    entityType: "ESignEnvelope",
    entityId: envelope.id,
    metadata: { dealId, attempts: history.length + 1, historyAvailable },
  });

  return adminSuccess(toAdminEvidencePackage(envelope, history, historyAvailable));
}
