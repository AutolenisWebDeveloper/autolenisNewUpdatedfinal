// POST /api/buyer/insurance/request-quote
// Accepts: dealId, coverageType, currentInsurer?, driverDob?, additionalInfo?
// Updates deal.insuranceStatus to QUOTE_REQUESTED
// Creates a buyer notification confirming submission
// Creates an AdminAuditLog entry so the admin can see and respond to the request
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  dealId:         z.string().uuid("Invalid deal ID"),
  coverageType:   z.enum(["full", "liability", "gap"]),
  currentInsurer: z.string().max(100).optional().nullable(),
  driverDob:      z.string().optional().nullable(),
  additionalInfo: z.string().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid input",
      400,
    );
  }

  const { dealId, coverageType, currentInsurer, driverDob, additionalInfo } = parsed.data;

  // Verify deal ownership
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: { offer: { select: { otdPriceCents: true } } },
  });

  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // Prevent duplicate requests
  if (
    deal.insuranceStatus === "QUOTE_REQUESTED" ||
    deal.insuranceStatus === "QUOTE_RECEIVED"  ||
    deal.insuranceStatus === "POLICY_SELECTED" ||
    deal.insuranceStatus === "POLICY_BOUND"    ||
    deal.insuranceStatus === "VERIFIED"
  ) {
    return errorResponse(
      "ALREADY_REQUESTED",
      "A quote request has already been submitted for this deal.",
      409,
    );
  }

  // Resolve vehicle info via buyer shortlist (ShortlistItem has no Prisma relation).
  // Must match the insurance page's resolution (addedAt desc = most recently
  // shortlisted) so the vehicle recorded on the quote is the one shown to the buyer.
  let vehicleSummary = "Vehicle details unavailable";
  try {
    const shortlist = await prisma.shortlist.findUnique({
      where: { buyerId: buyer.id },
      include: { items: { take: 1, orderBy: { addedAt: "desc" } } },
    });
    const firstItemId = shortlist?.items[0]?.inventoryItemId ?? null;
    if (firstItemId) {
      const inv = await prisma.inventoryItem.findUnique({
        where: { id: firstItemId },
        select: { year: true, make: true, model: true, trim: true, vin: true },
      });
      if (inv) {
        vehicleSummary =
          `${inv.year} ${inv.make} ${inv.model}` +
          (inv.trim ? ` ${inv.trim}` : "") +
          (inv.vin  ? ` (VIN: ${inv.vin})` : "");
      }
    }
  } catch (err) {
    logger.error("[insurance-quote] vehicle lookup failed:", err);
  }

  // Update deal insurance status
  await prisma.deal.update({
    where: { id: dealId },
    data:  { insuranceStatus: "QUOTE_REQUESTED" },
  });

  // Write AdminAuditLog so admin sees this in their dashboard
  await prisma.adminAuditLog.create({
    data: {
      adminId:    "system",
      adminEmail: "system@autolenis.com",
      action:     "INSURANCE_QUOTE_REQUESTED",
      entityType: "DEAL",
      entityId:   dealId,
      metadata: {
        buyerId:        buyer.id,
        buyerName:      `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim(),
        dealId,
        vehicle:        vehicleSummary,
        otdPriceCents:  deal.offer?.otdPriceCents ?? null,
        coverageType,
        currentInsurer: currentInsurer ?? null,
        driverDob:      driverDob ?? null,
        additionalInfo: additionalInfo ?? null,
        requestedAt:    new Date().toISOString(),
      },
    },
  }).catch((err: unknown) => {
    logger.error("[insurance-quote] AdminAuditLog failed:", err);
  });

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type:    "DEAL_STAGE_CHANGED",
      title:   "Insurance quote requested",
      body:    `Your insurance quote request for the ${vehicleSummary} has been submitted. Our team will review and respond within 1 business day.`,
    },
  }).catch((err: unknown) => {
    logger.error("[insurance-quote] buyer notification failed:", err);
  });

  return successResponse({ status: "QUOTE_REQUESTED", vehicleSummary });
}
