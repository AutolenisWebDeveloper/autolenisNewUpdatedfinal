// GET /api/admin/buyers/[buyerId]/prequal/errors
// Returns the PrequalAttemptError forensic history for this buyer (P0-2),
// newest first. Admin-only; never exposed to buyers.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ buyerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const errors = await prisma.prequalAttemptError.findMany({
    where: { buyerId },
    orderBy: { attemptedAt: "desc" },
    take: 200,
  });

  return adminSuccess({
    errors: errors.map((e) => ({
      id: e.id,
      prequalApplicationId: e.prequalApplicationId,
      attemptedAt: e.attemptedAt.toISOString(),
      errorStage: e.errorStage,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      httpStatus: e.httpStatus,
      requestedUrl: e.requestedUrl,
      resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
      resolvedBy: e.resolvedBy,
      resolutionNotes: e.resolutionNotes,
    })),
  });
}
