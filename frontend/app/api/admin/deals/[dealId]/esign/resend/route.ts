// POST /api/admin/deals/[dealId]/esign/resend
// Resends the signing email to the buyer for an active envelope.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { resendEnvelope } from "@/lib/services/esign/esign.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope) return adminError("NOT_FOUND", "Envelope not found", 404);
  if (envelope.status === "COMPLETED") return adminError("CONFLICT", "Envelope is already completed", 409);
  if (envelope.status === "VOIDED") return adminError("CONFLICT", "Cannot resend a voided envelope", 409);

  await resendEnvelope(dealId);

  await createAuditLog(admin, request, {
    action: "ESIGN_ENVELOPE_RESENT",
    entityType: "Deal",
    entityId: dealId,
    metadata: { envelopeId: envelope.id, envelopeStatus: envelope.status },
  });

  return adminSuccess({ success: true });
}
