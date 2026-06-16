// lib/services/pickup/pickup.service.ts
// System 10 — QR code generation, scheduling, check-in
// QR uses qrcode npm package — never an external API (D7)

import { prisma } from "@/lib/prisma";
import { PickupStatus } from "@prisma/client";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import QRCode from "qrcode";

// Generate QR payload for vehicle pickup
function generateQrPayload(dealId: string, pickupId: string): string {
  return JSON.stringify({
    type: "autolenis_pickup",
    dealId,
    pickupId,
    nonce: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    issuedAt: new Date().toISOString(),
  });
}

export async function schedulePickup(dealId: string, scheduledAt: Date, location: string) {
  const qrPayload = generateQrPayload(dealId, "pending");

  // Generate QR code image using local qrcode library (D7 — no external API)
  const qrCodeImage = await QRCode.toDataURL(qrPayload, { width: 300 });

  const pickup = await prisma.pickup.upsert({
    where: { dealId },
    create: {
      dealId,
      status: PickupStatus.SCHEDULED,
      scheduledAt,
      location,
      qrCodeData: qrPayload,
      qrCodeImage,
      qrExpiresAt: new Date(scheduledAt.getTime() + 48 * 3600000),
    },
    update: {
      scheduledAt,
      location,
      status: PickupStatus.SCHEDULED,
      qrCodeData: qrPayload,
      qrCodeImage,
      qrExpiresAt: new Date(scheduledAt.getTime() + 48 * 3600000),
    },
  });

  // Advance deal status (admin-initiated scheduling — authoritative; records history)
  await advanceDealStatus(dealId, "PICKUP_SCHEDULED", { actorRole: "ADMIN", force: true });

  // Notify buyer
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (deal) {
    await prisma.notification.create({
      data: {
        buyerId: deal.buyerId,
        title: "Vehicle pickup scheduled",
        body: `Your pickup is scheduled for ${scheduledAt.toLocaleDateString()}. Your QR code is ready.`,
        type: "PICKUP_SCHEDULED",
      },
    }).catch(() => {});
  }

  return pickup;
}

export async function regenerateQr(dealId: string): Promise<string> {
  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
  if (!pickup) throw new Error("Pickup not found");

  const qrPayload = generateQrPayload(dealId, pickup.id);
  const qrCodeImage = await QRCode.toDataURL(qrPayload, { width: 300 });

  await prisma.pickup.update({
    where: { dealId },
    data: {
      qrCodeData: qrPayload,
      qrCodeImage,
      qrExpiresAt: new Date(Date.now() + 48 * 3600000),
    },
  });

  return qrCodeImage;
}

export async function checkInPickup(dealId: string): Promise<void> {
  await prisma.pickup.update({
    where: { dealId },
    data: { status: PickupStatus.CHECKED_IN },
  });
}

export async function completePickup(dealId: string): Promise<void> {
  await prisma.pickup.update({
    where: { dealId },
    data: { status: PickupStatus.COMPLETED, completedAt: new Date() },
  });

  // Routes through the guarded seam — enforces the insurance gate before COMPLETED.
  await advanceDealStatus(dealId, "COMPLETED", { actorRole: "SYSTEM" });

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (deal) {
    await prisma.notification.create({
      data: {
        buyerId: deal.buyerId,
        title: "Pickup complete — congratulations!",
        body: "Your vehicle has been delivered. Enjoy your new car!",
        type: "PICKUP_READY",
      },
    }).catch(() => {});

    await prisma.buyerActivityEvent.create({
      data: { buyerId: deal.buyerId, eventType: "DEAL_COMPLETED", title: "Vehicle pickup complete", metadata: { dealId } },
    }).catch(() => {});
  }
}
