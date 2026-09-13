// lib/services/offer/offer.service.ts
// System 4 — Offer submission, validation, revision
// Max 1 revision per offer (MAX_OFFER_REVISIONS from constants)

import { logger } from "@/lib/logger";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { OfferStatus, Prisma } from "@prisma/client";
import { MAX_OFFER_REVISIONS } from "@/lib/constants";
import { writeDealerAudit } from "@/lib/services/audit/dealer-audit.service";
import { maybeExtendForAntiSnipe } from "@/lib/services/auction/anti-snipe.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { sendFirstOfferReceivedEmail } from "@/lib/services/email/buyer-notifications.service";
// OTD component arithmetic lives in a dependency-free module so the concierge
// conversion path validates prices with the exact same assertion. Re-exported
// here to keep offer.service's public surface unchanged for existing importers.
import { assertOtdComponentsMatch } from "./otd";
import { classifyFeeItems } from "./junk-fee.service";
import { recheckApproval } from "@/lib/services/prequal/approval-recheck";
export { assertOtdComponentsMatch };

const APR_SUSPICIOUS_THRESHOLD = 29.0;

/** §8b: "capped at three offers per rooftop". */
const MAX_LIVE_OFFERS_PER_ROOFTOP = 3;

function assertFinancingConsistent(input: {
  includesFinancing?: boolean;
  aprRate?: number;
  termMonths?: number;
}) {
  if (!input.includesFinancing) return;
  if (input.aprRate == null || input.termMonths == null) {
    throw new Error("Financing offers require both aprRate and termMonths");
  }
  if (input.aprRate < 0 || input.aprRate > 50) {
    throw new Error("APR must be between 0% and 50%");
  }
  if (input.termMonths < 6 || input.termMonths > 96) {
    throw new Error("Term must be between 6 and 96 months");
  }
}

/** §13-D40: an offer that cannot be qualified is RECORDED and flagged, never thrown away. */
export type BudgetVerdict =
  | { disqualified: false; approvedAmountCents: number }
  | { disqualified: true; reason: string };

/**
 * §8b — "compliance with the buyer's approved budget ... current, unexpired, and sufficient."
 *
 * WHAT THIS REPLACED (§8.2 Phase 6 defect 7). `assertWithinBuyerBudget` had TWO fail-open early
 * returns — no auction row and no prequal row each returned silently — and it selected `decision`
 * and `expiresAt` without ever reading them. A buyer whose approval was DECLINED, or had expired
 * months earlier, still authorised any price at or under a stale ceiling; a buyer with no
 * prequalification at all authorised ANY price. "Fails open" understates it: the two fields that
 * would have caught it were fetched and discarded.
 *
 * It now delegates to `recheckApproval`, the Phase 2 helper that owns the predicate — extended
 * with the two offer gates rather than forked, so submit, revise, selection and the payment gate
 * all produce the same §26 exception with the same owner and the same return point.
 *
 * IT NO LONGER THROWS ON AN OVER-CEILING OFFER, and that is §13-D40 ruled 2026-09-13: record and
 * disqualify. Rejecting at submit throws away a dealer's work over an arithmetic slip and leaves
 * Operations nothing to act on. The §22a ceiling still binds — a disqualified offer is excluded
 * from the ranked report and refused at selection — so nothing is loosened by recording it.
 *
 * The same treatment covers an unusable APPROVAL, and for a stronger reason: that is not the
 * dealer's mistake at all, and refusing their submission would punish them for the buyer's
 * paused prequalification.
 */
