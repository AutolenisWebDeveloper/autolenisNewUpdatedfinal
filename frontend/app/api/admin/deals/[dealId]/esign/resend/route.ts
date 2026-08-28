// POST /api/admin/deals/[dealId]/esign/resend
// Resends the signing email to the buyer for an active envelope.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { resendEnvelope } from "@/lib/services/esign/esign.service";
import { ESignSchemaUnavailableError } from "@/lib/services/esign/buyer-signing.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId }, select: { id: true, status: true } });
  if (!envelope) return adminError("NOT_FOUND", "Envelope not found", 404);
  if (envelope.status === "COMPLETED") return adminError("CONFLICT", "Envelope is already completed", 409);
  if (envelope.status === "VOIDED") return adminError("CONFLICT", "Cannot resend a voided envelope", 409);
  // DECLINED / EXPIRED are terminal, immutable records. A new signing attempt must
  // go through the buyer signing flow (which archives the terminal record).
  if (envelope.status === "DECLINED" || envelope.status === "EXPIRED") {
    return adminError("CONFLICT", `Cannot resend a ${envelope.status.toLowerCase()} envelope — start a new signing attempt instead.`, 409);
  }

  try {
    await resendEnvelope(dealId);
  } catch (err) {
    if (err instanceof ESignSchemaUnavailableError) {
      return adminError(
        "ESIGN_UNAVAILABLE",
        "Electronic signing is disabled: ESIGN_EXECUTED_ARTIFACT_ENABLED is off because the consent / " +
          "executed-artifact migrations (20261014, 20261015) are not applied to this database.",
        503,
      );
    }
    throw err;
  }

  await createAuditLog(admin, request, {
    action: "ESIGN_ENVELOPE_RESENT",
    entityType: "Deal",
    entityId: dealId,
    metadata: { envelopeId: envelope.id, envelopeStatus: envelope.status },
  });

  return adminSuccess({ success: true });
}
