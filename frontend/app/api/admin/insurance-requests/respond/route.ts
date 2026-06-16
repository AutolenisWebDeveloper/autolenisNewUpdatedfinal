// POST /api/admin/insurance-requests/respond
// Admin responds to a buyer's insurance quote request.
// Sets deal.insuranceStatus → QUOTE_RECEIVED
// Creates a buyer notification with the quote amount and optional note
// Writes an AdminAuditLog entry confirming the response
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  dealId:        z.string().uuid("Invalid deal ID"),
  buyerId:       z.string().uuid("Invalid buyer ID"),
  premiumCents:  z.number().int().positive("Premium must be a positive number"),
  note:          z.string().max(300).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid input",
      400,
    );
  }

  const { dealId, buyerId, premiumCents, note } = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, buyerId: true, insuranceStatus: true },
  });

  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);
  if (deal.buyerId !== buyerId) return adminError("FORBIDDEN", "Buyer/deal mismatch", 403);

  if (deal.insuranceStatus !== "QUOTE_REQUESTED") {
    return adminError(
      "INVALID_STATUS",
      `Cannot respond to a request in status: ${deal.insuranceStatus}`,
      409,
    );
  }

  await prisma.deal.update({
    where: { id: dealId },
    data:  { insuranceStatus: "QUOTE_RECEIVED" },
  });

  const premiumFormatted = `$${(premiumCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`;
  const notificationBody = note
    ? `Your insurance quote is ready: ${premiumFormatted}. ${note}`
    : `Your insurance quote is ready: ${premiumFormatted}. Log in to review and select your coverage.`;

  await prisma.notification.create({
    data: {
      buyerId,
      type:  "INSURANCE_BOUND",
      title: "Your insurance quote is ready",
      body:  notificationBody,
    },
  }).catch((err: unknown) => {
    logger.error("[insurance-respond] buyer notification failed:", err);
  });

  await createAuditLog(admin, request, {
    action:     "INSURANCE_QUOTE_RESPONDED",
    entityType: "DEAL",
    entityId:   dealId,
    metadata: {
      premiumCents,
      premiumFormatted,
      note:         note ?? null,
      respondedAt:  new Date().toISOString(),
    },
  }).catch((err: unknown) => {
    logger.error("[insurance-respond] audit log failed:", err);
  });

  return adminSuccess({ status: "QUOTE_RECEIVED", premiumCents });
}