async function evaluateBuyerBudget(
  auctionId: string,
  otdPriceCents: number,
  gate: "offer_submit" | "offer_revision",
): Promise<BudgetVerdict> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { buyerId: true, vehicleRequestId: true },
  });
  // NOT a silent return. The callers verified the auction inside their transaction, so its
  // absence here is a broken invariant rather than a policy outcome, and swallowing it is what
  // let the old version authorise any price for an auction that did not exist.
  if (!auction) throw new Error("Auction not found while checking the buyer's approved budget");

  const approval = await recheckApproval(auction.buyerId, gate, {
    raiseOnFailure: true,
    vehicleRequestId: auction.vehicleRequestId ?? null,
  });
  if (!approval.ok) {
    return { disqualified: true, reason: approval.message };
  }

  // A valid approval with NO ceiling fails the item — offer validation needs the number, and
  // treating a null ceiling as "unlimited" is the same fail-open in a different disguise.
  if (approval.approvedAmountCents == null) {
    return {
      disqualified: true,
      reason: "This buyer's approval carries no approved amount, so the offer cannot be qualified.",
    };
  }

  if (otdPriceCents > approval.approvedAmountCents) {
    return {
      disqualified: true,
      reason:
        `Out-the-door exceeds the buyer's approved amount of ` +
        `$${(approval.approvedAmountCents / 100).toLocaleString()}.`,
    };
  }

  return { disqualified: false, approvedAmountCents: approval.approvedAmountCents };
}

export interface OfferInput {
  auctionId: string;
  dealerId: string;
  otdPriceCents: number;
  vehiclePriceCents: number;
  taxCents: number;
  feesCents: number;
  /**
   * Itemised fees. Accepts `{name, amount}` (dollars, legacy), `{label, amount}` (the admin
   * route's shape) or `{name, amountCents}` (canonical). `submitOffer` normalises to integer
   * cents and stamps server-side `isJunk` before persisting — see `junk-fee-items.ts`.
   */
  junkFeeItems?: unknown;
  includesFinancing?: boolean;
  aprRate?: number;
  termMonths?: number;
  /**
   * §8c — "Every offer binds to the candidate it answers, OR to the criteria set on a custom
   * request." Nullable for the custom-request case (parity row C3b), which is exactly why the
   * conditional matters: requiring it unconditionally would refuse every offer against a custom
   * request, the path §22a routes buyers to when qualified results are thin.
   */
  auctionVehicleId?: string | null;
  /** §8a — the rooftop that made the offer. Phase 1 shipped the column; nothing wrote it. */
  rooftopId?: string | null;
  /** §8a — "Offer expiration", a REQUIRED field. Defaults to the auction's own deadline. */
  expiresAt?: Date | null;

  // ── STAFF INTAKE (§8.2 Phase 6 defect 2) ──────────────────────────────────────────────────
  //
  // `POST /api/admin/offers` accepted PENDING auctions, never checked `endsAt`, persisted
  // `aprRate` without computing `aprFlag`, persisted `includesFinancing` without terms, and wrote
  // straight to `prisma.offer.create` without ever importing `assertOtdComponentsMatch`. It is now
  // routed through this function, which required three things the dealer path does not have.

  /** Set when an administrator entered this offer on a dealership's behalf. Audited by the route. */
  submittedByAdminId?: string | null;
  /** An OUTSIDE dealership's identity: it has no account and no rooftop. */
  externalDealerName?: string | null;
  externalDealerEmail?: string | null;
  externalDealerPhone?: string | null;
  /**
   * STAFF INTAKE ONLY. The dealer path requires an `AuctionInvitation` — §7's proof that this
   * rooftop was invited. An administrator entering an offer that arrived by phone or email has no
   * such row, and an outside dealership has no account to hold one.
   *
   * This is a deliberate, narrow hole and it is NOT a general bypass: the route sets it, the
   * caller is authenticated as an admin, and every use is written to `AdminAuditLog` with a
   * mandatory reason. Every OTHER validation — arithmetic, financing consistency, the approval
   * recheck, the caps, the candidate binding, auction ACTIVE and unexpired — applies unchanged,
   * which is the whole point of routing the path through here.
   */
  allowWithoutInvitation?: boolean;
}

