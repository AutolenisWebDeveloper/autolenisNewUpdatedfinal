// POST /api/admin/buyers/[buyerId]/workflow/move
// Move a deal to a specific workflow stage.
// Records DealStatusHistory + AdminAuditLog. Requires reason.
// Only permitted stages can be set — CANCELLED/COMPLETED/REFUNDED via dedicated routes.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DealStatus } from "@prisma/client";
import { moveBuyerWorkflowStage } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

// Permitted target stages for admin move — excludes terminal states handled by dedicated routes
const PERMITTED_STAGES = [
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
] as const;

const schema = z.object({
  dealId: z.string().min(1, "Deal ID is required"),
  targetStatus: z.enum([...PERMITTED_STAGES] as [DealStatus, ...DealStatus[]], {
    errorMap: () => ({ message: `Target status must be one of: ${PERMITTED_STAGES.join(", ")}` }),
  }),
  reason: z.string().min(1, "Reason is required for workflow stage change"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await moveBuyerWorkflowStage(
      buyerId,
      admin.adminId,
      admin.email,
      parsed.data.dealId,
      parsed.data.targetStatus as DealStatus,
      parsed.data.reason
    );
    return adminSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to move workflow stage";
    return adminError("ACTION_FAILED", message, 422);
  }
}
