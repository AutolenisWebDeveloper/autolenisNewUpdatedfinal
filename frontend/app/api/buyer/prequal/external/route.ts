// POST /api/buyer/prequal/external
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  lenderName: z.string().min(2, "Lender name is required"),
  approvedAmountCents: z.number().int().positive("Approved amount must be positive"),
  apr: z.number().min(0).max(50, "APR must be between 0 and 50%"),
  termMonths: z.number().int().min(12).max(96, "Term must be between 12 and 96 months"),
  expiresAt: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const { lenderName, approvedAmountCents, apr, termMonths, expiresAt } = parsed.data;

  const submission = await prisma.externalPreApproval.create({
    data: {
      buyerId: buyer.id,
      lenderName,
      approvedAmountCents,
      aprRate: apr,
      termMonths,
      expiryDate: expiresAt ? new Date(expiresAt) : null,
    },
  });

  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type: "DEAL_STAGE_CHANGED",
      title: "Pre-approval submitted",
      body: `Your ${lenderName} pre-approval has been submitted for review. Our team will verify and update your profile within 1 business day.`,
    },
  }).catch((err: unknown) => { console.error("[ExternalPrequal] Failed to create notification:", err); });

  return successResponse({ submissionId: submission.id, status: submission.status });
}
