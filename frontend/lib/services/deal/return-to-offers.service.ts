// lib/services/deal/return-to-offers.service.ts
// §Stage 10's failure clause, in one place.
//
//   "Rejection, timeout, failed verification, unavailable inventory, or an unaccepted material
//    change returns the buyer to the remaining valid offers with the reason stated. The failure is
//    recorded on the dealership's scorecard and affects future invitation ranking. Repeated
//    failures trigger an SLA violation and review."
//
// FIVE CAUSES, ONE PATH. They arrive from five different places — the dealer route, the buyer's
// reject, the 24-hour sweep, the hold sweep, the outside-winner gate — and every one of them owes
// the buyer the same four things: the deal stood down, the firewall closed, the reason stated, and
// the dealership's record marked. Five call sites each doing three of the four is how one of them
// silently stops doing the fourth.
//
// WHY THE SCORECARD ENTRY KEYS ON THE ROOFTOP, NOT `Offer.dealerId` — a correction to §13-D20's
// stated rationale, amended by the owner at STOP 1.
//
// D20 rules that `Offer.dealerId` stays on the placeholder record "so historical attribution and
// scorecard credit are immutable". The lineage half of that ruling stands and is obeyed here:
// nothing in this file re-points `Offer.dealerId`. The scorecard half does not hold, and the
// reason is concrete rather than stylistic. `getOrCreateOutsideDealerId`
// (`lib/services/offer/outside-dealer.ts:24`) returns ONE shared system Dealer —
// `isSystemPlaceholder: true`, `status: TERMINATED`, deliberately excluded from every dealer
// query — for EVERY unregistered dealership. A scorecard entry keyed on `Offer.dealerId` for an
// outside winner therefore lands on a single row shared by every outside dealership at once,
// invisible to every dealer surface and attributable to nobody.
//
// So the failure is recorded against the ROOFTOP (`offers.rooftop_id`), which identifies the
// actual dealership on both rails. `SlaViolation` carries it directly — `entity_type` and
// `entity_id` are free TEXT, so no migration is needed. `dealer_scorecard_snapshots` cannot: its
// `dealer_id` is a required FK to `dealers`. The counter there is therefore mirrored only where a
// REAL, non-placeholder Dealer owns the rooftop, and the SLA row is the record in every case.
//
// §13-D42's window is reused rather than duplicated. `REPEAT_WINDOW_DAYS = 90` already governs
// repeat circumvention; a second 90-day window defined here would be two constants that drift
// apart, and the first time they disagreed nobody would know which was intended.

