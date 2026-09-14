// lib/services/deal/dealer-reaffirmation.service.ts
// §Stage 10 — dealer reaffirmation, vehicle hold, condition disclosure, material changes.
//
// "This stage does not exist in the platform today — offer selection currently creates a Deal
// directly at financing-pending with no winning-dealer response captured. It is the most important
// missing link in the flow, because it is the point where a real dealership confirms it can
// actually do the deal." (§Stage 10, opening.)
//
// WHAT THIS FILE OWNS, and what it deliberately does not:
//
//   owns      the 24-hour window and its expiry; the dealership's confirmation and everything it
//             must confirm; the 12-hour reminder; the buyer's single disclosure acknowledgement;
//             the material-change decision; the hold-until timestamp and its extend/release;
//             the outside-winner gate; the exit to RECAP_PENDING.
//   delegates the comparison itself to `material-change.ts` (pure, no I/O);
//             the release to `identity-firewall.service.ts`;
//             the return path to `return-to-offers.service.ts`;
//             every message to the §27 dispatcher and every exception to `raiseException`.
//
// THE EXIT CONDITION IS A CONJUNCTION, not a status. §Stage 10: "Exit. Dealership reaffirms, buyer
// acknowledges disclosure, no unresolved material change." Plus §10b for an outside winner. All
// four are checked in one place (`reaffirmationExitSatisfied`) rather than at each caller, because
// three of the four are set by different actors at different times and any caller that checked
// three of them would be right most of the time.
//
// WHY THE DIRECT `DEALER_CONFIRMATION -> FINANCING_PENDING` EDGE IS GONE.
// Phase 6 added it with no domain caller and recorded that deliberately (§8.1f). Reading it at the
// start of this phase found it was not unreachable: `POST /api/admin/deals/[dealId]/action` with
// `DEAL_STAGE_ADVANCED` resolves the target at runtime and reaches `advanceDealStatus` NON-FORCED,
// and two admin dropdowns offer `FINANCING_PENDING` as the next stage for a `DEALER_CONFIRMATION`
// deal. So an operations admin could move a deal past reaffirmation, hold and disclosure with an
// ordinary, fully legal transition — the gate this phase exists to build, skippable by the surface
// most likely to skip it. The edge is replaced by `DEALER_CONFIRMATION -> RECAP_PENDING ->
// FINANCING_PENDING`. `force: true` still overrides, and still audit-logs that it did, which is
// the difference between an override and a gap.

