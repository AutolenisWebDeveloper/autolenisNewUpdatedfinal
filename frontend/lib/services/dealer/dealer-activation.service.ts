// lib/services/dealer/dealer-activation.service.ts — Batch 2
//
// The single authority that turns a dealer ACTIVE, and the verification GATE that
// governs it. The gate is flag-controlled (FLAGS.DEALER_ACTIVATION_GATE), DEFAULT
// OFF: with it off nothing new blocks (current behavior preserved); with it on a
// dealer cannot reach ACTIVE without (a) a signed agreement and (b) an
// admin-verified license.
//
// Grandfather: the gate only applies at the PENDING → ACTIVE transition. An
// already-ACTIVE dealer is NEVER re-evaluated or auto-deactivated here.

import { prisma } from "@/lib/prisma";
import { DealerStatus } from "@prisma/client";
import { emitDomainEvent } from "@/lib/events/emit";
import { isEnabled, FLAGS } from "@/lib/services/system/feature-flags.service";
import { getDealerVerificationState, type DealerVerificationState } from "./dealer-verification.service";

export class DealerActivationBlockedError extends Error {
  readonly code = "DEALER_ACTIVATION_BLOCKED";
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`Dealer activation blocked: ${reasons.join(", ")}`);
    this.name = "DealerActivationBlockedError";
    this.reasons = reasons;
  }
}

export interface ActivationEligibility {
  eligible: boolean;
  reasons: string[];
  state: DealerVerificationState;
}

/** Pure read: does the dealer meet the full activation criteria (signature + verified license)? */
export async function getDealerActivationEligibility(dealerId: string): Promise<ActivationEligibility> {
  const state = await getDealerVerificationState(dealerId);
  const reasons: string[] = [];
  if (!state.hasSignature) reasons.push("agreement_not_signed");
  if (!state.hasVerifiedLicense) reasons.push("license_not_verified");
  return { eligible: reasons.length === 0, reasons, state };
}

/** Is the hard activation gate currently enforced? (DB feature flag, default OFF.) */
export async function isActivationGateEnforced(): Promise<boolean> {
  return isEnabled(FLAGS.DEALER_ACTIVATION_GATE);
}

/**
 * Throw if the gate is enforced and the dealer is not eligible. No-op when the gate
 * is off. Used by the admin approve path so an admin cannot approve an unverified
 * dealer while enforcement is on.
 */
export async function assertDealerCanActivate(dealerId: string): Promise<ActivationEligibility> {
  const eligibility = await getDealerActivationEligibility(dealerId);
  if (await isActivationGateEnforced()) {
    if (!eligibility.eligible) throw new DealerActivationBlockedError(eligibility.reasons);
  }
  return eligibility;
}

export interface ActivationActor {
  adminId: string;
  adminEmail: string;
  reason: string;
}

export interface ActivationResult {
  activated: boolean;
  status: DealerStatus;
  gateEnforced: boolean;
  eligibility: ActivationEligibility;
  /** Set when activation was withheld by the enforced gate. */
  blocked?: boolean;
}

/**
 * Transition a PENDING dealer to ACTIVE, subject to the gate. Idempotent and
 * grandfather-safe: a dealer already ACTIVE (or SUSPENDED/TERMINATED) is returned
 * unchanged. When the gate is enforced and the dealer is ineligible, activation is
 * withheld (dealer stays PENDING) and `blocked` is set — the caller surfaces
 * "pending verification" rather than erroring.
 */
export async function activateDealerIfEligible(
  dealerId: string,
  actor: ActivationActor
): Promise<ActivationResult> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { status: true, dealershipName: true, user: { select: { email: true } } },
  });
  if (!dealer) throw new Error(`activateDealerIfEligible: dealer ${dealerId} not found`);

  const eligibility = await getDealerActivationEligibility(dealerId);
  const gateEnforced = await isActivationGateEnforced();

  // Grandfather / idempotency: only ever act on a PENDING dealer.
  if (dealer.status !== DealerStatus.PENDING) {
    return { activated: false, status: dealer.status, gateEnforced, eligibility };
  }

  if (gateEnforced && !eligibility.eligible) {
    return { activated: false, status: DealerStatus.PENDING, gateEnforced, eligibility, blocked: true };
  }

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: DealerStatus.ACTIVE },
    select: { id: true, status: true, dealershipName: true, user: { select: { email: true } } },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: actor.adminId,
      adminEmail: actor.adminEmail,
      action: "DEALER_ACTIVATED",
      entityType: "Dealer",
      entityId: dealerId,
      reason: actor.reason,
      metadata: { gateEnforced, eligibility: { eligible: eligibility.eligible, reasons: eligibility.reasons } },
    },
  }).catch(() => {});

  if (updated.user?.email) {
    await emitDomainEvent("dealer_activated", {
      domainEntityId: updated.id,
      contact: { email: updated.user.email, firstName: updated.dealershipName ?? undefined, source: "dealer_signup" },
      data: { dealer_id: updated.id, dealership_name: updated.dealershipName },
    }).catch(() => {});
  }

  return { activated: true, status: updated.status, gateEnforced, eligibility };
}
