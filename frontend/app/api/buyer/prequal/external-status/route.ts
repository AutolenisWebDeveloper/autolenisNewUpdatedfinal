import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

// GET /api/buyer/prequal/external-status — System 4B
// Returns current status of external pre-approval submission
export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const prequal = buyer.preQualification;

  // If no prequal or not external, return pending
  if (!prequal || !prequal.isExternal) {
    return successResponse({
      status: "PENDING",
      lenderName: null,
      approvedAmount: null,
    });
  }

  // Map decision to status for the polling page
  const statusMap: Record<string, string> = {
    APPROVED: "APPROVED",
    DECLINED: "REJECTED",
    MANUAL_REVIEW: "ADDITIONAL_INFO_REQUIRED",
    OFAC_REVIEW: "PENDING",
    OFAC_ESCALATED: "PENDING",
    PENDING: "PENDING",
  };

  return successResponse({
    status: statusMap[prequal.decision] ?? "PENDING",
    // maxOtdAmountCents is READ-ONLY from iPredict — display only
    approvedAmount: prequal.decision === "APPROVED" ? Math.round(prequal.maxOtdAmountCents / 100) : null,
    expiryDate: prequal.expiresAt?.toISOString(),
    reviewedAt: prequal.updatedAt?.toISOString(),
  });
}
