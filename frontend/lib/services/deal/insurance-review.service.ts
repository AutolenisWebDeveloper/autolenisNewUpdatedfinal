// lib/services/deal/insurance-review.service.ts
//
// Stage 15 — the insurance review workflow, its Operations queue and its decision trail.
//
//   "An upload is not approval. Today an upload is treated as satisfied, advances the Deal
//    automatically, and passes the release gate. [NEW] — a review workflow with an
//    Operations queue and a decision trail is required.
//
//    Verification confirms the policy is active, names the buyer (and co-buyer where
//    applicable), and matches the VIN. Only VERIFIED or POLICY_BOUND permits release."
//
// §13-D31 RULED (2026-09-15). `EXTERNAL_UPLOADED` leaves the satisfied set. It is READ as
// UNDER_REVIEW rather than migrated, so no historical row is rewritten — and deals that
// already passed release on it are NOT re-gated. The owner's reasoning, recorded because it
// is the principle and not just this case: a decision already acted on is not reopened by a
// later rule change, and re-gating would mean telling a buyer whose vehicle was released
// that the release is now under review, which is not a thing you can do.
//
// WHAT THIS DOES NOT DO. AutoLenis "does not sell, bind, or broker insurance" (Stage 15).
// Nothing here creates, binds, prices or recommends a policy. It records a decision about a
// document a buyer supplied, and the three checks the decision rests on are stated to the
// reviewer rather than performed automatically — because whether a PDF's named insured
// matches the buyer is a judgement, and a service that claimed to have made it
// automatically would be claiming a verification nobody ran.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { InsuranceStatus } from "@prisma/client";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_8_TEMPLATES, insuranceReviewCancelKey } from "@/lib/services/comms/state-recheck-registry";
import {
  renderInsuranceRejected,
  renderInsuranceUploaded,
  renderInsuranceVerified,
} from "@/lib/services/comms/phase8-email-content";

export class InsuranceReviewError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "InsuranceReviewError";
  }
}

/** The three things a reviewer confirms (Stage 15). Stated, not inferred. */
export const INSURANCE_VERIFICATION_CHECKS = [
  "The policy is active on the expected pickup date",
  "It names the buyer, and the co-buyer where one is on the purchase",
  "It matches the VIN on the contract",
] as const;

/**
 * A buyer's upload puts the deal UNDER REVIEW and opens the Operations task.
 *
 * Replaces the old behaviour in one specific way: the deal is no longer ADVANCED by the
 * upload. Insurance is a parallel track (§13-D28) and the contract stage no longer waits on
 * it, so there is nothing for an upload to release — it opens a review instead.
 */
