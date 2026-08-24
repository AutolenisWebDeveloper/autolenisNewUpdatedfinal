// lib/services/dealer/dealer-auction-eligibility.service.ts — Batch 2
//
// The dealer VERIFICATION gate. FS-C's real harm is an unverified dealer BIDDING
// on a real buyer auction — not a dealer logging in. In the actual lifecycle a
// dealer is made ACTIVE by admin approval BEFORE onboarding (PENDING dealers can't
// sign in), and only then collects a license + signs the agreement. So the gate
// belongs at AUCTION ELIGIBILITY (who may be invited to compete), where it is both
// satisfiable and correctly grandfather-shaped: an existing ACTIVE dealer keeps
// portal access but, once the gate is enforced, is not invited to bid until it has
// a signed agreement and an admin-verified license.
//
// Flag-controlled (FLAGS.DEALER_VERIFICATION_GATE), DEFAULT OFF — with it off,
// auction eligibility is unchanged (status ACTIVE + not placeholder, as before).

import { isEnabled, FLAGS } from "@/lib/services/system/feature-flags.service";
import { getDealerVerificationState, type DealerVerificationState } from "./dealer-verification.service";

export interface DealerAuctionEligibility {
  eligible: boolean;
  reasons: string[];
  state: DealerVerificationState;
}

/** Is the verification gate currently enforced? (DB feature flag, default OFF.) */
export async function isVerificationGateEnforced(): Promise<boolean> {
  return isEnabled(FLAGS.DEALER_VERIFICATION_GATE);
}

/** The full verification criteria for competing in an auction: signed + license-verified. */
export async function getDealerVerificationEligibility(dealerId: string): Promise<DealerAuctionEligibility> {
  const state = await getDealerVerificationState(dealerId);
  const reasons: string[] = [];
  if (!state.hasSignature) reasons.push("agreement_not_signed");
  if (!state.hasVerifiedLicense) reasons.push("license_not_verified");
  return { eligible: reasons.length === 0, reasons, state };
}

/**
 * Given candidate dealer ids, return the subset eligible to be invited to an
 * auction. When the gate is OFF this returns all ids unchanged (no new blocking);
 * when ON it keeps only dealers with a signed agreement AND a verified license.
 */
export async function filterAuctionEligibleDealerIds(dealerIds: string[]): Promise<Set<string>> {
  if (!(await isVerificationGateEnforced())) {
    return new Set(dealerIds);
  }
  const eligible = new Set<string>();
  await Promise.all(
    dealerIds.map(async (id) => {
      const { eligible: ok } = await getDealerVerificationEligibility(id);
      if (ok) eligible.add(id);
    })
  );
  return eligible;
}
