// lib/services/pickup/scheduling.service.ts
import { prisma } from "@/lib/prisma";
import { PickupStatus } from "@prisma/client";
import { generatePickupQr } from "./qr.service";

export async function scheduleVehiclePickup(dealId: string, date: Date, location: string) {
  const { data: qrData, image: qrImage } = await generatePickupQr(dealId, "initial");
  return prisma.pickup.upsert({
    where: { dealId },
    create: { dealId, scheduledAt: date, location, status: PickupStatus.SCHEDULED, qrCodeData: qrData, qrCodeImage: qrImage, qrExpiresAt: new Date(date.getTime() + 48 * 3600000) },
    update: { scheduledAt: date, location, qrCodeData: qrData, qrCodeImage: qrImage, qrExpiresAt: new Date(date.getTime() + 48 * 3600000) },
  });
}

export async function reschedulePickup(dealId: string, newDate: Date, reason?: string, location?: string) {
  await prisma.pickup.update({ where: { dealId }, data: { scheduledAt: newDate, status: PickupStatus.RESCHEDULED, ...(location ? { location } : {}) } });
  await prisma.buyerActivityEvent.create({ data: { buyerId: (await prisma.deal.findUnique({ where: { id: dealId }, select: { buyerId: true } }))?.buyerId ?? "", eventType: "PICKUP_RESCHEDULED", title: "Pickup rescheduled", metadata: { newDate: newDate.toISOString(), reason } as object } }).catch(() => {});
}
