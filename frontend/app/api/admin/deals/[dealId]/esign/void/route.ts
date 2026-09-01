// POST /api/admin/deals/[dealId]/esign/void
// Voids an existing signing envelope. Requires reason (min 10 chars).
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { voidEnvelope } from "@/lib/services/esign/esign.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const adminCheck = await requirePermissionStrict(request, "deals.esign.void");
  // Enforced directly (not via the shadow flag): this route had no role
  // check at all, so every authenticated admin could reach it.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;

  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope) return adminError("NOT_FOUND", "Envelope not found", 404);
  if (envelope.status === "VOIDED") return adminError("CONFLICT", "Envelope is already voided", 409);
  if (envelope.status === "COMPLETED") return adminError("CONFLICT", "Cannot void a completed envelope", 409);
  // DECLINED / EXPIRED are terminal, immutable records — never cross-transitioned.
  if (envelope.status === "DECLINED" || envelope.status === "EXPIRED") {
    return adminError("CONFLICT", `Cannot void a ${envelope.status.toLowerCase()} envelope (terminal record)`, 409);
  }

  await voidEnvelope(dealId, reason);

  await createAuditLog(admin, request, {
    action: "ESIGN_ENVELOPE_VOIDED",
    entityType: "Deal",
    entityId: dealId,
    reason,
    metadata: { envelopeId: envelope.id, previousStatus: envelope.status },
  });

  return adminSuccess({ success: true });
}
