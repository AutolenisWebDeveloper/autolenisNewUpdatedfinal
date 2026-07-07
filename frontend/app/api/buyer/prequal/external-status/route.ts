import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

// GET /api/buyer/prequal/external-status — System 4B
// Status of the buyer's most recent external pre-approval submission.
// Reads the ExternalPreApproval record directly (the real source of truth) —
// previously it keyed on PreQualification.isExternal, which the submit route
// never set, so this always returned PENDING forever.
const STATUS_MAP: Record<string, string> = {
  SUBMITTED: "PENDING",
  REVIEWING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ADDITIONAL_INFO_REQUIRED: "ADDITIONAL_INFO_REQUIRED",
};

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const submission = await prisma.externalPreApproval.findFirst({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
  });

  if (!submission) {
    return successResponse({ status: "PENDING", lenderName: null, approvedAmount: null });
  }

  return successResponse({
    status: STATUS_MAP[submission.status] ?? "PENDING",
    lenderName: submission.lenderName,
    approvedAmount:
      submission.approvedAmountCents != null
        ? Math.round(submission.approvedAmountCents / 100)
        : null,
    aprRate: submission.aprRate,
    termMonths: submission.termMonths,
    expiryDate: submission.expiryDate?.toISOString() ?? null,
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
    rejectionReason: submission.rejectionReason,
    additionalInfoRequired: submission.additionalInfoRequired,
  });
}
