// lib/services/pickup/scheduling.service.ts
import { prisma } from "@/lib/prisma";
import { PickupStatus } from "@prisma/client";
import { generatePickupQr } from "./qr.service";
import { checkPickupTime } from "./availability.service";

export async function scheduleVehiclePickup(dealId: string, date: Date, location: string) {
  const { data: qrData, image: qrImage } = await generatePickupQr(dealId, "initial");
  return prisma.pickup.upsert({
    where: { dealId },
    create: { dealId, scheduledAt: date, location, status: PickupStatus.SCHEDULED, qrCodeData: qrData, qrCodeImage: qrImage, qrExpiresAt: new Date(date.getTime() + 48 * 3600000) },
    update: { scheduledAt: date, location, qrCodeData: qrData, qrCodeImage: qrImage, qrExpiresAt: new Date(date.getTime() + 48 * 3600000) },
  });
}

export interface RescheduleOptions {
  reason?: string;
  location?: string;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export type RescheduleResult =
  | { ok: true; pickup: Awaited<ReturnType<typeof prisma.pickup.update>> }
  | { ok: false; reason: string };

/**
 * Reschedule a pickup — the gated seam the buyer reschedule path routes through.
 * The proposed time is validated against the dealer's real availability via the
 * shared `checkPickupTime` gate. Returns a structured result so the caller maps
 * a rejection to a 400 without a write ever happening.
 *
 * (The admin path deliberately does NOT go through here: it upserts + advances
 * deal status via `pickup.service.schedulePickup`, and its audited off-hours
 * override lives at the admin route. This buyer seam has no override — buyers
 * can never schedule outside availability.)
 */
export async function reschedulePickup(
  dealId: string,
  newDate: Date,
  opts: RescheduleOptions = {},
): Promise<RescheduleResult> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      offer: { select: { dealerId: true } },
      pickup: { select: { id: true, status: true } },
    },
  });
  if (!deal?.pickup) return { ok: false, reason: "No pickup is scheduled for this deal." };
  if (deal.pickup.status === PickupStatus.COMPLETED) {
    return { ok: false, reason: "Cannot reschedule a completed pickup." };
  }

  // The gate: a reschedule must respect the dealer's real availability, exactly
  // like initial scheduling.
  const within = await checkPickupTime(deal.offer?.dealerId ?? null, newDate, opts.now ?? new Date());
  if (!within.ok) return { ok: false, reason: within.reason };

  const pickup = await prisma.pickup.update({
    where: { dealId },
    data: {
      scheduledAt: newDate,
      status: PickupStatus.RESCHEDULED,
      ...(opts.location ? { location: opts.location } : {}),
    },
  });

  await prisma.buyerActivityEvent
    .create({
      data: {
        buyerId: deal.buyerId,
        eventType: "PICKUP_RESCHEDULED",
        title: "Pickup rescheduled",
        metadata: {
          newDate: newDate.toISOString(),
          reason: opts.reason ?? null,
        } as object,
      },
    })
    .catch(() => {});

  return { ok: true, pickup };
}
