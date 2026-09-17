// lib/services/pickup/pickup.service.ts
// System 10 — pickup scheduling, check-in, completion.
//
// QR CODES ARE NO LONGER GENERATED OR STORED HERE. Until 2026-09-16 this file built a release
// credential from `Math.random()`, wrote it to `pickups.qr_code_data` in plaintext and its
// rendered PNG to `pickups.qr_code_image`. Both columns are cleared by migration
// 20261201000000 and neither is written any more. The credential is minted by
// `release-token.service.ts` (CSPRNG, SHA-256 at rest, single-use, expiry bound to the
// appointment) and rendered on demand — see `reissueReleaseCode` below.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PickupStatus } from "@prisma/client";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { enterPickupReadiness } from "@/lib/services/pickup/pickup-readiness.service";

/**
 * The admin scheduling path refused because §Stage 16's checklist is incomplete.
 *
 * Its own error type so the route can map it to a 409 naming the outstanding item, rather than
 * letting a DealTransitionError reach an operator as a 500 that says only "invalid transition".
 */
export class PickupNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickupNotReadyError";
  }
}
import { issueReleaseToken, revokeReleaseToken } from "./release-token.service";
import { renderReleaseQr } from "./qr.service";

export async function schedulePickup(dealId: string, scheduledAt: Date, location: string) {
  // No credential is minted here, deliberately. A token is only useful to whoever HOLDS the raw
  // value, and a scheduling call has nobody to hand it to — the buyer reveals theirs from the
  // pickup page, and an administrator reissues one through the reissue route. Minting on a
  // schedule would burn a token nobody ever sees and, worse, would make a reschedule look like
  // it had refreshed a code the buyer is still carrying.
  const pickup = await prisma.pickup.upsert({
    where: { dealId },
    create: {
      dealId,
      status: PickupStatus.SCHEDULED,
      scheduledAt,
      location,
    },
    update: {
      scheduledAt,
      location,
      status: PickupStatus.SCHEDULED,
      // THE APPOINTMENT CHANGED, SO WHAT WAS SENT ABOUT THE OLD ONE NO LONGER APPLIES. Same
      // reasoning as the token revocation: §Stage 17's 24h and 2h reminders are stamped per
      // appointment, and leaving the markers set means the NEW time gets no reminders at all —
      // silently, because a reminder that is never sent looks exactly like one that was not due.
      reminder24hSentAt: null,
      reminder2hSentAt: null,
    },
  });

  // Any credential minted for the PREVIOUS time is retired here, for the same reason
  // `reschedulePickup` retires one: a token's expiry is bound to `scheduledAt`, so re-scheduling
  // through this upsert would otherwise leave a live code dated to an appointment that no longer
  // exists. A no-op on a first schedule (nothing minted yet) and non-fatal by design — failing to
  // revoke must not strand an otherwise-valid scheduling call.
  await revokeReleaseToken(dealId).catch((e: unknown) =>
    logger.error(`[pickup] failed to revoke the release token while scheduling deal ${dealId}:`, e),
  );

  // Advance deal status (admin-initiated scheduling — authoritative; records history).
  //
  // NO LONGER `force: true`. That override made this route the bypass for the whole release
  // ladder: an admin could schedule a pickup on a deal in ANY status — unsigned, un-executed,
  // financing still IN_PROGRESS — and the dealer's QR scan would then complete it, because the
  // scan's only gate was insurance. That is spot delivery through an admin screen, and it is
  // exactly what §Stage 14 forbids. The transition guard now decides, so scheduling is legal
  // only from FUNDING_PENDING — after the six-item clearance list.
  // PHASE 9. `FUNDING_PENDING → PICKUP_SCHEDULED` is no longer an edge — §Stage 16's readiness
  // evaluation sits between them, and "nothing is scheduled while any item is unmet". This is the
  // Operations path §Stage 17 describes ("After two unsuccessful counter rounds, Operations
  // schedules directly"), so it evaluates the same thirteen rather than getting its own rule:
  // an admin scheduling around the checklist is the bypass the checklist exists to prevent.
  const readiness = await enterPickupReadiness(dealId, { actorRole: "ADMIN" });
  if (!readiness.schedulable) {
    const first = readiness.evaluation.outstanding[0];
    throw new PickupNotReadyError(
      first
        ? `Pickup readiness is incomplete: ${first.detail} (owner: ${first.owner})`
        : "This deal is not ready for pickup scheduling.",
    );
  }

  await advanceDealStatus(dealId, "PICKUP_SCHEDULED", { actorRole: "ADMIN" });

  // Notify buyer
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (deal) {
    await prisma.notification.create({
      data: {
        buyerId: deal.buyerId,
        title: "Vehicle pickup scheduled",
        // Says where the code comes from rather than that one is "ready": there is no stored
        // code to be ready any more, and telling a buyer otherwise sends them looking for it.
        body: `Your pickup is scheduled for ${scheduledAt.toLocaleDateString()}. Show your pickup code from the pickup page when you arrive.`,
        type: "PICKUP_SCHEDULED",
      },
    }).catch(() => {});
  }

  return pickup;
}

export interface ReissuedReleaseCode {
  /** Data-URL PNG of the raw token. Return it to the caller; never write it anywhere. */
  image: string;
  expiresAt: Date;
}

/**
 * Mint a fresh release credential and return its rendered QR — the successor to `regenerateQr`.
 *
 * RENAMED, because the contract changed in two ways a caller must see. It can now REFUSE
 * (`null`) — `regenerateQr` minted a live 48-hour code for a pickup in any state, including one
 * never scheduled, so an administrator could produce a code that opens a car with no appointment
 * behind it. And it REVOKES: writing a new hash retires the previous credential, so a reissue is
 * not an extra code, it is a replacement. A signature change alone would have made both callers
 * recompile; the name makes the next reader stop.
 *
 * Returns null when the pickup does not exist or is not in a releasable state. The caller decides
 * what to say about that — both current callers answer 409 with the reason.
 */
export async function reissueReleaseCode(dealId: string): Promise<ReissuedReleaseCode | null> {
  const issued = await issueReleaseToken({ dealId });
  if (!issued) return null;
  return { image: await renderReleaseQr(issued.rawToken), expiresAt: issued.expiresAt };
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
