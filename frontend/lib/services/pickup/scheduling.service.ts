// lib/services/pickup/scheduling.service.ts
import { prisma } from "@/lib/prisma";
import { PickupStatus } from "@prisma/client";
import { checkPickupTime } from "./availability.service";

// A reschedule (D1) applies only to a pickup that is ALREADY a confirmed booking.
// It must never touch the D2 coordination round-trip (PROPOSED / DEALER_COUNTERED
// / EXCEPTION) — those advance only through pickup-coordination.service, and a
// raw reschedule would bypass dealer confirmation, the CAS token, and the counter
// cap (and could revert an admin escalation).
const RESCHEDULABLE_STATUSES: ReadonlySet<PickupStatus> = new Set<PickupStatus>([
  PickupStatus.SCHEDULED,
  PickupStatus.RESCHEDULED,
  PickupStatus.CHECKED_IN,
]);

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
  if (!RESCHEDULABLE_STATUSES.has(deal.pickup.status)) {
    // PROPOSED / DEALER_COUNTERED / EXCEPTION / NOT_SCHEDULED — still in (or not
    // yet in) the coordination round-trip; reschedule is not a valid action.
    return { ok: false, reason: "This pickup is still being coordinated with the dealership." };
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
