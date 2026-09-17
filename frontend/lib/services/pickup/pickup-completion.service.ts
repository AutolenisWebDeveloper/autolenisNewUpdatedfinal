// §Stage 18 handover and §Stage 20 ATOMIC COMPLETION — the one writer that completes a Deal.
//
// WHAT THIS REPLACES. §8.2 defect (4): five Deal-completion writers — the dealer scan route,
// admin `pickup/complete`, `DEAL_STAGE_ADVANCED`, the journey `complete`/`complete-all` routes,
// and the caller-less `completePickup`. Five writers meant five different sets of preconditions
// for the same irreversible act, and the §Stage 20 checklist could be satisfied by one and
// skipped by another. They collapse to `confirmPossession` below.
//
// WHY THE SCAN NO LONGER COMPLETES. §8.2 defect (3). The dealer's scan advanced the Deal
// straight to COMPLETED as a `DEALER` actor, which §Stage 19 forbids in as many words: "A dealer
// release with no buyer confirmation reminds the buyer — the Deal never completes automatically
// on the dealer's word alone." The scan now records HANDOVER (`recordDealerRelease`), and the
// BUYER's possession confirmation completes.
//
// WHAT "ATOMIC" MEANS HERE, PRECISELY — and what it does not.
//
// §Stage 20: "Atomically: mark pickup complete; mark the Deal COMPLETED; record completion time;
// emit the canonical completion event exactly once; queue buyer and dealership completion
// communications durably."
//
// IN the transaction: the Deal row, the Pickup row, the DealStatusHistory row, the buyer
// activity event, and the `comms_outbox` rows for both parties — written through
// `enqueueTransactional(…, tx)`, which exists precisely so "the state change and the message it
// implies" commit together. If the transaction rolls back, so do the messages.
//
// OUTSIDE it, and this is a limit rather than a shortcut: `emitDealCompletionEvent` →
// `emitDomainEvent` runs on the SUPABASE client, not Prisma, and cannot enlist in a Prisma
// transaction. It is called after commit, keyed `purchase_completed:<dealId>` and idempotent, so
// a retry cannot double-emit. The residual risk is a crash in the window between COMMIT and that
// call, which would leave a completed Deal whose CRM/affiliate settlement event never fired.
// That is REPORTED, not papered over: closing it needs the domain event driven from a durable
// row (its own change, and Phase 10's control-plane territory), not a wider transaction that
// Prisma and Supabase cannot share.
//
// EXACTLY ONCE is the compare-and-swap INSIDE the transaction, not a status read before it. Two
// concurrent confirmations both read `HANDOVER_PENDING`; the second blocks on the row lock, and
// when it re-evaluates its WHERE the status is already `COMPLETED`, so it matches zero rows and
// takes the already-complete branch. No row is written twice and no message is queued twice.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { assertReleaseGates, InsuranceRequiredError, ReleaseNotClearedError } from "@/lib/services/deal/deal.service";
import { emitDealCompletionEvent } from "@/lib/services/deal/deal-completion-event.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_9_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { consumeReleaseToken, revokeReleaseToken } from "./release-token.service";
import { DEAL_COMPLETE_SUBJECT, renderDealCompleteEmail } from "@/lib/services/email/templates/deal-complete";
import {
  DEALER_PICKUP_COMPLETED_SUBJECT,
  renderDealerPickupCompletedEmail,
} from "@/lib/services/email/templates/dealer-pickup-completed";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

/** §Stage 18's "Recorded" list, as the scan supplies it. */
interface DealerReleaseBase {
  dealId: string;
  /** The dealership recording the release — already authorised by the caller. */
  dealerId: string;
  releasedBy?: string | null;
  odometerAtRelease?: number | null;
  conditionAtRelease?: string | null;
  fundsCollectedMethod?: string | null;
  /** §Stage 18: the buyer's and any co-buyer's identity, verified against the contract. */
  identityVerified: boolean;
  tradeReceived?: boolean;
  dueBillItems?: Prisma.InputJsonValue | null;
  now?: Date;
}