import { prisma } from "@/lib/prisma";
import { DealStatus, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { revokeIdentityFirewall } from "./identity-firewall.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { enqueueTransactional, cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_7_TEMPLATES, reaffirmationReminderCancelKey } from "@/lib/services/comms/state-recheck-registry";
import { renderReturnedToOffers } from "@/lib/services/comms/phase7-email-content";
import { REPEAT_WINDOW_DAYS } from "@/lib/services/trust/anti-circumvention.service";

export type ReturnCause =
  | "DEALER_REJECTED"
  | "DEALER_TIMED_OUT"
  | "MATERIAL_CHANGE_REJECTED"
  | "VEHICLE_UNAVAILABLE"
  | "HOLD_RELEASED"
  | "OUTSIDE_WINNER_UNVERIFIED";

/**
 * §13-D42's 90-day window, reused. §Stage 10's "repeated failures" threshold is N = 2 within that
 * window — owner-ruled at STOP 1. The SECOND failure raises the violation, so a dealership gets
 * one recorded miss before review, which is what "repeated" means.
 */
export const REAFFIRMATION_SLA_THRESHOLD = 2;

/** Which §26 row each cause files under. Every cause has one; none is absorbed. */
const EXCEPTION_CODE: Record<ReturnCause, string> = {
  DEALER_REJECTED: "WINNING_DEALER_REJECTS_OR_TIMES_OUT",
  DEALER_TIMED_OUT: "WINNING_DEALER_REJECTS_OR_TIMES_OUT",
  MATERIAL_CHANGE_REJECTED: "DEALER_MATERIAL_CHANGE",
  VEHICLE_UNAVAILABLE: "VEHICLE_SOLD_BEFORE_CONTRACT_OR_PICKUP",
  HOLD_RELEASED: "VEHICLE_HOLD_EXPIRED",
  OUTSIDE_WINNER_UNVERIFIED: "OUTSIDE_WINNER_FAILS_VERIFICATION",
};

/**
 * Causes that are the DEALERSHIP's failure and therefore reach its record. A buyer rejecting a
 * proposed change is not one: §10a gives the buyer that decision unconditionally, and counting it
 * against the dealership would make offering a legitimate correction a penalty.
 */
const DEALER_FAULT: ReturnCause[] = [
  "DEALER_REJECTED",
  "DEALER_TIMED_OUT",
  "VEHICLE_UNAVAILABLE",
  "HOLD_RELEASED",
  "OUTSIDE_WINNER_UNVERIFIED",
];

export interface ReturnToOffersResult {
  returned: boolean;
  remainingOfferCount: number;
  scorecardRecorded: boolean;
  slaViolation: boolean;
}

export async function returnToRemainingOffers(params: {
  dealId: string;
  reason: string;
  cause: ReturnCause;
  actorId: string;
  now?: Date;
}): Promise<ReturnToOffersResult> {
  const now = params.now ?? new Date();

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      status: true,
      buyerId: true,
      auctionId: true,
      rooftopId: true,
      dealerId: true,
      offerId: true,
      offer: {
        select: {
          id: true,
          auctionId: true,
          rooftopId: true,
          dealerId: true,
          dealer: { select: { isSystemPlaceholder: true } },
        },
      },
      buyer: { select: { firstName: true, user: { select: { email: true } } } },
    },
  });
  if (!deal) {
    logger.error("return-to-offers: deal not found", { dealId: params.dealId });
    return { returned: false, remainingOfferCount: 0, scorecardRecorded: false, slaViolation: false };
  }

  // The firewall closes FIRST, before anything that could throw. §13-D38 option C: the release is
  // revoked, never re-withheld, and it stops the dealer portal rendering identity. It recalls
  // nothing — the handoff already sent the details, and §25.2 is the control from here.
  await revokeIdentityFirewall(
    { dealId: params.dealId, actorId: params.actorId, reason: params.cause },
    prisma,
  ).catch((err) => {
    logger.error("return-to-offers: firewall revocation failed", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // The reminder must not arrive after the deal has stood down. Same cancel key the request and
  // the 12-hour reminder were enqueued under.
  await cancelByKey(
    reaffirmationReminderCancelKey(params.dealId),
    `deal stood down: ${params.cause}`,
  ).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });

  const auctionId = deal.auctionId ?? deal.offer?.auctionId ?? null;

  // "the remaining VALID offers" — the same three conditions the close and the report apply, so a
  // buyer is never returned to an offer the rest of the platform considers dead. Counted rather
  // than re-opened here: re-opening selection is the buyer's action on the report, not this
  // function's, and §9 admits no system that selects on their behalf.
  const remainingOfferCount = auctionId
    ? await prisma.offer.count({
        where: {
          auctionId,
          id: { not: deal.offerId ?? undefined },
          status: "SUBMITTED",
          isDisqualified: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      })
    : 0;

  await prisma.$transaction(async (tx) => {
    // The deal stands down. CANCELLED is reachable from any non-terminal state, and the reason is
    // on the history row rather than only in a log.
    await tx.deal.update({
      where: { id: params.dealId },
      data: { status: DealStatus.CANCELLED, holdReason: params.cause },
    });
    await tx.dealStatusHistory.create({
      data: {
        dealId: params.dealId,
        fromStatus: deal.status,
        toStatus: DealStatus.CANCELLED,
        actorId: params.actorId,
        actorRole: params.actorId === "system" ? "SYSTEM" : "DEALER",
        reason: `${params.cause}: ${params.reason}`,
      },
    });
    // The offer that failed is no longer selectable, so the buyer cannot be returned to it.
    if (deal.offerId) {
      await tx.offer.updateMany({
        where: { id: deal.offerId, status: { in: ["ACCEPTED", "SUBMITTED"] } },
        data: { status: "DECLINED" },
      });
    }
  });

  await raiseException({
    code: EXCEPTION_CODE[params.cause],
    dealId: params.dealId,
    buyerId: deal.buyerId,
    auctionId: auctionId ?? undefined,
    detail:
      `${params.reason} ${remainingOfferCount} remaining valid offer${remainingOfferCount === 1 ? "" : "s"} ` +
      `on this auction.`,
  }).catch((err) => {
    logger.error("return-to-offers: raiseException failed", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // §27.1 "Dealer rejects or times out → Buyer + Operations → Return-to-offers instructions".
  if (deal.buyer?.user?.email) {
    const content = renderReturnedToOffers({
      firstName: deal.buyer.firstName,
      reason: params.reason,
      remainingOfferCount,
      auctionId,
    });
    await enqueueTransactional({
      triggerEvent: "dealer_rejects_or_times_out",
      templateKey: PHASE_7_TEMPLATES.RETURNED_TO_OFFERS,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to: deal.buyer.user.email,
      payload: {
        email: deal.buyer.user.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
      },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.RETURNED_TO_OFFERS}:${params.dealId}`,
    }).catch(async (err) => {
      // NOT A BLIND CATCH, and it used to be one. `enqueueTransactional` throws when a template has
      // no registered state recheck, and this notice had none — so the §27.1 row §Stage 10 owes the
      // buyer ("returned to offers WITH THE REASON STATED") silently never enqueued, while every
      // other assertion about the stand-down passed. Found by journey 3.
      //
      // A swallowed enqueue is the exact defect class this programme has spent five phases
      // removing: a logger.error standing in for an exception. It raises.
      logger.error("return-to-offers: the buyer notice failed to enqueue", {
        dealId: params.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
      await raiseException({
        code: "COMMS_TERMINAL_FAILURE",
        dealId: params.dealId,
        buyerId: deal.buyerId,
        idempotencyKey: `RETURN_NOTICE_ENQUEUE_FAILED:${params.dealId}`,
        detail:
          "This buyer was returned to the remaining offers and the notice explaining why could not " +
          "be enqueued. Re-drive it — they have a cancelled deal and no reason for it.",
      }).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
    });
  } else {
    await raiseException({
      code: "COMMS_NO_DELIVERABLE_CHANNEL",
      dealId: params.dealId,
      buyerId: deal.buyerId,
      idempotencyKey: `COMMS_NO_CHANNEL:${PHASE_7_TEMPLATES.RETURNED_TO_OFFERS}:${params.dealId}`,
      detail:
        "This buyer has been returned to the remaining offers and has no email address, so the " +
        "reason was never delivered. Re-drive the notice once the address is fixed.",
    }).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
  }

  let scorecardRecorded = false;
  let slaViolation = false;
  if (DEALER_FAULT.includes(params.cause)) {
    const rooftopId = deal.rooftopId ?? deal.offer?.rooftopId ?? null;
    const realDealerId =
      deal.offer?.dealer?.isSystemPlaceholder === false ? deal.offer.dealerId : (deal.dealerId ?? null);
    const outcome = await recordReaffirmationFailure({
      rooftopId,
      dealerId: realDealerId,
      dealId: params.dealId,
      cause: params.cause,
      now,
    });
    scorecardRecorded = outcome.recorded;
    slaViolation = outcome.slaViolation;
  }

  return { returned: true, remainingOfferCount, scorecardRecorded, slaViolation };
}

/**
 * §Stage 10: "The failure is recorded on the dealership's scorecard ... Repeated failures trigger
 * an SLA violation and review."
 *
 * The SLA row is the primary record because it can name a rooftop; the scorecard counter is the
 * mirror, written only where a real Dealer exists to carry it. See the header for why.
 */
/**
 * One Serializable transaction, retried once on a serialization failure (P2034). Serializable's
 * contract is that one of two conflicting transactions is aborted; a caller that does not retry
 * turns correctness into a 500.
 */
async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      const retryable =
        err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2037");
      if (!retryable || attempt === 1) throw err;
    }
  }
  throw new Error("unreachable");
}

export async function recordReaffirmationFailure(params: {
  rooftopId: string | null;
  dealerId: string | null;
  dealId: string;
  cause: ReturnCause;
  now?: Date;
}): Promise<{ recorded: boolean; slaViolation: boolean; failuresInWindow: number }> {
  const now = params.now ?? new Date();
  const entityType = params.rooftopId ? "ROOFTOP" : params.dealerId ? "DEALER" : null;
  const entityId = params.rooftopId ?? params.dealerId ?? null;

  if (!entityType || !entityId) {
    // Nothing identifies the dealership. Reported, not absorbed — a failure nobody is accountable
    // for is the case §26 exists to surface.
    logger.error("reaffirmation failure: no rooftop and no real dealer to record against", {
      dealId: params.dealId,
      cause: params.cause,
    });
    return { recorded: false, slaViolation: false, failuresInWindow: 0 };
  }

  const windowStart = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 24 * 3600_000);

  // COUNT AND INSERT IN ONE TRANSACTION, because the count decides whether §Stage 10's repeat
  // threshold has been crossed and the insert is what the next count will see.
  //
  // Outside a transaction, two failures for the same rooftop processed in the same cron batch each
  // read `priorFailures = 0`, each compute `failuresInWindow = 1`, and the N = 2 SLA violation the
  // owner ruled at STOP 1 is never raised — the rooftop accrues two rows and no consequence.
  // Read Committed is not enough on its own here either: both transactions would still see the
  // pre-insert count. Serializable is, and it is the same shape the financing audit chain uses.
  const failuresInWindow = await runSerializable(async (tx) => {
    const priorFailures = await tx.slaViolation.count({
      where: {
        entityType,
        entityId,
        slaType: "REAFFIRMATION",
        breachedAt: { gte: windowStart },
      },
    });
    await tx.slaViolation.create({
      data: {
        entityType,
        entityId,
        slaType: "REAFFIRMATION",
        breachedAt: now,
        // The window is 24 hours by §Stage 10; a rejection inside it is still a breach of the
        // undertaking to complete the deal, recorded at zero hours rather than as a negative.
        hoursOverdue: 0,
        resolved: false,
      },
    });
    return priorFailures + 1;
  });

  // The counter mirror. `dealer_scorecard_snapshots.dealer_id` is a required FK, so this is
  // reachable only for a real dealership — the rooftop-only case is covered by the SLA row above.
  let recorded = false;
  if (params.dealerId) {
    const dealer = await prisma.dealer.findUnique({
      where: { id: params.dealerId },
      select: { isSystemPlaceholder: true },
    });
    // Never the shared placeholder: a counter there aggregates unrelated dealerships.
    if (dealer && !dealer.isSystemPlaceholder) {
      const latest = await prisma.dealerScorecardSnapshot.findFirst({
        where: { dealerId: params.dealerId },
        orderBy: { snapshotDate: "desc" },
      });
      if (latest) {
        await prisma.dealerScorecardSnapshot.update({
          where: { id: latest.id },
          data: { reaffirmationFailureCount: { increment: 1 } },
        });
        recorded = true;
      } else {
        logger.info("reaffirmation failure: no scorecard snapshot to mirror onto; SLA row is the record", {
          dealerId: params.dealerId,
          dealId: params.dealId,
        });
      }
    }
  }

  const slaViolation = failuresInWindow >= REAFFIRMATION_SLA_THRESHOLD;
  if (slaViolation) {
    await raiseException({
      code: "WINNING_DEALER_REJECTS_OR_TIMES_OUT",
      dealerId: params.dealerId ?? undefined,
      dealId: params.dealId,
      // One review per dealership per window, not one per failure: the operator's action is to
      // review the dealership, and a second row would be the same review twice.
      idempotencyKey: `REAFFIRMATION_SLA:${entityType}:${entityId}:${windowStart.toISOString().slice(0, 10)}`,
      detail:
        `${failuresInWindow} reaffirmation failures in ${REPEAT_WINDOW_DAYS} days ` +
        `(threshold ${REAFFIRMATION_SLA_THRESHOLD}). Review this dealership's invitation eligibility.`,
    }).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
  }

  return { recorded, slaViolation, failuresInWindow };
}

/** Exported for the invitation-ranking read in `dealer-scorecard.service`. */
export async function reaffirmationFailuresInWindow(
  entityType: "ROOFTOP" | "DEALER",
  entityId: string,
  now: Date = new Date(),
  db: typeof prisma | Prisma.TransactionClient = prisma,
): Promise<number> {
  return db.slaViolation.count({
    where: {
      entityType,
      entityId,
      slaType: "REAFFIRMATION",
      breachedAt: { gte: new Date(now.getTime() - REPEAT_WINDOW_DAYS * 24 * 3600_000) },
    },
  });
}