import { prisma } from "@/lib/prisma";
import { DealStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { advanceDealStatus } from "./deal.service";
import { liftIdentityFirewall } from "./identity-firewall.service";
import {
  classifyMaterialChange,
  type MaterialChangeOutcome,
  type MaterialDifference,
  type ReaffirmationSnapshot,
  type FeeLike,
} from "./material-change";
import { enqueueTransactional, enqueueOrRaise, cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
// STATIC, and it must stay static. It was a runtime `await import("./return-to-offers.service")`
// to keep the module graph lean, and that broke under Playwright for the reason §8.1f records:
// Playwright applies the `@/*` paths at BUILD time, so a module reached only through a runtime
// dynamic import never gets the transform and dies on its own internal `@/lib/prisma`.
//
// The failure was worse than a broken test. `expireOverdueReaffirmations` catches per-row and
// logs, so the throw became "0 windows expired" — a 24-hour deadline that silently stopped
// closing, reported as success. Two journeys failed for this one cause.
//
// There is NO import cycle to avoid: `return-to-offers.service` imports the firewall, the queue
// writer, the dispatcher and the anti-circumvention window, and none of them imports this file.
// Verified, not assumed.
import { returnToRemainingOffers } from "./return-to-offers.service";
import { PHASE_7_TEMPLATES, reaffirmationReminderCancelKey } from "@/lib/services/comms/state-recheck-registry";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { recheckApproval } from "@/lib/services/prequal/approval-recheck";
import {
  renderReaffirmationRequest,
  renderReaffirmationReminder,
  renderDealerConfirmed,
  renderMaterialChangeProposed,
  renderVehicleHoldExpiring,
  renderOutsideDealerVerification,
} from "@/lib/services/comms/phase7-email-content";

type Db = typeof prisma | Prisma.TransactionClient;

/** §Stage 10: "Within **24 hours**, the winning dealership confirms". */
export const REAFFIRMATION_WINDOW_HOURS = 24;
/** §Stage 10: "Remind the dealership at 12 hours." */
export const REAFFIRMATION_REMINDER_HOURS = 12;

export class ReaffirmationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ReaffirmationError";
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Opening the window
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Create the reaffirmation record and enqueue the request to the winning dealership.
 *
 * MUST run inside the Deal-creation transaction. §9a: the Premium invitation "never delays the
 * reaffirmation request to the dealership", and HTML S[8].system[3] says the request goes "regardless
 * of buyer engagement with the invitation". Arming it by the same COMMIT that creates the Deal is
 * what makes both true — there is no later call for a crashed request to lose, and no flag for a
 * front-end to gate. This is the seam Phase 6 reserved (K27-1328b) rather than a second rail.
 *
 * Idempotent on the Deal: `findFirst` inside the caller's transaction plus the outbox dedup key
 * means a replayed creation adds neither a second row nor a second message.
 */
export async function openReaffirmation(
  tx: Db,
  params: { dealId: string; now?: Date },
): Promise<{ created: boolean; reaffirmationId: string | null }> {
  const now = params.now ?? new Date();

  const existing = await tx.dealerReaffirmation.findFirst({
    where: { dealId: params.dealId },
    select: { id: true },
  });
  if (existing) return { created: false, reaffirmationId: existing.id };

  const deal = await tx.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      dealerId: true,
      offer: {
        select: {
          dealerId: true,
          otdPriceCents: true,
          vin: true,
          vehicleYear: true,
          vehicleMake: true,
          vehicleModel: true,
          externalDealerName: true,
          externalDealerEmail: true,
          dealer: {
            select: {
              id: true,
              dealershipName: true,
              isSystemPlaceholder: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });
  if (!deal?.offer) {
    // A Deal with no offer has no dealership to ask. §26's lineage rule: report, never absorb.
    logger.error("reaffirmation: deal has no offer — cannot open the 24-hour window", {
      dealId: params.dealId,
    });
    return { created: false, reaffirmationId: null };
  }

  const dueAt = new Date(now.getTime() + REAFFIRMATION_WINDOW_HOURS * 3600_000);
  const id = randomUUID();

  await tx.dealerReaffirmation.create({
    data: {
      id,
      dealId: params.dealId,
      // The REAL dealership where one exists. On the outside rail `offer.dealerId` is the single
      // shared system placeholder (`lib/services/offer/outside-dealer.ts`), so recording it here
      // would file every outside dealership's reaffirmation against one row. Null until the claim
      // completes and `Deal.dealerId` names a real Dealer — §13-D20's lineage, applied.
      dealerId: deal.offer.dealer?.isSystemPlaceholder ? null : deal.offer.dealerId,
      status: "PENDING",
      dueAt,
      createdAt: now,
      updatedAt: now,
    },
  });

  // §27.1 "Buyer selects offer → Buyer + winning dealership → Confirmation and reaffirmation
  // request". The buyer half rides the existing award dispatch; this is the dealership half.
  const to = deal.offer.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerEmail
    : deal.offer.dealer?.user?.email ?? null;
  const dealershipName =
    deal.offer.dealer?.isSystemPlaceholder
      ? deal.offer.externalDealerName ?? "your dealership"
      : deal.offer.dealer?.dealershipName ?? "your dealership";

  if (!to) {
    // §26 / Phase 6's ruling 4: a recipient with no channel never produces an outbox row, so
    // there is nothing to investigate in the dispatcher — it is its own exception.
    await raiseException(
      {
        code: "COMMS_NO_DELIVERABLE_CHANNEL",
        dealId: params.dealId,
        detail:
          "The winning dealership has no email address, so the Stage 10 reaffirmation request " +
          "could not be enqueued. The 24-hour window is running.",
      },
      tx,
    ).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
    return { created: true, reaffirmationId: id };
  }

  const vehicle = [deal.offer.vehicleYear, deal.offer.vehicleMake, deal.offer.vehicleModel]
    .filter(Boolean)
    .join(" ");
  const content = renderReaffirmationRequest({
    dealershipName,
    vehicle: vehicle || "the vehicle you bid on",
    vin: deal.offer.vin,
    otdCents: deal.offer.otdPriceCents,
    dueAt,
    dealId: params.dealId,
  });

  await enqueueTransactional(
    {
      triggerEvent: "buyer_selects_offer",
      templateKey: PHASE_7_TEMPLATES.REAFFIRMATION_REQUEST,
      channel: "email",
      recipientKind: "dealer",
      recipientId: deal.offer.dealerId,
      to,
      payload: { email: to, subject: content.subject, html: content.html, text: content.text },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.REAFFIRMATION_REQUEST}:${params.dealId}`,
      cancelKey: reaffirmationReminderCancelKey(params.dealId),
    },
    tx,
  );

  // The 12-hour reminder is enqueued NOW with a future `runAt` rather than discovered by a sweep.
  // §27 wants the reminder durable, and a row that already exists cannot be forgotten by a cron
  // that failed to run. It shares the deal's cancel key, so a confirmation cancels it.
  const reminder = renderReaffirmationReminder({
    dealershipName,
    vehicle: vehicle || "the vehicle you bid on",
    dueAt,
    dealId: params.dealId,
  });
  await enqueueTransactional(
    {
      triggerEvent: "reaffirmation_reminder",
      templateKey: PHASE_7_TEMPLATES.REAFFIRMATION_REMINDER,
      channel: "email",
      recipientKind: "dealer",
      recipientId: deal.offer.dealerId,
      to,
      payload: { email: to, subject: reminder.subject, html: reminder.html, text: reminder.text },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.REAFFIRMATION_REMINDER}:${params.dealId}`,
      runAt: new Date(now.getTime() + REAFFIRMATION_REMINDER_HOURS * 3600_000),
      cancelKey: reaffirmationReminderCancelKey(params.dealId),
    },
    tx,
  );

  return { created: true, reaffirmationId: id };
}

// ───────────────────────────────────────────────────────────────────────────────
// The dealership's answer
// ───────────────────────────────────────────────────────────────────────────────

export interface ReaffirmationSubmission {
  vehicleAvailable: boolean;
  confirmedVin: string;
  confirmedOdometer: number;
  confirmedOtdCents: number;
  confirmedFeeItems: FeeLike[];
  confirmedIncentiveItems: FeeLike[];
  confirmedAddOnItems: FeeLike[];
  confirmedDeliveryTerms: string | null;
  outOfStateHandling: string | null;
  canProceed: boolean;
  tradeSubjectToAppraisalAck: boolean;
  /** §10c — "A vehicle hold-until date and time." */
  holdUntil: Date;
  /** Condition report, history report and current photographs. */
  disclosureArtifactUrls: string[];
  aprRate?: number | null;
  termMonths?: number | null;
  monthlyPaymentCents?: number | null;
  deliveryDate?: Date | null;
  vehicleYear?: number | null;
  vehicleTrim?: string | null;
  vehicleCondition?: string | null;
  drivetrain?: string | null;
  requiredFeatures?: string[];
}

export type ReaffirmationResult =
  | { status: "CONFIRMED"; materialChange: null }
  | { status: "MATERIAL_CHANGE_PENDING"; materialChange: MaterialDifference[] }
  | { status: "REFUSED"; reason: string; ceilingCents: number | null }
  | { status: "REJECTED"; reason: string };

/**
 * Record the dealership's answer to the 24-hour request.
 *
 * Everything commits together: the reaffirmation row, the hold, the firewall lift, the deal's
 * confirmed figures, and the buyer's notice. §28.3 requires atomicity on every material
 * transition, and a lift that committed without the confirmation behind it would be a release
 * with no reason on the record.
 */
export async function submitReaffirmation(params: {
  dealId: string;
  /** The authenticated dealership. Ownership is re-checked here, not trusted from the caller. */
  dealerId: string;
  submission: ReaffirmationSubmission;
  now?: Date;
}): Promise<ReaffirmationResult> {
  const now = params.now ?? new Date();

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      status: true,
      buyerId: true,
      dealerId: true,
      offer: {
        select: {
          id: true,
          dealerId: true,
          otdPriceCents: true,
          vin: true,
          odometer: true,
          aprRate: true,
          termMonths: true,
          junkFeeItems: true,
          addOnItems: true,
          incentiveItems: true,
          vehicleYear: true,
          vehicleTrim: true,
          vehicleCondition: true,
          requiredFeatureMatches: true,
          dealer: { select: { isSystemPlaceholder: true } },
        },
      },
    },
  });
  if (!deal?.offer) throw new ReaffirmationError("NOT_FOUND", "Deal not found.");
  if (deal.status !== DealStatus.DEALER_CONFIRMATION) {
    throw new ReaffirmationError(
      "WRONG_STAGE",
      `This deal is at ${deal.status}, not awaiting dealer confirmation.`,
    );
  }
  if (deal.offer.dealerId !== params.dealerId && deal.dealerId !== params.dealerId) {
    throw new ReaffirmationError("FORBIDDEN", "This deal belongs to another dealership.");
  }

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "desc" },
  });
  if (!reaffirmation) throw new ReaffirmationError("NOT_FOUND", "No reaffirmation is open for this deal.");
  if (reaffirmation.status === "CONFIRMED") {
    return { status: "CONFIRMED", materialChange: null };
  }
  if (reaffirmation.status === "TIMED_OUT") {
    throw new ReaffirmationError(
      "WINDOW_CLOSED",
      "The 24-hour confirmation window for this deal has closed and the buyer has been returned to the remaining offers.",
    );
  }

  // §10b — an outside winner completes rooftop claim, account verification, dealer agreement
  // signature and required business verification BEFORE the Deal advances past this stage.
  if (deal.offer.dealer?.isSystemPlaceholder) {
    const gate = await outsideWinnerGate(params.dealId);
    if (!gate.satisfied) {
      await raiseException({
        code: "OUTSIDE_WINNER_FAILS_VERIFICATION",
        dealId: params.dealId,
        detail: `Outstanding before this deal may advance: ${gate.missing.join(", ")}.`,
      }).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
      // §27.1's row for this is "Outside winner verification → Dealership → claim, verify, sign",
      // and it was registered, rendered and enqueued by NOTHING. An outside dealership failing the
      // gate got an Operations row it cannot see and no instruction at all, while the renderer
      // that builds the claim link sat unused. The gate is where the instruction is owed.
      const outsideDealer = await dealerRecipient(params.dealId);
      if (outsideDealer?.email) {
        const content = renderOutsideDealerVerification({
          dealershipName: outsideDealer.dealershipName,
          missing: gate.missing,
        });
        await enqueueOrRaise(
          {
            triggerEvent: "outside_winner_verification",
            templateKey: PHASE_7_TEMPLATES.OUTSIDE_DEALER_VERIFICATION,
            channel: "email",
            recipientKind: "dealer",
            // Never the placeholder's id — `dealerRecipient` returns null for it (§13-D20).
            recipientId: outsideDealer.dealerId,
            to: outsideDealer.email,
            payload: {
              email: outsideDealer.email,
              subject: content.subject,
              html: content.html,
              text: content.text,
            },
            dealId: params.dealId,
            // One per outstanding SET, so a dealership that completes two of four steps and tries
            // again is told what is still missing rather than silenced by a per-deal key.
            idempotencyKey: `${PHASE_7_TEMPLATES.OUTSIDE_DEALER_VERIFICATION}:${params.dealId}:${gate.missing.join("|")}`,
          },
          {
            idempotencyKey: `OUTSIDE_VERIFICATION_ENQUEUE_FAILED:${params.dealId}`,
            detail:
              "An outside dealership failed the §10b verification gate and the instruction telling " +
              "them how to claim their account could not be enqueued. They cannot proceed and have " +
              "not been told why.",
          },
        );
      }
      throw new ReaffirmationError("OUTSIDE_WINNER_UNVERIFIED", gate.missing.join(", "));
    }
  }

  // §Stage 10: "The vehicle remains available" and "Ability and willingness to proceed" are
  // confirmations, not fields — a dealership answering "no" to either is a rejection.
  if (!params.submission.vehicleAvailable || !params.submission.canProceed) {
    await rejectReaffirmation({
      dealId: params.dealId,
      reason: !params.submission.vehicleAvailable
        ? "The dealership reported the vehicle is no longer available."
        : "The dealership reported it cannot proceed with this deal.",
      actorId: params.dealerId,
      code: !params.submission.vehicleAvailable
        ? "VEHICLE_SOLD_BEFORE_CONTRACT_OR_PICKUP"
        : "WINNING_DEALER_REJECTS_OR_TIMES_OUT",
      now,
    });
    return { status: "REJECTED", reason: "The dealership could not proceed." };
  }

  // §10a's ceiling operand is READ SERVER-SIDE from the approval, never from the request and never
  // from the buyer's stated budget. `recheckApproval` is the one predicate that owns "current,
  // unexpired and sufficient" — the same helper offer submit, revision and selection use — reached
  // here through the `offer_confirmation` gate the Phase 2 helper reserved for this phase.
  const approval = await recheckApproval(deal.buyerId, "offer_confirmation", {
    raiseOnFailure: true,
    dealId: params.dealId,
  });
  // AN INVALID APPROVAL IS NOT AN ABSENT CEILING, and conflating the two disabled §10a's refusal.
  //
  // This read `approval.ok ? approval.approvedAmountCents : null`, and `classifyMaterialChange`
  // documents `null` as "the approval genuinely carries no amount" — so an EXPIRED or DECLINED
  // approval silently turned the ceiling off, and a $52,000 out-the-door against a lapsed $45,000
  // approval was presented to the buyer as an ordinary accept-or-reject. §10a says an amount above
  // the approved ceiling "cannot be accepted at all"; it does not say "unless we could not check".
  //
  // §26 also has the correct behaviour for this case and it is not "carry on": an expired approval
  // PAUSES the deal. `recheckApproval` has already opened that exception (`raiseOnFailure`), so
  // this refuses the submission and leaves the reaffirmation PENDING for Operations to resolve.
  // Nothing about the dealership's answer is lost — they resubmit once the approval is current.
  if (!approval.ok) {
    // AND THE CLOCK STOPS WHILE THEY WAIT. Refusing the dealership for a BUYER-side condition
    // while the 24-hour deadline keeps running is the same defect as refusing a legitimate price
    // change at submission: the penalty lands on the party who cannot clear the condition. The
    // sweep would time them out as DEALER_TIMED_OUT and file an SLA violation against their
    // rooftop for a window the platform closed to them.
    //
    // `dueAt` is pushed a full fresh window from now, not merely nudged, because the buyer's
    // approval has to be revalidated by Operations and that is not a minutes-long task. Recorded
    // on the row rather than in a log so an operator reading the reaffirmation can see why its
    // deadline moved.
    await prisma.dealerReaffirmation
      .updateMany({
        where: { dealId: params.dealId, status: "PENDING" },
        data: { dueAt: new Date(now.getTime() + REAFFIRMATION_WINDOW_HOURS * 3600_000), updatedAt: now },
      })
      .catch((err) => {
        logger.error("reaffirmation: could not extend the window after an approval refusal", {
          dealId: params.dealId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    throw new ReaffirmationError(
      "APPROVAL_NOT_CURRENT",
      "We cannot accept a confirmation on this deal right now — the buyer's approval needs to be " +
        "revalidated before terms can be agreed. Our team has been alerted and will come back to " +
        "you, and your confirmation window has been extended so this does not count against you.",
    );
  }
  const ceilingCents = approval.approvedAmountCents;

  const confirmed = snapshotFromOffer(deal.offer);
  const proposed: ReaffirmationSnapshot = {
    otdCents: params.submission.confirmedOtdCents,
    vin: params.submission.confirmedVin,
    odometer: params.submission.confirmedOdometer,
    aprRate: params.submission.aprRate ?? deal.offer.aprRate,
    termMonths: params.submission.termMonths ?? deal.offer.termMonths,
    monthlyPaymentCents: params.submission.monthlyPaymentCents ?? null,
    deliveryDate: params.submission.deliveryDate ?? null,
    vehicleYear: params.submission.vehicleYear ?? deal.offer.vehicleYear,
    vehicleTrim: params.submission.vehicleTrim ?? deal.offer.vehicleTrim,
    vehicleCondition: params.submission.vehicleCondition ?? deal.offer.vehicleCondition,
    drivetrain: params.submission.drivetrain ?? null,
    feeItems: params.submission.confirmedFeeItems,
    addOnItems: params.submission.confirmedAddOnItems,
    requiredFeatures: params.submission.requiredFeatures ?? confirmed.requiredFeatures,
  };

  const change = classifyMaterialChange(confirmed, proposed, ceilingCents);

  if (change.outcome === "REFUSE") {
    // §10a: "A change that pushes the deal above the approved ceiling cannot be accepted at all."
    // Refused at the dealership, so the buyer is never shown a button that must not be pressed.
    await raiseException({
      code: "DEALER_MATERIAL_CHANGE",
      dealId: params.dealId,
      detail:
        `The dealership proposed an out-the-door amount above the buyer's approved ceiling ` +
        `and it was refused at submission. Proposed ${change.proposedOtdCents} cents against a ` +
        `ceiling of ${change.ceilingCents} cents.`,
    }).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
    return {
      status: "REFUSED",
      reason:
        "The out-the-door amount you entered is above this buyer's approved amount, so it cannot be accepted. " +
        "Confirm at or below the amount on the accepted offer, or withdraw.",
      ceilingCents: change.ceilingCents,
    };
  }

  const writeFields = {
    confirmedVin: params.submission.confirmedVin,
    confirmedOdometer: params.submission.confirmedOdometer,
    confirmedOtdCents:
      change.outcome === "AUTO_APPLY" ? change.newOtdCents : params.submission.confirmedOtdCents,
    confirmedFeeItems: params.submission.confirmedFeeItems as unknown as Prisma.InputJsonValue,
    confirmedIncentiveItems: params.submission.confirmedIncentiveItems as unknown as Prisma.InputJsonValue,
    confirmedAddOnItems: params.submission.confirmedAddOnItems as unknown as Prisma.InputJsonValue,
    confirmedDeliveryTerms: params.submission.confirmedDeliveryTerms,
    outOfStateHandling: params.submission.outOfStateHandling,
    tradeSubjectToAppraisalAck: params.submission.tradeSubjectToAppraisalAck,
    holdUntil: params.submission.holdUntil,
    disclosureArtifactUrls: params.submission.disclosureArtifactUrls,
    updatedAt: now,
  };

  if (change.outcome === "DECIDE") {
    // The dealership has answered; the BUYER has not. The row parks at
    // MATERIAL_CHANGE_PENDING and the firewall stays closed — §Stage 10 lifts it at
    // confirmation, and a proposal the buyer has not accepted is not a confirmation.
    //
    // THE BUYER'S DECISION GETS ITS OWN CLOCK, and before this it had none at all.
    //
    // `holdUntil` was written to the reaffirmation row only, so `sweepExpiringHolds` — which reads
    // `deals.vehicle_hold_until` — never saw it, and `expireOverdueReaffirmations` filters on
    // `status: "PENDING"`, so it skipped the row too. A buyer who simply never opened the email
    // left the deal parked at DEALER_CONFIRMATION indefinitely, with a vehicle held off the market
    // that nobody was asked to extend or release, and §Stage 10's "an unaccepted material change
    // returns the buyer to the remaining valid offers" never fired.
    //
    // Two writes fix it, and both are needed. The hold goes onto the DEAL so the hold sweep can
    // see it; and `dueAt` is RESET to a fresh window from now, because the deadline it carried was
    // the DEALERSHIP's — a dealership answering at hour 23 would otherwise leave the buyer one
    // hour to decide something they had not yet been told about.
    const buyerDueAt = new Date(now.getTime() + REAFFIRMATION_WINDOW_HOURS * 3600_000);
    const offerOtdCents = deal.offer.otdPriceCents;
    await prisma.$transaction(async (tx) => {
      await tx.dealerReaffirmation.update({
        where: { id: reaffirmation.id },
        data: {
          ...writeFields,
          status: "MATERIAL_CHANGE_PENDING",
          dueAt: buyerDueAt,
          materialChangeProposal: {
            differences: change.differences,
            proposedOtdCents: params.submission.confirmedOtdCents,
            confirmedOtdCents: offerOtdCents,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      // The hold is real whether or not the buyer accepts — the dealership is holding the vehicle
      // while the question is open — so the hold sweep must be able to find it. The VIN and the
      // confirmed OTD are NOT written here: those are the confirmation, and there has not been one.
      await tx.deal.update({
        where: { id: params.dealId },
        data: { vehicleHoldUntil: params.submission.holdUntil },
      });
    });
    await notifyMaterialChange(params.dealId, change.differences, now);
    return { status: "MATERIAL_CHANGE_PENDING", materialChange: change.differences };
  }

  // NONE or AUTO_APPLY — the dealership has confirmed and no buyer decision is owed.
  //
  // COMPARE-AND-SET, because this transaction races the 24-hour cron. The deal and the
  // reaffirmation were read at the top of this function, and `expireOverdueReaffirmations` can
  // commit between that read and this write: the cron sets TIMED_OUT, cancels the deal and sends
  // "you have been returned to the other offers", and then this transaction writes CONFIRMED, the
  // hold, the VIN and the confirmed OTD onto a CANCELLED deal and enqueues DEALER_CONFIRMED —
  // which is registered `alwaysSend`, so the buyer receives "the dealership confirmed" AFTER the
  // stand-down notice. The update below is conditioned on the state this function actually read,
  // so the loser of that race changes nothing and is told why.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.dealerReaffirmation.updateMany({
      where: { id: reaffirmation.id, status: "PENDING" },
      data: { updatedAt: now },
    });
    if (claimed.count === 0) {
      throw new ReaffirmationError(
        "WINDOW_CLOSED",
        "This confirmation window closed before your answer reached us — the deal has already " +
          "moved on. Nothing you submitted has been recorded.",
      );
    }
    const stillLive = await tx.deal.updateMany({
      where: { id: params.dealId, status: DealStatus.DEALER_CONFIRMATION },
      data: { updatedAt: now },
    });
    if (stillLive.count === 0) {
      throw new ReaffirmationError(
        "WINDOW_CLOSED",
        "This deal is no longer awaiting your confirmation. Nothing you submitted has been recorded.",
      );
    }
    await tx.dealerReaffirmation.update({
      where: { id: reaffirmation.id },
      data: {
        ...writeFields,
        status: "CONFIRMED",
        // AUTO_APPLY is recorded as a decision the system made in the buyer's favour rather than
        // left invisible: §Stage 10's record requires "any material change and its buyer decision",
        // and "applied automatically" is that decision.
        ...(change.outcome === "AUTO_APPLY"
          ? {
              materialChangeProposal: {
                differences: change.differences,
                autoApplied: true,
                savingCents: change.savingCents,
              } as unknown as Prisma.InputJsonValue,
              buyerDecision: "AUTO_APPLIED",
              decidedAt: now,
            }
          : {}),
      },
    });

    await tx.deal.update({
      where: { id: params.dealId },
      data: {
        vehicleHoldUntil: params.submission.holdUntil,
        otdCentsConfirmed: writeFields.confirmedOtdCents,
        vin: params.submission.confirmedVin,
      },
    });

    // §Stage 10: "At this moment and not before, the identity firewall lifts."
    await liftIdentityFirewall({ dealId: params.dealId, actorId: params.dealerId }, tx);
  });

  await notifyDealerConfirmed(params.dealId, change, now);
  // §27 — the 12-hour reminder is a message about a question that has now been answered. Cancelled
  // here rather than left to the send-time recheck: the recheck WOULD suppress it (the row is no
  // longer PENDING), but a cancelled row says so in the outbox, and a comment two hundred lines
  // above this one already claimed the cancellation happened.
  await cancelByKey(
    reaffirmationReminderCancelKey(params.dealId),
    "the dealership confirmed before the reminder was due",
  ).catch((err) => {
    logger.error("reaffirmation: reminder cancel failed", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // The dealership's answer can be the LAST of the three clauses, not only the first — see
  // `advanceIfExitSatisfied`. A buyer who acknowledged the disclosure first left this branch as
  // the one that completes §Stage 10's exit, and it was the one branch that never asked.
  await advanceIfExitSatisfied(params.dealId, params.dealerId, "DEALER");
  return { status: "CONFIRMED", materialChange: null };
}

function snapshotFromOffer(offer: {
  otdPriceCents: number;
  vin: string | null;
  odometer: number | null;
  aprRate: number | null;
  termMonths: number | null;
  junkFeeItems: Prisma.JsonValue;
  addOnItems: Prisma.JsonValue | null;
  incentiveItems: Prisma.JsonValue | null;
  vehicleYear: number | null;
  vehicleTrim: string | null;
  vehicleCondition: string | null;
  requiredFeatureMatches: Prisma.JsonValue | null;
}): ReaffirmationSnapshot {
  return {
    otdCents: offer.otdPriceCents,
    vin: offer.vin,
    odometer: offer.odometer,
    aprRate: offer.aprRate,
    termMonths: offer.termMonths,
    monthlyPaymentCents: null,
    deliveryDate: null,
    vehicleYear: offer.vehicleYear,
    vehicleTrim: offer.vehicleTrim,
    vehicleCondition: offer.vehicleCondition,
    drivetrain: null,
    feeItems: coerceFeeItems(offer.junkFeeItems),
    addOnItems: coerceFeeItems(offer.addOnItems),
    requiredFeatures: coerceFeatureNames(offer.requiredFeatureMatches),
  };
}

/**
 * Offer line items arrive in three historical shapes (`{name, amount}` dollars, `{label, amount}`,
 * `{name, amountCents}`) — `junk-fee-items.ts` normalises on write, but rows written before that
 * normalisation still carry the old ones. Reading defensively here keeps a legacy offer from
 * producing a phantom "new fee" the first time it is reaffirmed.
 */
function coerceFeeItems(value: Prisma.JsonValue | null): FeeLike[] {
  if (!Array.isArray(value)) return [];
  const out: FeeLike[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label : typeof o.name === "string" ? o.name : null;
    if (!label) continue;
    const cents =
      typeof o.amountCents === "number"
        ? o.amountCents
        : typeof o.amount === "number"
          ? Math.round(o.amount * 100)
          : null;
    out.push({ label, amountCents: cents });
  }
  return out;
}

function coerceFeatureNames(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" && !Array.isArray(v) ? String((v as Record<string, unknown>).name ?? "") : ""))
    .filter((s) => s.length > 0);
}

// ───────────────────────────────────────────────────────────────────────────────
// The buyer's two decisions
// ───────────────────────────────────────────────────────────────────────────────

/**
 * §Stage 10: "The buyer acknowledges the condition disclosure before the transaction proceeds to
 * recap. This is a single explicit acknowledgment, not a stack of screens."
 */
export async function acknowledgeConditionDisclosure(params: {
  dealId: string;
  buyerId: string;
  now?: Date;
}): Promise<{ acknowledged: boolean; advanced: boolean }> {
  const now = params.now ?? new Date();
  const deal = await prisma.deal.findFirst({
    where: { id: params.dealId, buyerId: params.buyerId },
    select: { id: true, conditionDisclosureAcknowledgedAt: true },
  });
  if (!deal) throw new ReaffirmationError("NOT_FOUND", "Deal not found.");

  // THERE MUST BE A DISCLOSURE TO ACKNOWLEDGE. The route accepted this action at any point in the
  // stage and only the UI hid the button, so a buyer POSTing while the reaffirmation was still
  // PENDING recorded an acknowledgement of a condition disclosure THAT DID NOT YET EXIST — a
  // compliance-void consent, and one that then stranded the deal, because the dealership's later
  // confirmation had nothing left to trigger.
  //
  // §Stage 10 orders these: the dealership discloses "known damage, prior use, title brands, open
  // recalls and reconditioning", and THEN "the buyer acknowledges the condition disclosure before
  // the transaction proceeds to recap". An acknowledgement before the disclosure is not an early
  // acknowledgement; it is a different act.
  const confirmed = await prisma.dealerReaffirmation.findFirst({
    where: { dealId: params.dealId, status: "CONFIRMED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, disclosureArtifactUrls: true },
  });
  if (!confirmed) {
    throw new ReaffirmationError(
      "NOTHING_TO_ACKNOWLEDGE",
      "The dealership has not confirmed this deal yet, so there is no condition disclosure to " +
        "acknowledge. We will tell you the moment there is.",
    );
  }

  if (!deal.conditionDisclosureAcknowledgedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: params.dealId },
        data: { conditionDisclosureAcknowledgedAt: now },
      });
      await tx.dealerReaffirmation.updateMany({
        where: { dealId: params.dealId, buyerAcknowledgedAt: null },
        data: { buyerAcknowledgedAt: now },
      });
    });
  }

  const advanced = await advanceIfExitSatisfied(params.dealId, params.buyerId);
  return { acknowledged: true, advanced };
}

/**
 * §10a — the buyer's single accept-or-reject on a proposed material change.
 *
 * Reject is not a dead end: §Stage 10's failure clause returns the buyer to the remaining valid
 * offers with the reason stated, and that is what `returnToRemainingOffers` does.
 */
export async function decideMaterialChange(params: {
  dealId: string;
  buyerId: string;
  accept: boolean;
  now?: Date;
}): Promise<{ decision: "ACCEPTED" | "REJECTED"; advanced: boolean }> {
  const now = params.now ?? new Date();
  const deal = await prisma.deal.findFirst({
    where: { id: params.dealId, buyerId: params.buyerId },
    select: { id: true, status: true },
  });
  if (!deal) throw new ReaffirmationError("NOT_FOUND", "Deal not found.");

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId: params.dealId, status: "MATERIAL_CHANGE_PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!reaffirmation) {
    throw new ReaffirmationError("NO_PENDING_CHANGE", "There is no change awaiting your decision.");
  }

  if (!params.accept) {
    await prisma.dealerReaffirmation.update({
      where: { id: reaffirmation.id },
      data: { status: "REJECTED", buyerDecision: "REJECTED", decidedAt: now, updatedAt: now },
    });
    await returnToRemainingOffers({
      dealId: params.dealId,
      reason: "You rejected the change the dealership proposed.",
      cause: "MATERIAL_CHANGE_REJECTED",
      actorId: params.buyerId,
      now,
    });
    return { decision: "REJECTED", advanced: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.dealerReaffirmation.update({
      where: { id: reaffirmation.id },
      data: { status: "CONFIRMED", buyerDecision: "ACCEPTED", decidedAt: now, updatedAt: now },
    });
    await tx.deal.update({
      where: { id: params.dealId },
      data: {
        vehicleHoldUntil: reaffirmation.holdUntil,
        otdCentsConfirmed: reaffirmation.confirmedOtdCents,
        vin: reaffirmation.confirmedVin,
      },
    });
    // The lift happens HERE on this branch, not at submission: the dealership's answer carried a
    // change, so the confirmation is only complete once the buyer has accepted it.
    await liftIdentityFirewall({ dealId: params.dealId, actorId: params.buyerId }, tx);
  });

  const advanced = await advanceIfExitSatisfied(params.dealId, params.buyerId);
  return { decision: "ACCEPTED", advanced };
}

// ───────────────────────────────────────────────────────────────────────────────
// The exit
// ───────────────────────────────────────────────────────────────────────────────

export interface ExitCheck {
  satisfied: boolean;
  missing: string[];
}

/**
 * §Stage 10's exit, all four clauses, in one place.
 *
 * "Exit. Dealership reaffirms, buyer acknowledges disclosure, no unresolved material change."
 * plus §10b's outside-winner verification.
 */
export async function reaffirmationExitSatisfied(dealId: string, db: Db = prisma): Promise<ExitCheck> {
  const missing: string[] = [];

  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      conditionDisclosureAcknowledgedAt: true,
      offer: { select: { dealer: { select: { isSystemPlaceholder: true } } } },
    },
  });
  if (!deal) return { satisfied: false, missing: ["the deal could not be read"] };

  const reaffirmation = await db.dealerReaffirmation.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!reaffirmation) missing.push("the dealership has not been asked to confirm");
  else if (reaffirmation.status === "MATERIAL_CHANGE_PENDING") missing.push("a proposed change is awaiting your decision");
  else if (reaffirmation.status !== "CONFIRMED") missing.push("the dealership has not confirmed");

  if (!deal.conditionDisclosureAcknowledgedAt) missing.push("the condition disclosure has not been acknowledged");

  if (deal.offer?.dealer?.isSystemPlaceholder) {
    const gate = await outsideWinnerGate(dealId, db);
    if (!gate.satisfied) missing.push(...gate.missing);
  }

  return { satisfied: missing.length === 0, missing };
}