export async function submitOffer(input: OfferInput) {
  const now = new Date();

  // Server-side OTD arithmetic — components must sum to total OTD.
  assertOtdComponentsMatch(input);
  // Financing offer internal consistency.
  assertFinancingConsistent(input);
  // OTD must not exceed buyer's approved budget.
  // §13-D40: the verdict is RECORDED on the offer, not thrown. Computed before the transaction so
  // a disqualified offer still commits in one write with its reason attached.
  const budget = await evaluateBuyerBudget(input.auctionId, input.otdPriceCents, "offer_submit");

  // APR flag computed once for both the insert and any post-create updates.
  const aprFlag = input.aprRate && input.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  // §8b's junk-fee evaluation, which had no caller until this phase. Server-side and before the
  // transaction, so the admin's `JunkFeePattern` rows bind rather than the dealer UI's hardcoded
  // keyword list — which was discarded before persistence anyway. Classification changes no
  // arithmetic: `assertOtdComponentsMatch` above already reconciled every itemised fee, junk or
  // not, so a reclassification moves an item between ranking dimensions and never between totals.
  const classifiedFeeItems = await classifyFeeItems(input.junkFeeItems);

  // Wrap invitation lookup, auction validation, duplicate check, and offer
  // create into one Serializable transaction so two concurrent submissions
  // from the same dealer cannot both observe "no existing SUBMITTED offer"
  // and each insert a row.
  const offer = await prisma.$transaction(async (tx) => {
    const invitation = await tx.auctionInvitation.findFirst({
      where: { auctionId: input.auctionId, dealerId: input.dealerId },
    });
    if (!invitation && !input.allowWithoutInvitation) {
      throw new Error("Dealer not invited to this auction");
    }

    const auction = await tx.auction.findUnique({ where: { id: input.auctionId } });
    if (!auction || auction.status !== "ACTIVE") throw new Error("Auction is not active");
    if (auction.endsAt && auction.endsAt < now) throw new Error("Auction has expired");

    // ── §8c CANDIDATE BINDING (defect 10) ────────────────────────────────────────────────────
    //
    // "Every offer binds to the candidate it answers, OR to the criteria set on a custom request."
    // `offers.auction_vehicle_id` shipped in the Phase 1 wave with NO WRITER, which had a second
    // consequence nobody recorded: `offers_one_live_per_rooftop_candidate_key` is a partial unique
    // on `(auction_id, rooftop_id, auction_vehicle_id) WHERE status = 'SUBMITTED'`, and PostgreSQL
    // treats NULLs as distinct — so with all three columns unwritten the index was INERT. Writing
    // the binding is what makes §8b's cap enforceable at the database rather than only in code.
    const candidates = await tx.auctionVehicle.findMany({
      where: { auctionId: input.auctionId, candidateStatus: "ACTIVE" },
      select: { id: true },
    });
    if (candidates.length > 0) {
      if (!input.auctionVehicleId) {
        throw new Error("This auction has specific vehicles — your offer must name the one it answers.");
      }
      if (!candidates.some((c) => c.id === input.auctionVehicleId)) {
        throw new Error("That vehicle is not an active candidate on this auction.");
      }
    }
    // No candidates: a CUSTOM REQUEST, where §8c binds the offer to the criteria set instead. The
    // binding stays null rather than being invented, per parity row C3b.
    const auctionVehicleId = candidates.length > 0 ? input.auctionVehicleId ?? null : null;

    // The rooftop is the invitation's, not the caller's: §7 issues one invitation per rooftop, so
    // that row is the authority on which rooftop this dealer is bidding for. Taking it from the
    // request body would let a dealer spend another rooftop's offer budget.
    const rooftopId = input.rooftopId ?? invitation?.rooftopId ?? null;

    // ── §8b's TWO CAPS ───────────────────────────────────────────────────────────────────────
    //
    // "One live offer per rooftop per candidate, capped at three offers per rooftop."
    //
    // The old guard was ONE SUBMITTED offer per (auction, dealer) — a different and stricter rule
    // that also broke the outside-dealer path, where every outside offer is written against a
    // single shared placeholder dealer id (`lib/services/offer/outside-dealer.ts`). Two outside
    // dealerships bidding on one auction is the normal case for an outside-invite auction, and the
    // second was told "You have already submitted an offer for this auction."
    //
    // Keyed on the ROOFTOP where one is known, falling back to the dealer otherwise so an auction
    // with no rooftop data keeps its old protection rather than losing it.
    // THE IDENTITY A CAP IS KEYED ON, in order of how well it identifies a dealership:
    //
    //   rooftopId             §7 issues one invitation per rooftop, so this is the real subject.
    //   externalDealerEmail   An OUTSIDE dealership has no rooftop and no account. Every outside
    //                         offer is written against ONE shared placeholder dealer id
    //                         (`outside-dealer.ts`), so keying on `dealerId` would make the second
    //                         outside dealership on an auction collide with the first — which is
    //                         the normal case for an outside-invite auction, and exactly why the
    //                         admin path could not simply be routed through here before.
    //   dealerId              A registered dealer with no rooftop on file. Preserves the old
    //                         protection rather than dropping it.
    const liveScope = rooftopId
      ? { auctionId: input.auctionId, rooftopId, status: OfferStatus.SUBMITTED }
      : input.externalDealerEmail
        ? {
            auctionId: input.auctionId,
            externalDealerEmail: input.externalDealerEmail,
            status: OfferStatus.SUBMITTED,
          }
        : { auctionId: input.auctionId, dealerId: input.dealerId, status: OfferStatus.SUBMITTED };

    const liveForScope = await tx.offer.findMany({
      where: liveScope,
      select: { id: true, auctionVehicleId: true },
    });

    if (liveForScope.some((o) => o.auctionVehicleId === auctionVehicleId)) {
      throw new Error(
        "You already have a live offer for this vehicle on this auction. Use the revise endpoint to update it.",
      );
    }
    if (liveForScope.length >= MAX_LIVE_OFFERS_PER_ROOFTOP) {
      throw new Error(
        `A dealership may hold at most ${MAX_LIVE_OFFERS_PER_ROOFTOP} live offers on one auction (§8b).`,
      );
    }

    const created = await tx.offer.create({
      data: {
        auctionId: input.auctionId,
        dealerId: input.dealerId,
        otdPriceCents: input.otdPriceCents,
        vehiclePriceCents: input.vehiclePriceCents,
        taxCents: input.taxCents,
        feesCents: input.feesCents,
        junkFeeItems: classifiedFeeItems as unknown as Prisma.InputJsonValue,
        includesFinancing: input.includesFinancing ?? false,
        aprRate: input.aprRate,
        termMonths: input.termMonths,
        aprFlag,
        status: OfferStatus.SUBMITTED,
        version: 1,
        submittedAt: new Date(),
        isDisqualified: budget.disqualified,
        disqualifiedReason: budget.disqualified ? budget.reason : null,
        auctionVehicleId,
        rooftopId,
        submittedByAdminId: input.submittedByAdminId ?? null,
        externalDealerName: input.externalDealerName ?? null,
        externalDealerEmail: input.externalDealerEmail ?? null,
        externalDealerPhone: input.externalDealerPhone ?? null,
        // §8a makes the expiration a required field. Defaulting to the auction's own deadline is
        // the honest floor: an offer cannot outlive the window it was made in, and a dealer who
        // states a shorter one is taken at their word.
        expiresAt: input.expiresAt ?? auction.endsAt ?? null,
      },
    });

    if (invitation) await tx.auctionInvitation.update({
      where: { id: invitation.id },
      // BOTH, and `offerSubmittedAt` is the one that was missing. Found by review on #422.
      // Four Phase 5 gates read `offerSubmittedAt` and NOTHING on this path wrote it, so every
      // one of them was dead: `skipIfInvitationNoLongerSendable` (the §27 send-time recheck that
      // stops a reminder reaching a dealer who already bid), `alreadyBid` on the tokenised
      // invitation page, the resume-link gate, and the decline route. A dealer who submitted an
      // offer therefore still got the 24h and 72h reminders, and the token page offered to take
      // an offer it would then reject as a duplicate.
      //
      // `respondedAt` is not a substitute: a decline is also a response, so the gates cannot
      // read it without treating a declining dealer as one who bid. Same family as
      // `reflectInvitationDeliveryEvent` having had no caller — a field built and never written.
      data: { respondedAt: new Date(), offerSubmittedAt: new Date() },
    });

    return created;
  }, { isolationLevel: "Serializable" });

  // Re-fetch auction for the post-create notification (outside the txn).
  const auction = await prisma.auction.findUnique({ where: { id: input.auctionId } });
  if (!auction) return offer;

  // Notify buyer of new offer (count update only — no amount/identity)
  const offerCount = await prisma.offer.count({ where: { auctionId: input.auctionId, status: "SUBMITTED" } });
  await prisma.notification.create({
    data: {
      buyerId: auction.buyerId,
      title: "New offer received",
      body: `You now have ${offerCount} offer${offerCount !== 1 ? "s" : ""} in your auction.`,
      type: "OFFER_RECEIVED",
    },
  }).catch((err) => logger.error("[offer.service] buyer new-offer notification failed:", err));

  // First-offer buyer email — fires once, when the offer count goes 0 → 1 for
  // this auction. Non-blocking via after() so a notification failure never
  // affects the dealer's submission. PRIVACY: the email never reveals which
  // dealer submitted, the amount, or any dealer contact info — it only drives
  // the buyer back into the platform.
  if (offerCount === 1) {
    after(async () => {
      try {
        const [buyer, deposit, vehicle] = await Promise.all([
          prisma.buyer.findUnique({
            where: { id: auction.buyerId },
            select: { firstName: true, user: { select: { email: true } } },
          }),
          prisma.deposit.findUnique({
            where: { id: auction.depositId },
            select: { status: true },
          }),
          prisma.auctionVehicle.findFirst({
            where: { auctionId: auction.id },
            select: { make: true, model: true },
          }),
        ]);

        const buyerEmail = buyer?.user?.email;
        if (!buyerEmail) return;

        const appUrl = (
          process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com"
        ).trim();

        await sendFirstOfferReceivedEmail({
          buyerEmail,
          buyerFirstName: buyer?.firstName ?? "there",
          vehicleMake: vehicle?.make ?? "",
          vehicleModel: vehicle?.model ?? "",
          hasDeposit: deposit?.status === "PAID",
          depositUrl: `${appUrl}/buyer/deposit`,
          offersUrl: `${appUrl}/buyer/offers`,
        });
      } catch (err) {
        logger.error("[first-offer-notification] failed:", err);
      }
    });
  }

  // Sync to GHL — fire-and-forget. Buyer email isn't loaded above, so resolve
  // it with a lightweight lookup before tagging.
  const buyerForGhl = await prisma.buyer
    .findUnique({
      where: { id: auction.buyerId },
      include: { user: { select: { email: true } } },
    })
    .catch(() => null);
  syncGhlTag(buyerForGhl?.user?.email, "offer-received");

  await writeDealerAudit({
    action: "DEALER_OFFER_SUBMITTED",
    dealerId: input.dealerId,
    entityType: "Offer",
    entityId: offer.id,
    metadata: {
      auctionId: input.auctionId,
      otdPriceCents: input.otdPriceCents,
      includesFinancing: input.includesFinancing ?? false,
    },
  });

  // CRM event spine — emit offer_received for the linked buyer after the offer
  // has been committed. Additive tail call: a failure never affects the
  // dealer's submission. PRIVACY: no dealer identity/amount on the contact.
  try {
    if (buyerForGhl) {
      const { emitDomainEvent } = await import("@/lib/events/emit");
      await emitDomainEvent("offer_received", {
        domainEntityId: offer.id,
        contact: {
          email: buyerForGhl.user?.email ?? null,
          phone: buyerForGhl.phone,
          firstName: buyerForGhl.firstName,
          lastName: buyerForGhl.lastName,
          source: "buyer_signup",
        },
        data: {
          offer_id: offer.id,
          auction_id: input.auctionId,
          buyer_id: auction.buyerId,
          offer_count: offerCount,
        },
      });
    }
  } catch (err) {
    logger.error("[offer.service] offer_received emit failed:", err);
  }

  // Y6 — a bid in the final window pushes the deadline out (best-effort; an
  // extension failure must never fail the submission).
  await maybeExtendForAntiSnipe(input.auctionId).catch((err) =>
    logger.warn("[offer.service] anti-snipe extend failed:", err),
  );

  return offer;
}

