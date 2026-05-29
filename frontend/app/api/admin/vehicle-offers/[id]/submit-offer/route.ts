// POST /api/admin/vehicle-offers/[id]/submit-offer
// Admin manually enters a dealer offer (registered or outside/unregistered)
// on behalf of a dealer for a VehicleOffer. Creates a DealerOfferSubmission so
// the offer appears in the admin detail view and can be sent to the buyer.
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminError, adminSuccess, createAuditLog } from "@/lib/auth/admin-api";
import { sendDealerOfferConfirmation } from "@/lib/services/email/vehicle-offers.email";

interface Params { params: Promise<{ id: string }> }

// Shared price + bookkeeping fields for both registered and outside paths.
const commonFields = {
  vehiclePriceCents: z.number().int().min(0),
  taxCents:          z.number().int().min(0).default(0),
  feesCents:         z.number().int().min(0).default(0),
  otdPriceCents:     z.number().int().positive(),
  notes:             z.string().max(2000).optional(),
  reason:            z.string().min(1),
};

const schema = z.union([
  z.object({ dealerId: z.string().min(1), ...commonFields }),
  z.object({
    outsideDealerName:  z.string().min(1),
    outsideDealerEmail: z.string().email(),
    outsideDealerPhone: z.string().optional(),
    ...commonFields,
  }),
]);

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  const { id } = await params;

  const offer = await prisma.vehicleOffer.findUnique({ where: { id } });
  if (!offer) return adminError("NOT_FOUND", "Vehicle offer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const data = parsed.data;
  const isOutside = "outsideDealerName" in data;

  // Resolve the dealer contact details for the submission record.
  let dealershipName: string;
  let contactName: string;
  let contactEmail: string;
  let contactPhone: string;
  let dealerId: string | null = null;

  if (!isOutside) {
    const dealer = await prisma.dealer.findUnique({
      where: { id: data.dealerId },
      include: { user: { select: { email: true } } },
    });
    if (!dealer) return adminError("DEALER_NOT_FOUND", "Dealer not found", 404);
    dealerId = dealer.id;
    dealershipName = dealer.dealershipName;
    contactName = dealer.dealershipName;
    contactEmail = dealer.user?.email ?? "";
    contactPhone = dealer.phone ?? "";
  } else {
    dealershipName = data.outsideDealerName;
    contactName = data.outsideDealerName;
    contactEmail = data.outsideDealerEmail;
    contactPhone = data.outsideDealerPhone ?? "";
  }

  // Build a single DealerVehicle (matching the shape the detail UI renders)
  // from the VehicleOffer's vehicle details and the admin-entered OTD price.
  const vehicle = {
    vehicleUrl: offer.vehicleReferenceUrl ?? "",
    year: offer.vehicleYear,
    make: offer.vehicleMake,
    model: offer.vehicleModel,
    trim: offer.vehicleTrim ?? undefined,
    mileage: offer.vehicleMileage ?? undefined,
    color: offer.vehicleColor ?? undefined,
    condition: offer.vehicleCondition,
    offerPriceCents: data.otdPriceCents,
    tradeInAccepted: false,
    financingAvailable: false,
    warrantyIncluded: false,
    availability: "Manually entered by AutoLenis",
  };

  // Capture the OTD breakdown in the notes so admins retain it.
  const breakdown = `Vehicle: $${(data.vehiclePriceCents / 100).toLocaleString()} · Tax: $${(data.taxCents / 100).toLocaleString()} · Fees: $${(data.feesCents / 100).toLocaleString()} · OTD: $${(data.otdPriceCents / 100).toLocaleString()}`;
  const combinedNotes = [data.notes?.trim(), `[Admin manual entry] ${breakdown}`]
    .filter(Boolean)
    .join("\n");

  const submission = await prisma.dealerOfferSubmission.create({
    data: {
      vehicleOfferId: offer.id,
      dealershipName,
      contactName,
      contactEmail: contactEmail || "unknown@autolenis.local",
      contactPhone: contactPhone || "N/A",
      vehicles: [vehicle],
      notes: combinedNotes,
      dealerId,
    },
  });

  const vehicleLabel = `${offer.vehicleYear} ${offer.vehicleMake} ${offer.vehicleModel}${offer.vehicleTrim ? ` ${offer.vehicleTrim}` : ""}`;

  // Confirmation email to the dealer — non-blocking.
  if (contactEmail) {
    await sendDealerOfferConfirmation({
      to: contactEmail,
      contactName,
      dealershipName,
      vehicleOfferLabel: vehicleLabel,
    }).catch((err) => console.error("[submit-offer] dealer confirmation email failed:", err));
  }

  await createAuditLog(admin, request, {
    action: "OFFER_SUBMITTED_BY_ADMIN",
    entityType: "DealerOfferSubmission",
    entityId: submission.id,
    reason: data.reason,
    metadata: {
      vehicleOfferId: offer.id,
      onBehalfOf: isOutside ? "outside_dealer" : "registered_dealer",
      dealerId,
      dealershipName,
      contactEmail,
      otdPriceCents: data.otdPriceCents,
    },
  });

  return adminSuccess({ submission: { id: submission.id, dealershipName, otdPriceCents: data.otdPriceCents } }, 201);
}