/**
 * Advance to RECAP_PENDING when — and only when — all four exit clauses hold. Safe to call from
 * ANY of the three actions that can complete the conjunction; whichever completes it moves the
 * deal, and the others no-op.
 *
 * THE THIRD CALLER WAS MISSING, and its absence stranded deals. Only the buyer's two actions
 * called this. If the buyer acknowledged the disclosure BEFORE the dealership answered — which
 * nothing prevented — their acknowledgement found the exit unsatisfied, the dealership's
 * confirmation then satisfied it and called nothing, and the deal sat at DEALER_CONFIRMATION with
 * every clause true, no button left to press on either side and no sweep that looks at it. The
 * ordering is not the caller's to know, which is why every one of the three now asks.
 */
export async function advanceIfExitSatisfied(
  dealId: string,
  actorId: string,
  actorRole: "BUYER" | "DEALER" | "SYSTEM" = "BUYER",
): Promise<boolean> {
  const exit = await reaffirmationExitSatisfied(dealId);
  if (!exit.satisfied) return false;
  return advanceDealStatus(dealId, DealStatus.RECAP_PENDING, {
    actorId,
    actorRole,
    reason: "Stage 10 complete: dealership reaffirmed, disclosure acknowledged, no open material change.",
    expectedFrom: DealStatus.DEALER_CONFIRMATION,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// §10b — the outside winner
// ───────────────────────────────────────────────────────────────────────────────

/**
 * §10b: "An outside winner completes rooftop claim, account verification, dealer agreement
 * signature, and required business verification before the Deal advances past this stage."
 *
 * All four, named individually, because a gate that reports "not verified" tells an operator
 * nothing about what to chase.
 */
export async function outsideWinnerGate(dealId: string, db: Db = prisma): Promise<ExitCheck> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      dealerId: true,
      rooftopId: true,
      dealer: {
        select: {
          id: true,
          status: true,
          isSystemPlaceholder: true,
          rooftopId: true,
          agreementSignature: { select: { signedAt: true } },
        },
      },
    },
  });
  const missing: string[] = [];

  // §13-D20: `Offer.dealerId` stays on the placeholder; `Deal.dealerId` is set to the claimed
  // Dealer when the sequence completes. So "claimed" IS `Deal.dealerId` naming a real dealership.
  if (!deal?.dealerId || !deal.dealer || deal.dealer.isSystemPlaceholder) {
    missing.push("the dealership has not claimed its rooftop account");
    return { satisfied: false, missing };
  }
  if (!deal.dealer.rooftopId) missing.push("the claimed account is not resolved to a rooftop");
  if (deal.dealer.status !== "ACTIVE") missing.push("the dealership account is not active");
  if (!deal.dealer.agreementSignature?.signedAt) missing.push("the dealer agreement is unsigned");

  const verification = await db.dealerVerification.findUnique({
    where: { dealerId: deal.dealerId },
    select: { verified: true },
  });
  if (!verification?.verified) missing.push("business verification is incomplete");

  return { satisfied: missing.length === 0, missing };
}