/**
 * §Stage 18's normal path: the dealership scans what the buyer presents. The RAW token comes in
 * so the spend joins the release transaction.
 */
export interface ScannedDealerRelease extends DealerReleaseBase {
  actor?: { role: "DEALER"; id: string };
  /** The pickup whose code was scanned, and the RAW token, so the spend joins the transaction. */
  pickupId: string;
  rawToken: string;
}

/**
 * THE CARVE-OUT, AND WHY IT CARRIES NO CODE. A concierge (vehicle-request) deal has no
 * dealership, so AutoLenis staff coordinate the handover; Operations also correct a dealer deal.
 * Neither is a scan, and neither has a code to present — the buyer's credential proves the buyer
 * is at the counter, which is a fact about the dealership's appointment, not about an admin
 * acting in the console. That act is proven differently: role gate, stated reason and an AWAITED
 * audit row, pinned in `lib/__tests__/role-boundary-frozen.test.ts`.
 *
 * `rawToken?: never` is the load-bearing line. Its absence is what broke the journey routes when
 * they moved onto this service: they had no code, passed `rawToken: ""`, and the hash of an empty
 * string matched no row — so an admin completion refused with `code_already_spent` and the
 * capability silently disappeared behind a refactor meant to preserve it. An empty string now
 * fails to compile in either arm. `pickupId` goes with it: the pickup is identified by `dealId`
 * everywhere else in this function, and it was read ONLY to spend the code — so an Operations
 * release was passing `deal.pickup?.id ?? ""` into a field nothing on its path reads.
 */
export interface OperationsRelease extends DealerReleaseBase {
  actor: { role: "ADMIN"; id: string };
  pickupId?: never;
  rawToken?: never;
}

export type DealerReleaseInput = ScannedDealerRelease | OperationsRelease;

/** Narrows the union. A predicate, so the branch below narrows through the optional `actor`. */
function isOperationsRelease(input: DealerReleaseInput): input is OperationsRelease {
  return input.actor?.role === "ADMIN";
}

export type DealerReleaseOutcome =
  | { ok: true; alreadyReleased: boolean; releasedAt: Date }
  | { ok: false; reason: "deal_missing" | "not_scheduled" | "identity_unverified" | "code_already_spent" };

/** §Stage 19's short confirmation form, from the buyer's authenticated session. */
export interface PossessionInput {
  dealId: string;
  /** The buyer confirming — already authorised by the caller. */
  buyerId: string;
  /**
   * WHO is recording it. §Stage 19 puts this in the buyer's own authenticated session, and that
   * is the default. ADMIN exists for the one case the document itself carves out: a concierge
   * (vehicle-request) deal has no dealership, so AutoLenis staff coordinate the handover — and
   * for an Operations correction on a dealer deal.
   *
   * It is a RECORD of who acted, not a permission: the release gates run identically either
   * way. An admin-recorded possession that reads as the buyer's would make the history lie about
   * who was standing at the car, which is the one thing §Stage 19 is protecting.
   */
  actor?: { role: "BUYER" | "ADMIN"; id: string };
  vehicleReceived: boolean;
  vinMatch: boolean;
  odometerAtPossession?: number | null;
  conditionAsDelivered?: string | null;
  keysAndAccessoriesReceived: boolean;
  /** Anything the buyer reports as wrong. A MATERIAL entry blocks completion. */
  discrepancy?: { material: boolean; note: string } | null;
  now?: Date;
}

export type PossessionOutcome =
  | { ok: true; alreadyComplete: boolean; completedAt: Date }
  | { ok: false; reason: "deal_missing" | "not_in_handover" | "not_received" | "discrepancy_blocks" };

/**
 * §Stage 18 — the dealership released the vehicle. PICKUP_SCHEDULED → HANDOVER_PENDING.
 *
 * IDENTITY IS A PRECONDITION, NOT A FIELD. §Stage 18's failure clause lists "an identity
 * mismatch" first among the things that BLOCK handover, so an unverified identity does not
 * record a release with a null timestamp — it refuses and raises the §26 exception.
 */
