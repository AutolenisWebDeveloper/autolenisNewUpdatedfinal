// POST /api/admin/vehicle-requests/[id]/send-to-dealers
//
// Creates per-dealer VehicleOfferDealerInvite rows for an existing VehicleOffer
// and sends each invited dealer a personalized link to submit their offer.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminError, adminSuccess, createAuditLog } from "@/lib/auth/admin-api";
import { sendVehicleOfferInvitationEmail } from "@/lib/services/email/vehicle-offers.email";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

const dealerSchema = z.object({
  dealershipName: z.string().min(1).max(150),
  contactName:    z.string().max(100).optional(),
  dealerEmail:    z.string().email(),
  dealerPhone:    z.string().max(40).optional(),
});

const schema = z.object({
  vehicleOfferId: z.string().min(1),
  dealers:        z.array(dealerSchema).min(1).max(20),
  expiresAt:      z.string().optional(),
});

interface Params { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  const { id: requestId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const offer = await prisma.vehicleOffer.findUnique({ where: { id: parsed.data.vehicleOfferId } });
  if (!offer) return adminError("NOT_FOUND", "Vehicle offer not found", 404);

  let expiresAt: Date | null = null;
  if (parsed.data.expiresAt) {
    const d = new Date(parsed.data.expiresAt);
    if (!isNaN(d.getTime())) expiresAt = d;
  }

  const created = await Promise.all(
    parsed.data.dealers.map((d) =>
      prisma.vehicleOfferDealerInvite.create({
        data: {
          vehicleOfferId: offer.id,
          dealershipName: d.dealershipName.trim(),
          contactName:    d.contactName?.trim() || null,
          dealerEmail:    d.dealerEmail.toLowerCase().trim(),
          dealerPhone:    d.dealerPhone?.trim() || null,
          status:         "sent",
          expiresAt,
        },
      })
    )
  );

  const expiryHuman = expiresAt
    ? expiresAt.toLocaleString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No deadline set";

  await Promise.allSettled(
    created.map((invite) =>
      sendVehicleOfferInvitationEmail({
        to: invite.dealerEmail,
        contactName: invite.contactName ?? invite.dealershipName,
        dealershipName: invite.dealershipName,
        submissionUrl: `${APP_URL}/dealer-offer/${invite.token}`,
        expiresAt: expiryHuman,
        vehicleYear: offer.vehicleYear,
        vehicleMake: offer.vehicleMake,
        vehicleModel: offer.vehicleModel,
        vehicleTrim: offer.vehicleTrim ?? undefined,
        vehicleCondition: offer.vehicleCondition,
        vehicleReferenceUrl: offer.vehicleReferenceUrl ?? undefined,
        buyerCity: offer.buyerCity ?? "",
        buyerState: offer.buyerState ?? "",
        buyerZip: offer.buyerZip,
        buyerTimeline: offer.buyerTimeline ?? "Not specified",
        buyerBudget: offer.buyerBudget,
        buyerMonthlyGoal: offer.buyerMonthlyPayment ?? undefined,
        buyerDownPayment: offer.buyerDownPayment ?? undefined,
        buyerFinancing: offer.buyerFinancing,
        buyerHasTradeIn: offer.buyerHasTradeIn,
        buyerTradeYear: offer.buyerTradeYear ?? undefined,
        buyerTradeMake: offer.buyerTradeMake ?? undefined,
        buyerTradeModel: offer.buyerTradeModel ?? undefined,
        buyerOpenToAlt: offer.buyerOpenToAlt,
        adminNotes: offer.adminNotes ?? undefined,
      }).catch((err) => logger.error(`[send-to-dealers] email failed for ${invite.dealerEmail}:`, err))
    )
  );

  // Mark offer + originating request as "sent_to_dealers"
  await prisma.vehicleOffer.update({
    where: { id: offer.id },
    data: { requestStatus: "sent_to_dealers" },
  }).catch((err) => logger.error("[send-to-dealers] offer status update failed:", err));

  try {
    const notif = await prisma.notification.findUnique({ where: { id: requestId } });
    if (notif?.title?.startsWith("Vehicle Request:")) {
      const meta = (notif.metadata ?? {}) as Record<string, unknown>;
      await prisma.notification.update({
        where: { id: requestId },
        data: { metadata: { ...meta, requestStatus: "sent_to_dealers" } as Parameters<typeof prisma.notification.update>[0]["data"]["metadata"] },
      });
    }
  } catch (err) {
    logger.error("[send-to-dealers] notification status update failed:", err);
  }

  await createAuditLog(admin, request, {
    action: "VEHICLE_OFFER_SENT_TO_DEALERS",
    entityType: "VehicleOffer",
    entityId: offer.id,
    metadata: {
      requestId,
      dealerCount: created.length,
      dealerEmails: created.map((c) => c.dealerEmail),
    },
  });

  return adminSuccess({
    invitations: created.map((inv) => ({
      id: inv.id,
      token: inv.token,
      dealershipName: inv.dealershipName,
      dealerEmail: inv.dealerEmail,
      status: inv.status,
      sentAt: inv.sentAt.toISOString(),
      expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
      submissionUrl: `${APP_URL}/dealer-offer/${inv.token}`,
    })),
  }, 201);
}