export async function reviseOffer(offerId: string, dealerId: string, input: Partial<OfferInput>) {
  const original = await prisma.offer.findFirst({ where: { id: offerId, dealerId, status: "SUBMITTED" } });
  if (!original) throw new Error("Offer not found or not revisionable");
  if (original.version >= MAX_OFFER_REVISIONS + 1) throw new Error("Max revisions reached");

  // Validate auction still active and not past deadline.
  const auction = await prisma.auction.findUnique({ where: { id: original.auctionId } });
  if (!auction || auction.status !== "ACTIVE") throw new Error("Auction closed");
  if (auction.endsAt && auction.endsAt < new Date()) {
    throw new Error("Auction has expired — revisions are no longer accepted");
  }

  // Merge input over original for full validation.
  const merged = {
    otdPriceCents: input.otdPriceCents ?? original.otdPriceCents,
    vehiclePriceCents: input.vehiclePriceCents ?? original.vehiclePriceCents,
    taxCents: input.taxCents ?? original.taxCents,
    feesCents: input.feesCents ?? original.feesCents,
    junkFeeItems: input.junkFeeItems ?? original.junkFeeItems ?? [],
    includesFinancing: input.includesFinancing ?? original.includesFinancing,
    aprRate: input.aprRate ?? original.aprRate ?? undefined,
    termMonths: input.termMonths ?? original.termMonths ?? undefined,
  };
  assertOtdComponentsMatch(merged);
  assertFinancingConsistent(merged);
  const budget = await evaluateBuyerBudget(original.auctionId, merged.otdPriceCents, "offer_revision");

  const aprFlag = merged.aprRate && merged.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  // §8b's classification on the revision too. A dealer who revises must not be able to launder a
  // junk fee past the ranking by resubmitting it, and a revision that carries the ORIGINAL's items
  // forward re-classifies them — so a pattern the admin added between the two submissions binds on
  // the version the buyer is actually shown.
  const classifiedFeeItems = await classifyFeeItems(merged.junkFeeItems);
  const revised = await prisma.$transaction(async (tx) => {
    const stillOriginal = await tx.offer.findFirst({
      where: { id: offerId, dealerId, status: OfferStatus.SUBMITTED },
    });
    if (!stillOriginal) throw new Error("Offer was modified concurrently");

    const created = await tx.offer.create({
      data: {
        auctionId: original.auctionId,
        dealerId,
        otdPriceCents: merged.otdPriceCents,
        vehiclePriceCents: merged.vehiclePriceCents,
        taxCents: merged.taxCents,
        feesCents: merged.feesCents,
        junkFeeItems: classifiedFeeItems as unknown as Prisma.InputJsonValue,
        includesFinancing: merged.includesFinancing,
        aprRate: merged.aprRate,
        termMonths: merged.termMonths,
        aprFlag,
        status: OfferStatus.SUBMITTED,
        version: original.version + 1,
        originalOfferId: offerId,
        submittedAt: new Date(),
        // A revision is re-qualified from scratch: the ceiling may have moved, or the approval may
        // have lapsed, between the two submissions. Carrying the original's flag forward would let
        // a stale verdict decide whether the buyer can pick this version.
        isDisqualified: budget.disqualified,
        disqualifiedReason: budget.disqualified ? budget.reason : null,
      },
    });

    await tx.offer.update({ where: { id: offerId }, data: { status: OfferStatus.WITHDRAWN } });
    return created;
  }, { isolationLevel: "Serializable" });

  await writeDealerAudit({
    action: "DEALER_OFFER_REVISED",
    dealerId,
    entityType: "Offer",
    entityId: revised.id,
    metadata: {
      auctionId: original.auctionId,
      originalOfferId: offerId,
      previousOtdPriceCents: original.otdPriceCents,
      newOtdPriceCents: merged.otdPriceCents,
      version: revised.version,
    },
  });

  // Y6 — a last-minute REVISION (e.g. undercutting) is also a snipe; extend too.
  await maybeExtendForAntiSnipe(original.auctionId).catch((err) =>
    logger.warn("[offer.service] anti-snipe extend failed:", err),
  );

  return revised;
}

export async function getOffersForAuction(auctionId: string) {
  return prisma.offer.findMany({
    where: { auctionId, status: OfferStatus.SUBMITTED },
    include: { dealer: { select: { id: true, dealershipName: true, tier: true } } },
    orderBy: { otdPriceCents: "asc" },
  });
}