export async function recordInsuranceUpload(params: {
  dealId: string;
  buyerId: string;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();

  // EXTERNAL_UPLOADED is kept as the written value rather than replaced with UNDER_REVIEW,
  // so a row written before this phase and one written after look the same to every reader
  // — and INSURANCE_AWAITING_REVIEW treats both as outstanding. Changing the written value
  // would have split the population in two for no gain.
  await prisma.deal.updateMany({
    where: { id: params.dealId },
    data: { insuranceStatus: InsuranceStatus.EXTERNAL_UPLOADED },
  });

  await raiseException({
    code: "INSURANCE_REJECTED_OR_EXPIRED",
    dealId: params.dealId,
    detail:
      "Proof of insurance uploaded and awaiting an Operations decision. Confirm: " +
      INSURANCE_VERIFICATION_CHECKS.join("; ") + ".",
  }).catch((err) => {
    logger.error("insurance review: could not open the Operations task", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const buyer = await prisma.buyer.findUnique({
    where: { id: params.buyerId },
    select: { user: { select: { email: true } } },
  });
  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { vehicleYear: true, vehicleMake: true, vehicleModel: true },
  });
  const email = buyer?.user?.email;
  if (!email) return;

  const vehicle = [deal?.vehicleYear, deal?.vehicleMake, deal?.vehicleModel].filter(Boolean).join(" ") || "your vehicle";
  const content = renderInsuranceUploaded({ vehicle });
  await enqueueTransactional({
    triggerEvent: "insurance_uploaded",
    templateKey: PHASE_8_TEMPLATES.INSURANCE_UPLOADED,
    channel: "email",
    recipientKind: "buyer",
    recipientId: params.buyerId,
    to: email,
    payload: { email, subject: content.subject, html: content.html, text: content.text },
    dealId: params.dealId,
    // Keyed on the upload MOMENT, so a corrected re-upload after a rejection is
    // acknowledged again rather than silently deduped against the first one.
    idempotencyKey: `${PHASE_8_TEMPLATES.INSURANCE_UPLOADED}:${params.dealId}:${now.toISOString().slice(0, 13)}`,
    cancelKey: insuranceReviewCancelKey(params.dealId),
  });
}

export type InsuranceDecision = "VERIFIED" | "POLICY_BOUND" | "REJECTED" | "EXPIRED";

/**
 * Operations decides. The decision trail Stage 15 requires: who, when, which policy, and —
 * on a refusal — the SPECIFIC defect, because §26's row is "Name the defect; block release
 * until corrected" and a rejection that does not name one sends the buyer back to guess.
 */
export async function decideInsurance(params: {
  dealId: string;
  decision: InsuranceDecision;
  actorId: string;
  /** Required on REJECTED/EXPIRED. The buyer is told this verbatim. */
  reason?: string | null;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const refusing = params.decision === "REJECTED" || params.decision === "EXPIRED";

  if (refusing && (params.reason?.trim().length ?? 0) < 10) {
    throw new InsuranceReviewError(
      "REASON_REQUIRED",
      "§26: a rejection names the specific defect and requests a corrected document. A refusal " +
        "with no stated defect leaves the buyer to guess what to fix, which produces a second " +
        "wrong upload and a second review.",
    );
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      buyerId: true,
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      buyer: { select: { user: { select: { email: true } } } },
      offer: {
        select: {
          externalDealerEmail: true,
          dealerId: true,
          dealer: { select: { isSystemPlaceholder: true, user: { select: { email: true } } } },
        },
      },
    },
  });
  if (!deal) throw new InsuranceReviewError("DEAL_NOT_FOUND", "Deal not found");

  await prisma.$transaction(async (tx) => {
    await tx.deal.updateMany({
      where: { id: params.dealId },
      data: { insuranceStatus: params.decision as InsuranceStatus },
    });
    // The decision trail on the policy itself. Phase 1 added `reviewed_at`/`reviewed_by`
    // ALONGSIDE the older `verified_at`/`verified_by` for exactly this distinction, and
    // both are written for what each actually means: a review HAPPENED either way, and a
    // verification happened only when the answer was yes. Writing `verified_at` on a
    // rejection would record a verification that did not occur.
    await tx.insurancePolicy.updateMany({
      where: { dealId: params.dealId },
      data: {
        reviewedBy: params.actorId,
        reviewedAt: now,
        ...(refusing
          ? { rejectionReason: params.reason ?? null }
          : { rejectionReason: null, verifiedBy: params.actorId, verifiedAt: now }),
      },
    });
  });

  const vehicle = [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean).join(" ") || "your vehicle";
  const buyerEmail = deal.buyer?.user?.email ?? null;

  if (refusing) {
    if (buyerEmail) {
      const content = renderInsuranceRejected({
        vehicle,
        reason: params.reason!.trim(),
        expired: params.decision === "EXPIRED",
      });
      await enqueueTransactional({
        triggerEvent: "insurance_rejected",
        templateKey: PHASE_8_TEMPLATES.INSURANCE_REJECTED,
        channel: "email",
        recipientKind: "buyer",
        recipientId: deal.buyerId,
        to: buyerEmail,
        payload: { email: buyerEmail, subject: content.subject, html: content.html, text: content.text },
        dealId: params.dealId,
        idempotencyKey: `${PHASE_8_TEMPLATES.INSURANCE_REJECTED}:${params.dealId}:${now.toISOString().slice(0, 13)}`,
      });
    }
    await raiseException({
      code: "INSURANCE_REJECTED_OR_EXPIRED",
      dealId: params.dealId,
      detail: `Insurance ${params.decision.toLowerCase()}: ${params.reason}. Release is blocked until corrected.`,
    }).catch((err) => logger.error("insurance review: exception could not be raised", err));
    return;
  }

  // Verified or bound — the release requirement is met. Both parties are told, because the
  // dealership needs to know the vehicle may leave the lot and the buyer needs to know one
  // of the release conditions is done.
  if (buyerEmail) {
    const content = renderInsuranceVerified({ audience: "buyer", vehicle });
    await enqueueTransactional({
      triggerEvent: "insurance_verified",
      templateKey: PHASE_8_TEMPLATES.INSURANCE_VERIFIED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to: buyerEmail,
      payload: { email: buyerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.INSURANCE_VERIFIED}:buyer:${params.dealId}`,
    });
  }
  const dealerEmail = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerEmail
    : deal.offer?.dealer?.user?.email ?? null;
  if (dealerEmail) {
    const content = renderInsuranceVerified({ audience: "dealer", vehicle });
    await enqueueTransactional({
      triggerEvent: "insurance_verified",
      templateKey: PHASE_8_TEMPLATES.INSURANCE_VERIFIED,
      channel: "email",
      recipientKind: "dealer",
      recipientId: deal.offer?.dealerId ?? null,
      to: dealerEmail,
      payload: { email: dealerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.INSURANCE_VERIFIED}:dealer:${params.dealId}`,
    });
  }
}

/**
 * §Stage 15 fail path: "Expiry before pickup blocks release until corrected."
 *
 * Swept rather than checked only at release, because the gap between review and pickup is
 * exactly where a policy lapses and nobody is watching. A VERIFIED or POLICY_BOUND deal
 * whose policy expiry has passed goes back to EXPIRED, which removes it from the satisfied
 * set and blocks release — and the buyer is told the same day rather than at the counter.
 */
export async function sweepExpiredInsurance(now: Date = new Date(), limit = 200): Promise<{
  scanned: number;
  expired: number;
}> {
  // Two steps rather than one join: `InsurancePolicy.dealId` is a bare String with no
  // Prisma relation declared (schema.prisma:2604), so `where: { deal: {...} }` is not
  // expressible. The deal-status filter therefore runs as its own query rather than being
  // dropped — a sweep that expired a policy on a deal nowhere near release would email a
  // buyer about a blocked release that was not blocked.
  const lapsed = await prisma.insurancePolicy.findMany({
    where: { expiryDate: { lt: now }, dealId: { not: null } },
    select: { id: true, dealId: true, expiryDate: true },
    take: limit,
  });
  const dealIds = lapsed.map((p) => p.dealId!).filter(Boolean);
  const stillSatisfied = dealIds.length
    ? await prisma.deal.findMany({
        where: {
          id: { in: dealIds },
          insuranceStatus: { in: [InsuranceStatus.VERIFIED, InsuranceStatus.POLICY_BOUND] },
        },
        select: { id: true },
      })
    : [];
  const satisfiedIds = new Set(stillSatisfied.map((d) => d.id));
  const candidates = lapsed.filter((p) => p.dealId && satisfiedIds.has(p.dealId));

  let expired = 0;
  for (const policy of candidates) {
    if (!policy.dealId) continue;
    try {
      await decideInsurance({
        dealId: policy.dealId,
        decision: "EXPIRED",
        actorId: "SYSTEM",
        reason: `The policy on file expired on ${policy.expiryDate?.toDateString() ?? "an earlier date"}. Upload proof of current coverage — a vehicle cannot be released on a lapsed policy.`,
        now,
      });
      expired += 1;
    } catch (err) {
      logger.error("insurance sweep: could not expire a policy", {
        dealId: policy.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { scanned: candidates.length, expired };
}
