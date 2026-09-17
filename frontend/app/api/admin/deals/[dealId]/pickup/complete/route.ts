// POST /api/admin/deals/[dealId]/pickup/complete
// Admin manually overrides QR scan to mark pickup as COMPLETED.
// Sets Pickup.status = COMPLETED and Deal.status = COMPLETED.
// Sends buyer notification. AuditLog entry required.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { PICKUP_SAFE_SELECT } from "@/lib/services/pickup/pickup-select";
import { InsuranceRequiredError, ReleaseNotClearedError } from "@/lib/services/deal/deal.service";
import { recordDealerRelease, confirmPossession } from "@/lib/services/pickup/pickup-completion.service";
import { z } from "zod";
import {
  sendDealerPayoutInitiatedEmail,
} from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Override reason is required"),
  // §STAGE 20 ASKS FOR THESE, SO THE ROUTE HAS TO BE ABLE TO CARRY THEM. Its thirteenth
  // precondition is "Buyer possession, VIN, mileage, and condition confirmed" — four facts, not
  // a timestamp. On the buyer's own route they come from the form; on this one they come from
  // whoever coordinated the handover.
  //
  // OPTIONAL, AND NOT DEFAULTED. An admin who does not have the mileage gets the completion
  // refused with "the mileage at possession was not recorded" naming the buyer, which is what
  // §Stage 20 says should happen. Substituting a zero would satisfy the checklist by
  // manufacturing evidence about a vehicle's condition at handover, which is the one thing a
  // completion record must never do.
  odometerAtPossession: z.number().int().min(0).max(1_000_000).optional(),
  conditionAsDelivered: z.string().trim().min(1).max(2000).optional(),
  /** False opens §Stage 21's MISSING_ACCESSORIES obligation against the dealership. */
  keysAndAccessoriesReceived: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  // Force-completing a deal (bypasses the insurance gate) is a privileged override —
  // restrict to SUPER/OPERATIONS admins, consistent with the other override routes.
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      pickup: { select: PICKUP_SAFE_SELECT },
      buyer: { include: { user: { select: { email: true } } } },
      offer: { include: { dealer: { include: { user: { select: { email: true } } } } } },
    },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;

  // §8.2 defect (4) — THIS ROUTE NO LONGER COMPLETES ANYTHING ITSELF.
  //
  // It used to upsert the Pickup to COMPLETED and then advance the Deal with `force: true`,
  // which made it one of five writers of the same irreversible act, each with its own
  // preconditions. It now goes through the ONE completion writer, which owns the transaction,
  // the release gates, the history row and both parties' outbox messages.
  //
  // THE `force` IS GONE, AND THAT IS THE POINT. The comment it replaced said the insurance gate
  // was "intentionally bypassed" — an admin screen that releases a vehicle without insurance,
  // without the dealership's executed contract and without funding clearance is conditional
  // delivery, which §Stage 14 forbids in as many words and Phase 8 closed everywhere else. An
  // Operations admin can still complete a deal; they cannot complete one that is not releasable.
  //
  // WHY IT RECORDS BOTH HALVES. A concierge (vehicle-request) deal has no dealership, so no scan
  // can ever record its release — §Stage 18's evidence has to come from somewhere, and for that
  // deal AutoLenis IS the coordinator. Both halves are attributed to ADMIN in DealStatusHistory
  // rather than dressed up as the dealer's and the buyer's own acts.
  const releaseOutcome = await recordDealerRelease({
    dealId,
    dealerId: deal.offer?.dealerId ?? admin.adminId,
    identityVerified: true,
    actor: { role: "ADMIN", id: admin.adminId },
  }).catch((err: unknown) => err);

  if (releaseOutcome instanceof InsuranceRequiredError) {
    return adminError("INSURANCE_REQUIRED", "Insurance proof is required before this vehicle can be released.", 409);
  }
  if (releaseOutcome instanceof ReleaseNotClearedError) {
    return adminError("RELEASE_NOT_CLEARED", releaseOutcome.message, 409);
  }
  if (releaseOutcome instanceof Error) throw releaseOutcome;

  let outcome;
  try {
    outcome = await confirmPossession({
      dealId,
      buyerId: deal.buyerId,
      vehicleReceived: true,
      vinMatch: true,
      odometerAtPossession: parsed.data.odometerAtPossession ?? null,
      conditionAsDelivered: parsed.data.conditionAsDelivered ?? null,
      keysAndAccessoriesReceived: parsed.data.keysAndAccessoriesReceived ?? true,
      actor: { role: "ADMIN", id: admin.adminId },
    });
  } catch (err) {
    if (err instanceof InsuranceRequiredError) {
      return adminError("INSURANCE_REQUIRED", "Insurance proof is required before this deal can complete.", 409);
    }
    if (err instanceof ReleaseNotClearedError) {
      return adminError("RELEASE_NOT_CLEARED", err.message, 409);
    }
    throw err;
  }

  if (!outcome.ok) {
    // §Stage 20: "the website shows the exact missing checkpoint and the responsible party." The
    // buyer's route and `completeJourneyPickup` both return the list; this route dropped it, so an
    // Operations admin who omitted the odometer got an opaque "could not be completed" and had to
    // go and work out which of fourteen things was false. The items travel in `details`.
    if (outcome.reason === "preconditions_unmet") {
      const first = outcome.outstanding[0];
      return adminError(
        "COMPLETION_BLOCKED",
        first
          ? `${outcome.outstanding.length} completion precondition(s) outstanding. ${first.label} — ${first.owner}: ${first.detail}`
          : "A completion precondition is outstanding.",
        409,
        {
          outstanding: outcome.outstanding.map((i) => ({
            key: i.key,
            checkpoint: i.label,
            responsibleParty: i.owner,
            detail: i.detail,
          })),
        },
      );
    }
    return adminError(
      "NOT_COMPLETABLE",
      outcome.reason === "not_in_handover"
        ? "This deal is not at a stage where a pickup can be completed."
        : "This deal could not be completed.",
      409,
    );
  }

  // ── #18: A RETRY MUST NOT SEND THE DEALERSHIP A SECOND PAYOUT NOTICE ──
  //
  // `confirmPossession` is idempotent and answers `alreadyComplete: true` for a second call, but
  // everything below it here is not: a double-clicked "Mark completed" wrote a second
  // Notification and a second AuditLog, re-fired `syncGhlTag`, scheduled a second `deal_complete`
  // lifecycle workload, and sent a SECOND `sendDealerPayoutInitiatedEmail` to the dealership. The
  // completion service's own outbox rows are keyed and de-duplicate; these are not.
  if (outcome.alreadyComplete) {
    return adminSuccess({ alreadyComplete: true, completedAt: outcome.completedAt });
  }

  // NULL, not "". A concierge deal may have no Pickup row, and an empty string in an audit
  // row reads as an id that exists and resolves to nothing.
  const pickup = deal.pickup ?? { id: null as string | null };

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: deal.buyerId,
      type: "DEAL_STAGE_CHANGED",
      channel: "IN_APP",
      title: "Vehicle pickup completed",
      body: "Your pickup has been manually confirmed by an admin. Congratulations on your new vehicle!",
    },
  });

  await createAuditLog(admin, request, {
    action: "PICKUP_MANUAL_OVERRIDE",
    entityType: "Deal",
    entityId: dealId,
    reason,
    metadata: { pickupId: pickup.id, previousStatus: deal.pickup?.status ?? "NONE", newStatus: "COMPLETED" },
  });

  // NO COMPLETION MAIL FROM HERE — §8.2 defect (7). `confirmPossession` queues the buyer's
  // receipt and the dealership's confirmation to `comms_outbox` inside the completion
  // transaction, so they commit with the status rather than after it and retry on their own.
  syncGhlTag(deal.buyer?.user?.email, "purchase-complete");

  // Lifecycle — congratulations + review-request sequence (the review touch, on
  // the internal path, also seeds the day-60 refinance + day-27 referral touches
  // via the drain's coupled postSend). Internal vs QStash is chosen per the
  // deal-complete activation flag (default QStash).
  if (deal.buyer?.user?.email) {
    scheduleLifecycleWorkload({
      workload: "deal_complete",
      buyerId: deal.buyerId,
      dealId,
      firstName: deal.buyer.firstName,
      email: deal.buyer.user.email,
    }).catch(() => {});
  }

  // Notify the dealer that pickup completed and payout is initiating — non-blocking.
  const dealerEmail = deal.offer?.dealer?.user?.email;
  if (dealerEmail) {
    const vehicleRef = `Deal ${dealId.slice(0, 8)}`;
    const dealershipName = deal.offer?.dealer?.dealershipName ?? "";
    // The dealership's "pickup completed" confirmation is §27.1's "Buyer confirms possession →
    // Buyer + dealership" row, and `confirmPossession` queues it through the dispatcher inside
    // the completion transaction. Sending it here too would deliver it twice on this path and
    // not at all on the dealer-scan path, which is how it behaved before Phase 9.
    const offerPriceCents = deal.offer?.otdPriceCents ?? 0;
    await sendDealerPayoutInitiatedEmail({
      to: dealerEmail,
      contactName: dealershipName,
      vehicleRef,
      amountCents: offerPriceCents,
      estimatedArrival: "3-5 business days",
      payoutId: dealId,
    }).catch((err: unknown) => logger.error("[pickup/complete] dealer payout initiated email failed:", err));
  }

  // The canonical `purchase_completed` domain event is emitted EXACTLY ONCE by the completion
  // service, after its transaction commits and only for the call that actually completed the
  // deal, so this route does not emit it.

  return adminSuccess({
    dealId,
    dealStatus: "COMPLETED",
    pickupId: pickup.id,
    pickupStatus: "COMPLETED",
    completedAt: outcome.completedAt.toISOString(),
    alreadyComplete: outcome.alreadyComplete,
  });
}