// ───────────────────────────────────────────────────────────────────────────────
// Rejection, timeout, and the hold
// ───────────────────────────────────────────────────────────────────────────────

export async function rejectReaffirmation(params: {
  dealId: string;
  reason: string;
  actorId: string;
  code: string;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  await prisma.dealerReaffirmation.updateMany({
    where: { dealId: params.dealId, status: { in: ["PENDING", "MATERIAL_CHANGE_PENDING"] } },
    data: { status: "REJECTED", updatedAt: now },
  });
  await returnToRemainingOffers({
    dealId: params.dealId,
    reason: params.reason,
    cause: params.code === "VEHICLE_SOLD_BEFORE_CONTRACT_OR_PICKUP" ? "VEHICLE_UNAVAILABLE" : "DEALER_REJECTED",
    actorId: params.actorId,
    now,
  });
}

/**
 * §10c — THE WINDOW IN WHICH THE VEHICLE HOLD MEANS ANYTHING.
 *
 * The predicate is the CONTRACT REQUEST, not the hold date alone: a deal already at
 * CONTRACT_PENDING or beyond has passed the point the hold exists to protect, so its expiry is not
 * an exception — and, the correction this list was hoisted for, its RELEASE is not a stand-down.
 *
 * It lived inside `sweepExpiringHolds` as a local, where `releaseVehicleHold` could not reach it.
 * That function checked ownership and stopped: the dealership that owned a deal at SIGNING_PENDING
 * could still "release its hold" and take the whole deal down with it — CANCELLED, the firewall
 * revoked, the buyer emailed, a dealer-fault SLA violation filed. One list, both halves of the
 * decision, for the same reason the ownership check is shared: two copies drift.
 */
export const PRE_CONTRACT_HOLD_STATUSES: readonly DealStatus[] = [
  DealStatus.DEALER_CONFIRMATION,
  DealStatus.RECAP_PENDING,
  DealStatus.FINANCING_PENDING,
  DealStatus.FEE_PENDING,
  DealStatus.FEE_PAID,
  DealStatus.INSURANCE_PENDING,
] as const;

/**
 * §10c — the sweep that asks the dealership to extend or release.
 */
export async function sweepExpiringHolds(now: Date = new Date()): Promise<{
  expiring: number;
  expired: number;
}> {
  const deals = await prisma.deal.findMany({
    where: {
      vehicleHoldUntil: { not: null, lte: new Date(now.getTime() + 24 * 3600_000) },
      status: { in: [...PRE_CONTRACT_HOLD_STATUSES] },
    },
    select: { id: true, vehicleHoldUntil: true, buyerId: true, status: true },
    take: 200,
  });

  let expiring = 0;
  let expired = 0;
  for (const deal of deals) {
    const holdUntil = deal.vehicleHoldUntil!;
    const isExpired = holdUntil.getTime() <= now.getTime();
    try {
      await raiseException({
        code: "VEHICLE_HOLD_EXPIRED",
        dealId: deal.id,
        buyerId: deal.buyerId,
        // One row per deal per hold instant, so a ten-minute cron does not open 144 a day.
        idempotencyKey: `VEHICLE_HOLD:${deal.id}:${holdUntil.toISOString()}`,
        detail: isExpired
          ? `The vehicle hold expired at ${holdUntil.toISOString()} and the contract has not been requested. Ask the dealership to extend or release.`
          : `The vehicle hold expires at ${holdUntil.toISOString()} and the contract has not been requested.`,
      });
      await notifyHoldExpiring(deal.id, holdUntil, isExpired);
      if (isExpired) expired += 1;
      else expiring += 1;
    } catch (err) {
      logger.error("hold sweep: failed to raise or notify", {
        dealId: deal.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { expiring, expired };
}

/** §10c — the dealership extends. */
export async function extendVehicleHold(params: {
  dealId: string;
  dealerId: string;
  holdUntil: Date;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { dealerId: true, offer: { select: { dealerId: true } }, vehicleHoldUntil: true },
  });
  if (!deal) throw new ReaffirmationError("NOT_FOUND", "Deal not found.");
  if (deal.dealerId !== params.dealerId && deal.offer?.dealerId !== params.dealerId) {
    throw new ReaffirmationError("FORBIDDEN", "This deal belongs to another dealership.");
  }
  if (deal.vehicleHoldUntil && params.holdUntil <= deal.vehicleHoldUntil) {
    throw new ReaffirmationError("NOT_AN_EXTENSION", "The new hold date must be later than the current one.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.deal.update({ where: { id: params.dealId }, data: { vehicleHoldUntil: params.holdUntil } });
    await tx.dealerReaffirmation.updateMany({
      where: { dealId: params.dealId },
      data: { holdUntil: params.holdUntil, updatedAt: now },
    });
  });
}

/**
 * §10c — "A released hold returns the buyer to the remaining valid offers."
 *
 * OWNERSHIP IS CHECKED HERE, AND IT WAS NOT. This function took `actorId` and went straight to
 * `returnToRemainingOffers`, with no ownership check on any line of the path — including the
 * route, which authenticated the dealer and passed the `dealId` through unverified. Any
 * authenticated dealership could therefore POST ANOTHER DEALERSHIP'S deal id and destroy that
 * deal: CANCELLED, the identity firewall revoked, the buyer emailed "you have been returned to the
 * remaining offers", and a dealer-fault SLA violation filed against the victim's rooftop.
 *
 * `extendVehicleHold` below has always carried this check. Release — the DESTRUCTIVE half of the
 * same decision — did not, which is the wrong way round: the cheaper action was guarded and the
 * irreversible one was open. Golden rule 3: server-side authorization always, and a route that
 * merely authenticates has not authorized anything.
 *
 * `dealerId` is required rather than optional so a future caller cannot omit it and silently get
 * the old behaviour back. There is exactly one caller today.
 */
export async function releaseVehicleHold(params: {
  dealId: string;
  /** The authenticated dealership. Re-checked against the deal here, never trusted. */
  dealerId: string;
  actorId: string;
  reason?: string;
  now?: Date;
}): Promise<void> {
  const owned = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { status: true, dealerId: true, offer: { select: { dealerId: true } } },
  });
  if (!owned) throw new ReaffirmationError("NOT_FOUND", "Deal not found.");
  // Either id is ownership — `Offer.dealerId` is the immutable attribution and `Deal.dealerId` is
  // §13-D20's lineage field, set when an outside winner completes its claim. The same test
  // `extendVehicleHold` uses, so the two halves of one decision cannot drift.
  if (owned.dealerId !== params.dealerId && owned.offer?.dealerId !== params.dealerId) {
    throw new ReaffirmationError("FORBIDDEN", "This deal belongs to another dealership.");
  }
  // OWNERSHIP WAS CHECKED AND LIFECYCLE WAS NOT, which left the OWNER of a deal at SIGNING_PENDING
  // able to cancel it through a control §10c scopes to the pre-contract window. Same list the
  // sweep uses — see `PRE_CONTRACT_HOLD_STATUSES`.
  //
  // SECOND, NOT FIRST. This check names the deal's status in its message, and the route maps
  // FORBIDDEN to 404 precisely so that "a dealership must not learn that a deal exists but is not
  // theirs". Ordered the other way, a dealership POSTing another's deal id would be told that
  // deal's stage instead of a 404 — a new disclosure introduced by the fix for a different one.
  if (!PRE_CONTRACT_HOLD_STATUSES.includes(owned.status)) {
    throw new ReaffirmationError(
      "HOLD_NOT_RELEASABLE",
      `This deal is ${owned.status}. §10c's hold covers the window before the contract is ` +
        `requested; past it, releasing is not a stand-down and this deal is not yours to cancel.`,
    );
  }
  await returnToRemainingOffers({
    dealId: params.dealId,
    reason: params.reason ?? "The dealership released its hold on the vehicle.",
    cause: "HOLD_RELEASED",
    actorId: params.actorId,
    now: params.now ?? new Date(),
  });
}

/**
 * A 24-hour window closing with no answer. §Stage 10's "timeout" branch — for BOTH windows.
 *
 * THE SECOND WINDOW WAS NOT SWEPT. This filtered on `status: "PENDING"`, which is the
 * dealership's window only. A row parked at MATERIAL_CHANGE_PENDING is a question awaiting the
 * BUYER, on its own clock (see the DECIDE branch, which now resets `dueAt` when it parks), and
 * §Stage 10 is explicit that "an unaccepted material change returns the buyer to the remaining
 * valid offers" — unaccepted includes unanswered. Without this the deal sat at
 * DEALER_CONFIRMATION forever with the vehicle held.
 *
 * The two branches file DIFFERENT causes, and that distinction is not cosmetic:
 * `DEALER_TIMED_OUT` is dealer fault and counts toward the rooftop's SLA scorecard, while a buyer
 * who does not answer is not a dealership failing, so it must never reach that counter.
 */
export async function expireOverdueReaffirmations(now: Date = new Date()): Promise<{ expired: number }> {
  const overdue = await prisma.dealerReaffirmation.findMany({
    where: { status: { in: ["PENDING", "MATERIAL_CHANGE_PENDING"] }, dueAt: { not: null, lte: now } },
    select: { id: true, dealId: true, status: true },
    take: 100,
  });
  let expired = 0;
  for (const row of overdue) {
    const dealerWindow = row.status === "PENDING";
    try {
      // CAS on the status this row was read with, so a dealership confirming — or a buyer
      // deciding — in the same second is not overwritten by the sweep.
      const claimed = await prisma.dealerReaffirmation.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: "TIMED_OUT", updatedAt: now },
      });
      if (claimed.count === 0) continue;
      await returnToRemainingOffers({
        dealId: row.dealId,
        reason: dealerWindow
          ? "The dealership did not confirm within 24 hours."
          : "The change the dealership proposed was not accepted within 24 hours.",
        cause: dealerWindow ? "DEALER_TIMED_OUT" : "MATERIAL_CHANGE_REJECTED",
        actorId: "system",
        now,
      });
      expired += 1;
    } catch (err) {
      logger.error("reaffirmation expiry: failed", {
        dealId: row.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── THE REPAIR PASS ───────────────────────────────────────────────────────────────────────
  //
  // A stand-down is two steps that cannot be one transaction: the reaffirmation's status is a row
  // write, and `returnToRemainingOffers` cancels the deal, revokes the firewall, counts the
  // remaining offers, opens the §26 exception and enqueues the buyer's notice. If the second step
  // throws — a deal update that deadlocks, an offer query that times out — the first has already
  // committed, and the deal is left at DEALER_CONFIRMATION behind a REJECTED or TIMED_OUT
  // reaffirmation. The buyer's page then falls through to its WAITING panel, which says "The
  // dealership is confirming it can do this deal" — false, with no path out and nothing watching.
  //
  // Nothing swept that state, so this does. `returnToRemainingOffers` is safe to re-drive: the
  // deal update is idempotent, the exception and the notice are keyed, and the firewall revocation
  // is a no-op once revoked.
  const stranded = await prisma.dealerReaffirmation.findMany({
    where: {
      status: { in: ["REJECTED", "TIMED_OUT"] },
      deal: { status: DealStatus.DEALER_CONFIRMATION },
    },
    select: { id: true, dealId: true, status: true },
    take: 50,
  });
  for (const row of stranded) {
    try {
      logger.error("reaffirmation: stand-down left a deal live — re-driving", {
        dealId: row.dealId,
        reaffirmationStatus: row.status,
      });
      await returnToRemainingOffers({
        dealId: row.dealId,
        reason:
          row.status === "REJECTED"
            ? "This deal could not go ahead with the dealership you selected."
            : "The confirmation window closed without an answer.",
        cause: row.status === "REJECTED" ? "MATERIAL_CHANGE_REJECTED" : "DEALER_TIMED_OUT",
        actorId: "system",
        now,
      });
      expired += 1;
    } catch (err) {
      logger.error("reaffirmation repair: failed", {
        dealId: row.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { expired };
}

// ───────────────────────────────────────────────────────────────────────────────
// Notices — every one through the §27 dispatcher
// ───────────────────────────────────────────────────────────────────────────────

async function buyerRecipient(dealId: string): Promise<{ buyerId: string; email: string | null; firstName: string } | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { buyerId: true, buyer: { select: { firstName: true, user: { select: { email: true } } } } },
  });
  if (!deal?.buyer) return null;
  return {
    buyerId: deal.buyerId,
    email: deal.buyer.user?.email ?? null,
    firstName: deal.buyer.firstName,
  };
}

async function notifyMaterialChange(dealId: string, differences: MaterialDifference[], now: Date): Promise<void> {
  const to = await buyerRecipient(dealId);
  if (!to) return;
  if (!to.email) {
    await raiseException({
      code: "COMMS_NO_DELIVERABLE_CHANNEL",
      dealId,
      buyerId: to.buyerId,
      idempotencyKey: `COMMS_NO_CHANNEL:${PHASE_7_TEMPLATES.MATERIAL_CHANGE_PROPOSED}:${dealId}`,
      detail: "A material change is awaiting this buyer's decision and they have no email address.",
    }).catch((raiseErr) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — that is the difference between a
      // guarded terminal call and a swallowed one.
      logger.error("exception could not be raised", {
        error: raiseErr instanceof Error ? raiseErr.message : String(raiseErr),
      });
    });
    return;
  }
  const content = renderMaterialChangeProposed({ firstName: to.firstName, differences, dealId });
  await enqueueOrRaise(
    {
      triggerEvent: "material_change_proposed",
      templateKey: PHASE_7_TEMPLATES.MATERIAL_CHANGE_PROPOSED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: to.buyerId,
      to: to.email,
      payload: { email: to.email, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.MATERIAL_CHANGE_PROPOSED}:${dealId}:${now.toISOString()}`,
    },
    {
      buyerId: to.buyerId,
      idempotencyKey: `MATERIAL_CHANGE_NOTICE_ENQUEUE_FAILED:${dealId}:${now.toISOString()}`,
      detail:
        "A material change is awaiting this buyer's decision and the notice could not be enqueued. " +
        "The deal is parked on a question they have not been asked, and the 24-hour clock on it " +
        "is running.",
    },
  );
}

async function notifyDealerConfirmed(dealId: string, change: MaterialChangeOutcome, now: Date): Promise<void> {
  const to = await buyerRecipient(dealId);
  if (!to?.email) return;
  const content = renderDealerConfirmed({
    firstName: to.firstName,
    dealId,
    autoAppliedSavingCents: change.outcome === "AUTO_APPLY" ? change.savingCents : null,
  });
  await enqueueOrRaise(
    {
      triggerEvent: "dealer_confirms",
      templateKey: PHASE_7_TEMPLATES.DEALER_CONFIRMED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: to.buyerId,
      to: to.email,
      payload: { email: to.email, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.DEALER_CONFIRMED}:${dealId}`,
    },
    {
      buyerId: to.buyerId,
      idempotencyKey: `DEALER_CONFIRMED_NOTICE_ENQUEUE_FAILED:${dealId}`,
      detail:
        "The dealership confirmed this deal and the buyer's notice could not be enqueued. They are " +
        "waiting on the acknowledgement §Stage 10 needs from them before the deal can reach recap.",
    },
  );
  void now;
}

/**
 * §27.1 — "Vehicle hold expiring → Buyer + DEALERSHIP + Operations → extend or release."
 *
 * All three, and only the buyer and Operations halves existed. The buyer's copy said "our team has
 * asked them to extend the hold or release it" while nothing had asked them, and the dealership —
 * the only party that CAN extend or release — heard nothing at all. §10c's whole mechanism was a
 * queue row and a sentence.
 */
async function notifyHoldExpiring(dealId: string, holdUntil: Date, expired: boolean): Promise<void> {
  // THE PAYLOAD CARRIES `holdUntil`, and it is not decoration. `skipIfHoldNoLongerExpiring` reads
  // `ctx.payload.holdUntil` to suppress a notice about a hold that was extended after the row was
  // queued — a branch that could never fire while the payload omitted the field, so a buyer could
  // be told "your hold expires at 10:00" ten minutes after the dealership extended it to next week.
  const stamp = holdUntil.toISOString();

  const to = await buyerRecipient(dealId);
  if (to?.email) {
    const content = renderVehicleHoldExpiring({ firstName: to.firstName, holdUntil, expired, dealId });
    await enqueueOrRaise(
      {
        triggerEvent: "vehicle_hold_expiring",
        templateKey: PHASE_7_TEMPLATES.VEHICLE_HOLD_EXPIRING,
        channel: "email",
        recipientKind: "buyer",
        recipientId: to.buyerId,
        to: to.email,
        payload: { email: to.email, subject: content.subject, html: content.html, text: content.text, holdUntil: stamp },
        dealId,
        idempotencyKey: `${PHASE_7_TEMPLATES.VEHICLE_HOLD_EXPIRING}:buyer:${dealId}:${stamp}`,
      },
      {
        buyerId: to.buyerId,
        idempotencyKey: `HOLD_NOTICE_ENQUEUE_FAILED:buyer:${dealId}:${stamp}`,
        detail: "This buyer's vehicle hold is expiring and the notice could not be enqueued.",
      },
    );
  }

  const dealer = await dealerRecipient(dealId);
  if (dealer?.email) {
    const content = renderVehicleHoldExpiring({
      firstName: dealer.dealershipName,
      holdUntil,
      expired,
      dealId,
      forDealer: true,
    });
    await enqueueOrRaise(
      {
        triggerEvent: "vehicle_hold_expiring",
        templateKey: PHASE_7_TEMPLATES.VEHICLE_HOLD_EXPIRING,
        channel: "email",
        recipientKind: "dealer",
        recipientId: dealer.dealerId,
        to: dealer.email,
        payload: { email: dealer.email, subject: content.subject, html: content.html, text: content.text, holdUntil: stamp },
        dealId,
        idempotencyKey: `${PHASE_7_TEMPLATES.VEHICLE_HOLD_EXPIRING}:dealer:${dealId}:${stamp}`,
      },
      {
        dealerId: dealer.dealerId,
        idempotencyKey: `HOLD_NOTICE_ENQUEUE_FAILED:dealer:${dealId}:${stamp}`,
        detail:
          "This dealership's vehicle hold is expiring and the request to extend or release it could " +
          "not be enqueued. They are the only party who can do either.",
      },
    );
  }
}

/**
 * The dealership's own inbox for this deal, placeholder-aware — an outside winner's address lives
 * on the OFFER (`externalDealerEmail`), not on the shared system placeholder Dealer row.
 */
async function dealerRecipient(
  dealId: string,
): Promise<{ dealerId: string | null; email: string | null; dealershipName: string } | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      offer: {
        select: {
          dealerId: true,
          externalDealerName: true,
          externalDealerEmail: true,
          dealer: {
            select: { isSystemPlaceholder: true, dealershipName: true, user: { select: { email: true } } },
          },
        },
      },
    },
  });
  if (!deal?.offer) return null;
  const placeholder = deal.offer.dealer?.isSystemPlaceholder === true;
  return {
    // Never the placeholder's id — §13-D20's lineage. A recipient id that names the shared row
    // would file every outside dealership's message against one dealer.
    dealerId: placeholder ? null : deal.offer.dealerId,
    email: placeholder ? deal.offer.externalDealerEmail : deal.offer.dealer?.user?.email ?? null,
    dealershipName: placeholder
      ? deal.offer.externalDealerName ?? "your dealership"
      : deal.offer.dealer?.dealershipName ?? "your dealership",
  };
}