export async function recordDealerRelease(input: DealerReleaseInput): Promise<DealerReleaseOutcome> {
  const now = input.now ?? new Date();

  const pre = await prisma.deal.findUnique({
    where: { id: input.dealId },
    select: { id: true, status: true, buyerId: true, buyer: { select: { firstName: true, user: { select: { email: true } } } } },
  });
  if (!pre) return { ok: false, reason: "deal_missing" };

  if (!input.identityVerified) {
    await raiseException({
      code: "ID_MISMATCH_AT_HANDOVER",
      dealId: input.dealId,
      buyerId: pre.buyerId,
      dealerId: input.dealerId,
      detail: "The dealership could not verify the buyer's identity against the contract at the appointment.",
    }).catch((e: unknown) => logger.error("[pickup-completion] identity exception failed:", e));
    return { ok: false, reason: "identity_unverified" };
  }

  if (pre.status === "HANDOVER_PENDING" || pre.status === "COMPLETED") {
    return { ok: true, alreadyReleased: true, releasedAt: now };
  }
  if (pre.status !== "PICKUP_SCHEDULED") return { ok: false, reason: "not_scheduled" };

  const result = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({
      where: { id: input.dealId },
      select: {
        id: true, status: true, buyerId: true,
        insuranceStatus: true, dealerExecutedContractId: true, fundingClearedAt: true,
      },
    });
    if (!deal) return { ok: false as const, reason: "deal_missing" as const };
    if (deal.status === "HANDOVER_PENDING" || deal.status === "COMPLETED") {
      return { ok: true as const, alreadyReleased: true, releasedAt: now };
    }

    // The three hard release gates, at WRITE time, on the row as read. This is the rung where
    // the vehicle physically moves, so it is the rung that matters most.
    assertReleaseGates(deal);

    // THE CREDENTIAL STEP, INSIDE THE TRANSACTION, AND DIFFERENT FOR THE TWO ACTORS.
    //
    // A SCAN SPENDS. A gate that throws above rolls this back, so a refused release never burns
    // the buyer's credential; and a second concurrent scan cannot spend the same code, because
    // exactly one compare-and-swap matches.
    //
    // AN OPERATIONS RELEASE RETIRES. It has no code to spend, and consuming one would record
    // "a handover happened on this credential" — which is false, and would be the wrong thing to
    // find in the pickup row later. Revoking records the true fact: the handover happened, and it
    // will not happen on this code. A deal with no code issued (concierge) revokes nothing and
    // proceeds, which is why the result is not checked.
    if (isOperationsRelease(input)) {
      await revokeReleaseToken(input.dealId, now, tx);
    } else {
      const spent = await consumeReleaseToken(
        { pickupId: input.pickupId, rawToken: input.rawToken, now },
        tx,
      );
      if (!spent) return { ok: false as const, reason: "code_already_spent" as const };
    }

    const swap = await tx.deal.updateMany({
      where: { id: input.dealId, status: "PICKUP_SCHEDULED" },
      data: { status: "HANDOVER_PENDING" },
    });
    if (swap.count === 0) return { ok: true as const, alreadyReleased: true, releasedAt: now };

    await tx.pickup.update({
      where: { dealId: input.dealId },
      data: {
        status: "RELEASED",
        dealerReleasedAt: now,
        releasedBy: input.releasedBy ?? input.dealerId,
        identityVerifiedAt: now,
        odometerAtRelease: input.odometerAtRelease ?? undefined,
        conditionAtRelease: input.conditionAtRelease ?? undefined,
        fundsCollectedMethod: input.fundsCollectedMethod ?? undefined,
        tradeReceivedAt: input.tradeReceived ? now : undefined,
        ...(input.dueBillItems !== undefined && input.dueBillItems !== null
          ? { dueBillItems: input.dueBillItems }
          : {}),
      },
    });

    await tx.dealStatusHistory.create({
      data: {
        dealId: input.dealId,
        fromStatus: "PICKUP_SCHEDULED",
        toStatus: "HANDOVER_PENDING",
        actorId: input.actor?.id ?? input.dealerId,
        actorRole: input.actor?.role ?? "DEALER",
        reason:
          (input.actor?.role ?? "DEALER") === "ADMIN"
            ? "Vehicle release recorded by AutoLenis Operations"
            : "Dealer recorded vehicle release at handover",
      },
    });

    // §27.1 "Dealer releases vehicle → Buyer → Possession-confirmation request".
    const buyerEmail = pre.buyer?.user?.email ?? null;
    if (buyerEmail) {
      await enqueueTransactional(
        {
          triggerEvent: "pickup_vehicle_released",
          templateKey: PHASE_9_TEMPLATES.VEHICLE_RELEASED,
          channel: "email",
          recipientKind: "buyer",
          recipientId: deal.buyerId,
          to: buyerEmail,
          dealId: input.dealId,
          idempotencyKey: `${PHASE_9_TEMPLATES.VEHICLE_RELEASED}:${input.dealId}`,
          payload: {
            email: buyerEmail,
            type: "transactional",
            subject: "Confirm you have your vehicle",
            html:
              `<p>Hi ${pre.buyer?.firstName ?? "there"},</p>` +
              `<p>The dealership has recorded that your vehicle was released to you. ` +
              `Please confirm you have it — your deal is not complete until you do.</p>` +
              `<p><a href="${APP_URL}/buyer/pickup">Confirm possession</a></p>`,
          },
        },
        tx,
      );
    }

    return { ok: true as const, alreadyReleased: false, releasedAt: now };
  });

  return result;
}

