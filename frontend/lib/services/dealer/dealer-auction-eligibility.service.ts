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
import { prisma } from "@/lib/prisma";
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

// ---------------------------------------------------------------------------
// Program 3 — the canonical "may this dealer be invited to THIS auction?" decision.
//
// The single source of truth for the ELIGIBILITY question (is this dealer allowed
// to compete?) is getDealerVerificationEligibility, and every invitation path
// consumes it: the bulk paths (automatic launch, deposit-activation reconciler,
// admin batch launch) via filterAuctionEligibleDealerIds, and the admin single
// invite via checkDealerAuctionInvitable below. checkDealerAuctionInvitable is the
// per-(auction, dealer) composition the admin single-invite routes through — it
// adds the auction-state + concierge + placeholder + ACTIVE checks the bulk paths
// already enforce in their own dealer query, so the single-invite can no longer
// bypass what the others require. Geographic proximity, capacity, and make-match
// remain the *automatic selection* algorithm's job (ranking/selection inputs an
// admin deliberately overrides), NOT eligibility gates.
// ---------------------------------------------------------------------------

/** The minimal auction shape the invitability decision needs. */
export interface InvitableAuctionShape {
  status: string;
  startedAt: Date | null;
  endsAt: Date | null;
  postCloseProcessedAt: Date | null;
}

/**
 * A concierge-converted (System-B → canonical) auction is minted already-CLOSED
 * and offline: its post-close marker is stamped at creation and it has a
 * zero-length live window (`endsAt <= startedAt`). A genuine competitive auction
 * always runs AUCTION_DURATION_HOURS (`endsAt = startedAt + 48h`) before it can
 * ever hold an offer, so this predicate never matches one — it is the structural
 * signature that keeps a converted concierge auction out of competitive dealer
 * machinery (invitation / reopen / wave expansion) with no schema discriminator.
 */
export function isConciergeConvertedAuction(auction: InvitableAuctionShape): boolean {
  return (
    auction.postCloseProcessedAt != null &&
    auction.startedAt != null &&
    auction.endsAt != null &&
    auction.endsAt.getTime() <= auction.startedAt.getTime()
  );
}

export interface DealerInvitabilityResult {
  invitable: boolean;
  /** Machine-readable reason when not invitable (for admin errors + audit). */
  reason?: string;
}

/**
 * Canonical per-(auction, dealer) invitation eligibility. Returns invitable:false
 * with a precise reason for any dealer/auction that must not receive a
 * competitive invitation. Reasons: auction_not_found, auction_not_competitive
 * (concierge-converted), auction_not_open (not PENDING/ACTIVE), dealer_not_found,
 * dealer_is_placeholder, dealer_not_active, or a verification reason
 * (agreement_not_signed / license_not_verified) when the gate is enforced.
 */
export async function checkDealerAuctionInvitable(
  auctionId: string,
  dealerId: string,
): Promise<DealerInvitabilityResult> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { status: true, startedAt: true, endsAt: true, postCloseProcessedAt: true },
  });
  if (!auction) return { invitable: false, reason: "auction_not_found" };
  // Structural concierge exclusion — a converted concierge CLOSED auction is not
  // a competitive auction and can never be (re)invited into.
  if (isConciergeConvertedAuction(auction)) return { invitable: false, reason: "auction_not_competitive" };
  // Only an OPEN competitive auction accepts new invitations. A CLOSED / EXPIRED /
  // CANCELLED / REOPENED auction does not — inviting a dealer to bid on one is a bug.
  if (auction.status !== "PENDING" && auction.status !== "ACTIVE") {
    return { invitable: false, reason: "auction_not_open" };
  }

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { status: true, isSystemPlaceholder: true },
  });
  if (!dealer) return { invitable: false, reason: "dealer_not_found" };
  if (dealer.isSystemPlaceholder) return { invitable: false, reason: "dealer_is_placeholder" };
  if (dealer.status !== "ACTIVE") return { invitable: false, reason: "dealer_not_active" };

  // Verification gate — same source of truth (getDealerVerificationEligibility)
  // and same flag (default OFF) as the bulk filterAuctionEligibleDealerIds path.
  if (await isVerificationGateEnforced()) {
    const { eligible, reasons } = await getDealerVerificationEligibility(dealerId);
    if (!eligible) return { invitable: false, reason: reasons[0] ?? "verification_failed" };
  }

  return { invitable: true };
}
