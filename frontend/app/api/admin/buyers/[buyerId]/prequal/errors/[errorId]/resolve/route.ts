// POST /api/admin/buyers/[buyerId]/prequal/errors/[errorId]/resolve
// Marks a PrequalAttemptError resolved and writes an AdminAuditLog entry (P0-2).
// Restricted to operational/compliance roles.
import { NextRequest } from "next/server";
import {
  getAdminWithRole,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ buyerId: string; errorId: string }> }

const resolveSchema = z.object({
  resolutionNotes: z.string().max(2000).optional().nullable(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId, errorId } = await params;
  const admin = await getAdminWithRole(request, [
    "SUPER_ADMIN",
    "OPERATIONS_ADMIN",
    "COMPLIANCE_ADMIN",
  ]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const existing = await prisma.prequalAttemptError.findUnique({
    where: { id: errorId },
    select: { id: true, buyerId: true, resolvedAt: true },
  });
  if (!existing || existing.buyerId !== buyerId) {
    return adminError("NOT_FOUND", "Prequal attempt error not found", 404);
  }
  if (existing.resolvedAt) {
    return adminError("ALREADY_RESOLVED", "This error is already resolved", 409);
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is allowed */
  }
  const parsed = resolveSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const updated = await prisma.prequalAttemptError.update({
    where: { id: errorId },
    data: {
      resolvedAt: new Date(),
      resolvedBy: admin.email,
      resolutionNotes: parsed.data.resolutionNotes ?? null,
    },
  });

  await createAuditLog(admin, request, {
    action: "PREQUAL_ATTEMPT_ERROR_RESOLVED",
    entityType: "PrequalAttemptError",
    entityId: errorId,
    metadata: {
      buyerId,
      errorStage: updated.errorStage,
      errorCode: updated.errorCode,
    },
  });

  return adminSuccess({
    error: {
      id: updated.id,
      resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
      resolvedBy: updated.resolvedBy,
      resolutionNotes: updated.resolutionNotes,
    },
  });
}