/**
 * §Stage 19 + §Stage 20 — the buyer confirms possession, and the Deal completes. ONE transaction.
 *
 * A MATERIAL DISCREPANCY BLOCKS COMPLETION. §Stage 19: "A material discrepancy blocks completion
 * and creates an Operations case with the dealership notified." The Deal stays at
 * HANDOVER_PENDING; the buyer's report is recorded on the pickup either way, because the
 * evidence is the point whether or not it blocks.
 */
export async function confirmPossession(input: PossessionInput): Promise<PossessionOutcome> {
  const now = input.now ?? new Date();

  if (!input.vehicleReceived) return { ok: false, reason: "not_received" };

  const pre = await prisma.deal.findUnique({
    where: { id: input.dealId },
    select: {
      id: true, status: true, buyerId: true, completedAt: true,
      buyer: { select: { firstName: true, user: { select: { email: true } } } },
      offer: { select: { dealerId: true, dealer: { select: { dealershipName: true, user: { select: { email: true } } } } } },
    },
  });
  if (!pre) return { ok: false, reason: "deal_missing" };
  if (pre.status === "COMPLETED") {
    return { ok: true, alreadyComplete: true, completedAt: pre.completedAt ?? now };
  }
  if (pre.status !== "HANDOVER_PENDING") return { ok: false, reason: "not_in_handover" };

  const discrepancyJson = input.discrepancy
    ? ({ material: input.discrepancy.material, note: input.discrepancy.note, reportedAt: now.toISOString() } as Prisma.InputJsonValue)
    : undefined;

  // The blocking branch commits the EVIDENCE and the case, and nothing else. Recording the
  // buyer's report is not optional just because it stops the deal.
  if (input.discrepancy?.material) {
    await prisma.$transaction(async (tx) => {
      await tx.pickup.update({
        where: { dealId: input.dealId },
        data: {
          buyerConfirmedAt: now,
          vinMatch: input.vinMatch,
          odometerAtPossession: input.odometerAtPossession ?? undefined,
          ...(discrepancyJson !== undefined ? { possessionDiscrepancy: discrepancyJson } : {}),
        },
      });
      await raiseException(
        {
          code: "DELIVERY_DISCREPANCY_REPORTED",
          dealId: input.dealId,
          buyerId: input.buyerId,
          dealerId: pre.offer?.dealerId ?? null,
          detail: input.discrepancy!.note,
        },
        tx,
      );
    });
    return { ok: false, reason: "discrepancy_blocks" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({
      where: { id: input.dealId },
      select: {
        id: true, status: true, buyerId: true, completedAt: true,
        insuranceStatus: true, dealerExecutedContractId: true, fundingClearedAt: true,
      },
    });
    if (!deal) return { ok: false as const, reason: "deal_missing" as const };
    if (deal.status === "COMPLETED") {
      return { ok: true as const, alreadyComplete: true, completedAt: deal.completedAt ?? now };
    }
    if (deal.status !== "HANDOVER_PENDING") return { ok: false as const, reason: "not_in_handover" as const };

    assertReleaseGates(deal);

    // THE COMPARE-AND-SWAP. Everything below runs for the winning transaction only.
    const swap = await tx.deal.updateMany({
      where: { id: input.dealId, status: "HANDOVER_PENDING" },
      data: { status: "COMPLETED", completedAt: now, possessionConfirmedAt: now },
    });
    if (swap.count === 0) {
      const fresh = await tx.deal.findUnique({ where: { id: input.dealId }, select: { completedAt: true } });
      return { ok: true as const, alreadyComplete: true, completedAt: fresh?.completedAt ?? now };
    }

    await tx.pickup.update({
      where: { dealId: input.dealId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        buyerConfirmedAt: now,
        vinMatch: input.vinMatch,
        odometerAtPossession: input.odometerAtPossession ?? undefined,
        conditionAtRelease: input.conditionAsDelivered ?? undefined,
        ...(discrepancyJson !== undefined ? { possessionDiscrepancy: discrepancyJson } : {}),
      },
    });

    await tx.dealStatusHistory.create({
      data: {
        dealId: input.dealId,
        fromStatus: "HANDOVER_PENDING",
        toStatus: "COMPLETED",
        actorId: input.actor?.id ?? input.buyerId,
        actorRole: input.actor?.role ?? "BUYER",
        reason:
          (input.actor?.role ?? "BUYER") === "ADMIN"
            ? "Possession recorded by AutoLenis Operations"
            : "Buyer confirmed possession",
      },
    });

    await tx.buyerActivityEvent.create({
      data: {
        buyerId: deal.buyerId,
        eventType: "DEAL_COMPLETED",
        title: "Pickup confirmed — your deal is complete",
        metadata: { dealId: input.dealId, completedAt: now.toISOString() },
      },
    });

    // §27.1 "Deal completed → Buyer, dealership, AutoLenis". Both rows commit with the status.
    const buyerEmail = pre.buyer?.user?.email ?? null;
    if (buyerEmail) {
      await enqueueTransactional(
        {
          triggerEvent: "deal_completed",
          templateKey: PHASE_9_TEMPLATES.DEAL_COMPLETED,
          channel: "email",
          recipientKind: "buyer",
          recipientId: deal.buyerId,
          to: buyerEmail,
          dealId: input.dealId,
          idempotencyKey: `${PHASE_9_TEMPLATES.DEAL_COMPLETED}:${input.dealId}`,
          payload: {
            email: buyerEmail,
            type: "transactional",
            subject: DEAL_COMPLETE_SUBJECT(pre.buyer?.firstName ?? "there"),
            html: renderDealCompleteEmail({
              firstName: pre.buyer?.firstName ?? "there",
              completionDate: now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
              referralCode: "",
              dashboardUrl: `${APP_URL}/buyer/dashboard`,
              feedbackUrl: `${APP_URL}/feedback`,
              referralUrl: `${APP_URL}/auth/signup?ref=`,
              unsubscribeUrl: `${APP_URL}/unsubscribe`,
            }),
          },
        },
        tx,
      );
    }

    // §27.1 "Buyer confirms possession → Buyer + dealership → Completion confirmation". The
    // dealership got NOTHING on the old scan path: `sendDealerPickupCompletedEmail` was reachable
    // only from the admin route, so the one path a real handover took told the dealer nothing.
    const dealerEmail = pre.offer?.dealer?.user?.email ?? null;
    if (dealerEmail && pre.offer?.dealerId) {
      await enqueueTransactional(
        {
          triggerEvent: "pickup_possession_confirmed",
          templateKey: PHASE_9_TEMPLATES.POSSESSION_CONFIRMED,
          channel: "email",
          recipientKind: "dealer",
          recipientId: pre.offer.dealerId,
          to: dealerEmail,
          dealId: input.dealId,
          idempotencyKey: `${PHASE_9_TEMPLATES.POSSESSION_CONFIRMED}:${input.dealId}`,
          payload: {
            email: dealerEmail,
            type: "transactional",
            subject: DEALER_PICKUP_COMPLETED_SUBJECT,
            html: renderDealerPickupCompletedEmail({
              contactName: pre.offer.dealer?.dealershipName ?? "there",
              vehicleRef: `Deal #${input.dealId.slice(0, 8)}`,
              payoutSchedule: "Payout is scheduled per your dealer agreement.",
            }),
          },
        },
        tx,
      );
    }

    return { ok: true as const, alreadyComplete: false, completedAt: now };
  });

  // AFTER COMMIT, and only for the transaction that actually completed the deal. Idempotent by
  // `purchase_completed:<dealId>` inside emitDomainEvent, and non-throwing by construction — see
  // this file's header for why it cannot be inside the transaction.
  if (result.ok && !result.alreadyComplete) {
    await emitDealCompletionEvent(input.dealId);
  }

  return result;
}


