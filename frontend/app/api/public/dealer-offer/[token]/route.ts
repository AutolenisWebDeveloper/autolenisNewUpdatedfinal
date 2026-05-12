// POST /api/public/dealer-offer/[token] — public dealer submission endpoint.
//
// The token can be either a per-dealer VehicleOfferDealerInvite token (from the
// invite email flow) or a generic VehicleOffer token (from the shareable link).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendDealerOfferAdminNotification,
  sendDealerOfferConfirmation,
} from "@/lib/services/email/vehicle-offers.email";

const vehicleSchema = z.object({
  vehicleUrl:         z.string().url(),
  stockNumber:        z.string().min(1).max(50),
  vin:                z.string().length(17),
  year:               z.number().int().min(2000).max(2030),
  make:               z.string().min(1).max(50),
  model:              z.string().min(1).max(80),
  trim:               z.string().max(50).optional(),
  mileage:            z.number().int().min(0).optional(),
  color:              z.string().max(50).optional(),
  interiorColor:      z.string().max(50).optional(),
  condition:          z.enum(["New", "Used", "Certified Pre-Owned"]),
  offerPriceCents:    z.number().int().min(1),
  tradeInAccepted:    z.boolean(),
  financingAvailable: z.boolean(),
  warrantyIncluded:   z.boolean(),
  warrantyDetails:    z.string().max(500).optional(),
  windowStickerUrl:   z.string().url().optional(),
  carfaxUrl:          z.string().url().optional(),
  availability:       z.enum(["In Stock Now", "Within 3 Days", "Within 1 Week", "Within 2 Weeks"]),
});

const schema = z.object({
  dealershipName:    z.string().min(1).max(150),
  contactName:       z.string().min(1).max(100),
  contactEmail:      z.string().email(),
  contactPhone:      z.string().min(7).max(40),
  vehicles:          z.array(vehicleSchema).min(1).max(3),
  notes:             z.string().max(1000).optional(),
  finderFeeAgreed:   z.literal(true),
  confirmedAccuracy: z.literal(true),
});

interface Params { params: Promise<{ token: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { token } = await params;

  // Look up either invite or generic offer
  const invite = await prisma.vehicleOfferDealerInvite.findUnique({
    where: { token },
    include: { vehicleOffer: true },
  });

  let offer = invite?.vehicleOffer ?? null;
  if (!offer) {
    offer = await prisma.vehicleOffer.findUnique({ where: { token } });
  }
  if (!offer) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Offer link not found" } },
      { status: 404 },
    );
  }

  const effectiveExpiry = invite?.expiresAt ?? offer.expiresAt;
  if (effectiveExpiry && effectiveExpiry < new Date()) {
    return NextResponse.json(
      { success: false, error: { code: "EXPIRED", message: "This offer link has expired." } },
      { status: 410 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const submission = await prisma.dealerOfferSubmission.create({
    data: {
      vehicleOfferId: offer.id,
      dealershipName: data.dealershipName,
      contactName:    data.contactName,
      contactEmail:   data.contactEmail.toLowerCase(),
      contactPhone:   data.contactPhone,
      vehicles:       data.vehicles as unknown as Parameters<typeof prisma.dealerOfferSubmission.create>[0]["data"]["vehicles"],
      notes:          data.notes ?? null,
      inviteId:       invite?.id ?? null,
    },
  });

  // Mark invite submitted (if applicable) + bump offer status to offers_in
  if (invite) {
    await prisma.vehicleOfferDealerInvite.update({
      where: { id: invite.id },
      data: { status: "submitted", submittedAt: new Date(), submissionId: submission.id },
    }).catch((err) => console.error("[dealer-offer] invite status update failed:", err));
  }

  await prisma.vehicleOffer.update({
    where: { id: offer.id },
    data: { requestStatus: "offers_in" },
  }).catch((err) => console.error("[dealer-offer] offer status update failed:", err));

  const vehicleOfferLabel = `${offer.vehicleYear} ${offer.vehicleMake} ${offer.vehicleModel}${offer.vehicleTrim ? ` ${offer.vehicleTrim}` : ""}`;

  await Promise.allSettled([
    sendDealerOfferAdminNotification({
      offerId:           offer.id,
      vehicleOfferLabel,
      dealershipName:    data.dealershipName,
      contactName:       data.contactName,
      contactEmail:      data.contactEmail,
      contactPhone:      data.contactPhone,
      vehicles:          data.vehicles,
      notes:             data.notes,
    }),
    sendDealerOfferConfirmation({
      to:                data.contactEmail,
      contactName:       data.contactName,
      dealershipName:    data.dealershipName,
      vehicleOfferLabel,
    }),
  ]);

  return NextResponse.json({ success: true });
}
