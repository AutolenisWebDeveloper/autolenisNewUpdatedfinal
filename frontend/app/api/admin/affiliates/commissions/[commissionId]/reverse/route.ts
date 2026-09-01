// POST /api/admin/affiliates/commissions/[commissionId]/reverse
// Reverses an existing commission.
// Body: { reason: string }
// Validates commission is not already REVERSED or PAID
// Sets commission.status = REVERSED
// Writes AuditLog: COMMISSION_REVERSED with previousState={status: oldStatus}
// Requires reason (min 10 chars)
// FINANCE_ADMIN or SUPER_ADMIN only

import { requirePermissionStrict } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ commissionId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});


// Thrown inside the transaction when the compare-and-set matches 0 rows —
// a concurrent transition already moved this commission.
class TransitionConflictError extends Error {}

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const adminCheck = await requirePermissionStrict(request, "finance.commissions.reverse");
  // Hard-enforced (not via the shadow flag), and the allow-list is read from
  // PERMISSION_ROLES rather than restated here: a duplicated inline role set is
  // a second source of policy that can drift from the matrix it is meant to mirror.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;
  // Role check lives in the gate above, derived from PERMISSION_ROLES
  // ("finance.commissions.*" = SUPER_ADMIN, FINANCE_ADMIN). A second hardcoded
  // set here would be a copy that can silently drift from the matrix — which is
  // exactly how the impersonation routes came to disagree with it.

  const commission = await prisma.commission.findUnique({ where: { id: commissionId } });
  if (!commission) return adminError("NOT_FOUND", "Commission not found", 404);

  if (commission.status === "REVERSED") return adminError("ALREADY_REVERSED", "Commission is already reversed", 400);
  if (commission.status === "PAID") return adminError("ALREADY_PAID", "Cannot reverse a paid commission", 400);
  // M5 — REJECTED is terminal: it never counted as earned, so "reversing" it
  // would fabricate a transition that has no meaning in the ledger.
  if (commission.status === "REJECTED") return adminError("ALREADY_REJECTED", "Cannot reverse a rejected commission", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;
  const oldStatus = commission.status;
  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  // M5/D13 — the flip is a compare-and-set scoped to the reversible states,
  // and the audit row commits atomically with it: a concurrent transition
  // 409s cleanly, and a reversal can never commit unlogged.
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.commission.updateMany({
        where: { id: commissionId, status: { in: ["PENDING", "APPROVED"] } },
        // D13 — stamp the reversal on the row itself (migration 001).
        data: { status: "REVERSED", reversedAt: new Date() },
      });
      if (claimed.count !== 1) throw new TransitionConflictError();
      await tx.adminAuditLog.create({
        data: {
          adminId: admin.adminId,
          adminEmail: admin.email,
          action: "COMMISSION_REVERSED",
          entityType: "Commission",
          entityId: commissionId,
          reason,
          previousState: { status: oldStatus },
          newState: { status: "REVERSED" },
          ipAddress: ipAddress ?? null,
          metadata: { affiliateId: commission.affiliateId, dealId: commission.dealId, amountCents: commission.amountCents },
        },
      });
    });
  } catch (err) {
    if (err instanceof TransitionConflictError) {
      return adminError("CONFLICT", "Commission is no longer reversible — a concurrent transition won", 409);
    }
    logger.error("[commissions/reverse] transition failed:", err);
    return adminError("INTERNAL", "Reversal failed — nothing was changed", 500);
  }

  return adminSuccess({ commission: { id: commissionId, status: "REVERSED" } });
}