/**
 * The admin journey tools' pickup stage, routed through the one completion writer.
 *
 * §8.2 defect (4). `journey/complete` and `journey/complete-all` each wrote the Pickup to
 * COMPLETED themselves and then forced the Deal to COMPLETED — two more writers of a release,
 * with none of its preconditions. They call this instead.
 *
 * THE GATES ARE NOT BYPASSED FOR A JOURNEY TOOL. One that can complete a deal with no insurance,
 * no dealer-executed contract and no funding clearance is conditional delivery with a friendlier
 * name, and it is exactly how "no vehicle moves before clearance" came to be a property of one
 * code path instead of the system.
 *
 * Records BOTH halves as ADMIN, for the same reason the admin completion route does: the history
 * should say who actually acted.
 */
export async function completeJourneyPickup(
  dealId: string,
  adminId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, status: true, offer: { select: { dealerId: true } } },
  });
  if (!deal) return { ok: false, code: "NO_DEAL", message: "No active deal found" };
  if (deal.status === "COMPLETED") return { ok: true };

  const actor = { role: "ADMIN" as const, id: adminId };

  try {
    const released = await recordDealerRelease({
      dealId,
      dealerId: deal.offer?.dealerId ?? adminId,
      identityVerified: true,
      actor,
    });
    if (!released.ok && released.reason === "not_scheduled") {
      return {
        ok: false,
        code: "NOT_READY_FOR_PICKUP",
        message: "This deal has not reached a scheduled pickup, so there is no handover to record.",
      };
    }

    const completed = await confirmPossession({
      dealId,
      buyerId: "",
      vehicleReceived: true,
      vinMatch: true,
      keysAndAccessoriesReceived: true,
      actor,
    });
    if (!completed.ok) {
      return { ok: false, code: "NOT_COMPLETABLE", message: "This deal could not be completed." };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof InsuranceRequiredError) {
      return { ok: false, code: "INSURANCE_REQUIRED", message: "Insurance proof is required before this deal can complete." };
    }
    if (err instanceof ReleaseNotClearedError) {
      return { ok: false, code: "RELEASE_NOT_CLEARED", message: err.message };
    }
    throw err;
  }
}
