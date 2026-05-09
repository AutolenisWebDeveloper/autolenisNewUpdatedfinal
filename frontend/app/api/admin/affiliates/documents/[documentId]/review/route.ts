import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

interface Props { params: Promise<{ documentId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { documentId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { status, reason } = parsed.data;

  const doc = await prisma.affiliateDocument.findUnique({ where: { id: documentId } });
  if (!doc) return adminError("NOT_FOUND", "Document not found", 404);

  await prisma.affiliateDocument.update({
    where: { id: documentId },
    data: { status, reviewedAt: new Date(), notes: reason },
  });

  // If W9 approved, mark payout method as verified
  if (status === "APPROVED" && doc.type === "W9") {
    const payoutMethod = await prisma.affiliatePayoutMethod.findUnique({
      where: { affiliateId: doc.affiliateId },
    });
    if (payoutMethod) {
      await prisma.affiliatePayoutMethod.update({
        where: { affiliateId: doc.affiliateId },
        data: { verifiedAt: new Date() },
      });
    }
  }

  await createAuditLog(admin, request, {
    action: "AFFILIATE_DOCUMENT_REVIEWED",
    entityType: "AffiliateDocument",
    entityId: documentId,
    reason,
    metadata: { affiliateId: doc.affiliateId, docType: doc.type, newStatus: status },
  });

  return adminSuccess({ success: true, status });
}
