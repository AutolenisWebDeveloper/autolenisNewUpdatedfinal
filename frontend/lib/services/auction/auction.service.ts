// lib/services/auction/auction.service.ts
// System 3 — Auction lifecycle management

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { AuctionStatus, NotificationType, OfferStatus, Prisma, VehicleRequestStatus } from "@prisma/client";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { releaseAuctionLoad } from "@/lib/services/auction/dealer-invitation.service";
import { rankOffers, getPersistedRanking } from "@/lib/services/offer/best-price.service";
import { sendDealerAuctionClosedNoWinnerEmail } from "@/lib/services/email/resend.service";
import { qualifiedOfferWhere, lapsedOfferWhere } from "@/lib/services/offer/offer-validity";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_6_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { renderOffersReady, renderAuctionZeroOffers } from "@/lib/services/comms/phase6-email-content";
import { raiseException } from "@/lib/services/operations/queue-item.service";

// Same resolution as the Phase 5 dispatcher callers (`sourcing-driver.service.ts:46`) so a link in
// a close notice and a link in a launch notice cannot point at different hosts.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").replace(/\/+$/, "");

// C1 — an auction may carry the originating VehicleRequest (nullable): the admin
// launch path supplies it; the deposit-activation reconciler has no request in
// scope and omits it. Never pass an unvalidated id here — resolve ownership first
// with resolveOwnedVehicleRequestId so an auction can't link to another buyer's
// request.
export async function createAuction(buyerId: string, depositId: string, vehicleRequestId?: string | null) {
  return prisma.auction.create({
    data: {
      buyerId,
      depositId,
      status: AuctionStatus.PENDING,
      ...(vehicleRequestId ? { vehicleRequestId } : {}),
    },
  });
}

/**
 * §8c / §13-D39 — the ONE permitted relaunch, sharing the original's deposit so no second $99 is
 * charged.
 *
 * A NEW auction row, never a reopen of the original. The ruling rejected reopening, and the schema
 * shows why: `auction_invitations_auction_rooftop_active_key` is
 * `(auction_id, rooftop_id) WHERE status <> 'REPLACED'`, so re-inviting a rooftop under the same
 * auction id would have to mark the first invitation REPLACED — overwriting the record of what was
 * invited when, which is the audit the relaunch exists to preserve.
 *
 * Both writes commit together: a retry row whose original was never stamped would let the next
 * caller relaunch again. `auctions_original_auction_id_key` is the backstop under concurrency, so
 * the loser of a race fails at the database rather than producing a second retry.
 */
export async function createRelaunchAuction(
  buyerId: string,
  depositId: string,
  originalAuctionId: string,
  vehicleRequestId?: string | null,
  now: Date = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const retry = await tx.auction.create({
      data: {
        buyerId,
        depositId,
        originalAuctionId,
        status: AuctionStatus.PENDING,
        ...(vehicleRequestId ? { vehicleRequestId } : {}),
      },
    });
    await tx.auction.update({
      where: { id: originalAuctionId },
      data: { relaunchedAt: now, relaunchCount: { increment: 1 } },
    });
    return retry;
  });
}

// Returns vehicleRequestId only when it belongs to buyerId; otherwise null. The
// ownership scope lives in the query (id + buyerId), so a mistyped or hostile id
// resolves to null rather than cross-linking another buyer's request.
export async function resolveOwnedVehicleRequestId(
  buyerId: string,
  vehicleRequestId?: string | null,
): Promise<string | null> {
  if (!vehicleRequestId) return null;
  const vr = await prisma.vehicleRequest.findFirst({
    where: { id: vehicleRequestId, buyerId },
    select: { id: true },
  });
  return vr?.id ?? null;
}

export async function launchAuction(auctionId: string) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + AUCTION_DURATION_HOURS * 3600000);
  const auction = await prisma.auction.update({
    where: { id: auctionId },
    data: { status: AuctionStatus.ACTIVE, startedAt: now, endsAt },
  });

  // CRM event spine — emit auction_started after the successful activation.
  // Additive tail call: this single service-layer seam covers every activation
  // path (Stripe webhook, admin launch, deposit service) and a failure here can
  // never affect the auction transition, which has already committed.
  try {
    const buyer = await prisma.buyer.findUnique({
      where: { id: auction.buyerId },
      include: { user: { select: { email: true } } },
    });
    if (buyer) {
      const { emitDomainEvent } = await import("@/lib/events/emit");
      await emitDomainEvent("auction_started", {
        domainEntityId: auction.id,
        contact: {
          email: buyer.user?.email ?? null,
          phone: buyer.phone,
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          source: "buyer_signup",
        },
        data: {
          auction_id: auction.id,
          buyer_id: auction.buyerId,
          ends_at: endsAt.toISOString(),
        },
      });
    }
  } catch (err) {
    logger.error("[auction.service] auction_started emit failed:", err);
  }

  return auction;
}

export async function closeAuction(auctionId: string) {
  return prisma.auction.update({
    where: { id: auctionId },
    data: { status: AuctionStatus.CLOSED, closedAt: new Date() },
  });
}

export async function extendAuction(auctionId: string, hours: number, extendedBy: string, reason: string) {
  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction || !auction.endsAt) throw new Error("Auction not found or not active");
  const newEnd = new Date(auction.endsAt.getTime() + hours * 3600000);
  return prisma.auction.update({
    where: { id: auctionId },
    data: { endsAt: newEnd, extendedAt: new Date(), extendedBy, extendReason: reason },
  });
}

// F-001 — a post-close claim is "won" only when exactly one auction row flipped
// from post_close_processed_at NULL → now(). A count of 0 means the auction was
// already processed (or a concurrent run owns it), so this invocation must skip.
// Extracted as a pure function so the idempotency contract is unit-testable.
export function postCloseClaimWon(updatedCount: number): boolean {
  return updatedCount === 1;
}

/**
 * Post-close processing for a single auction: sweep lapsed offers, close candidates that drew
 * nothing, rank, tell the buyer, and open an Operations case when the auction produced nothing.
 *
 * Shared by the auction-close cron and the admin manual-close action so the two paths never
 * diverge. Safe to call more than once — claimed atomically (F-001).
 *
 * ── WHAT PHASE 6 CHANGED, AND WHY EACH ONE WAS A DEFECT ──────────────────────────────────────
 *
 * (a) THE COUNT WAS UNFILTERED. `_count: { select: { offers: true } }` counted every `offers` row
 *     on the auction — DRAFT, WITHDRAWN (every superseded revision leaves one), DECLINED, EXPIRED,
 *     over-ceiling disqualified — and that count decided the BRANCH, the notification title and
 *     the email. An auction whose only offer had been withdrawn told the buyer "1 offer ready" and
 *     linked them to an empty report; the zero-offer case and its Operations ownership never fired.
 *     The count is now the QUALIFIED count (`qualifiedOfferWhere`), which is the same predicate the
 *     report and the selection gate use.
 *
 * (b) ZERO-OFFER IS A PER-AUCTION FACT, NOT A PER-CANDIDATE ONE (§22a, parity row N1). "Offers on
 *     some candidates and none on others is a SUCCESSFUL auction. Only zero valid offers across
 *     every candidate triggers the zero-offer case." Candidates that drew nothing are closed so the
 *     report does not show a buyer a vehicle nobody bid on, but they do not make the auction a
 *     failure.
 *
 * (c) THE BUYER NOTICES WERE SWALLOWED (§8.2 defect 5). Both `notification.create` calls ended in
 *     `.catch(() => {})`, and the buyer email was `.catch(logger.error)` — so the release-on-failure
 *     branch below could never be reached by the one class of failure it exists for, and the claim
 *     stayed stamped with the buyer never told anything. Every notice now rides the §27 dispatcher
 *     (durable, idempotent, with a send-time state recheck) and a failure to ENQUEUE propagates,
 *     which releases the claim and lets the reconciler retry on the next tick.
 *
 * (d) `OFFER_READY` HAD NO WRITER (§8.2 defect 8). The `VehicleRequestStatus` value existed and
 *     five surfaces filtered on it; nothing ever wrote it, so a request whose auction had closed
 *     with offers still read ACTIVE_SOURCING everywhere Operations looks.
 *
 * (e) THE ZERO-OFFER CASE HAD NO OWNER (§26, parity rows C14/E3c/G2). A buyer notification is not
 *     a case: nobody was assigned, no deadline ran, and §13-D39's one relaunch had nothing to hang
 *     off. It is raised through the `queue_items` writer, which dedupes on (code, refs) so the
 *     reconciler cannot open a second row.
 *
 * The in-app `Notification` rows stay alongside the dispatcher rows deliberately: the dispatcher's
 * `in_app` channel is read by no buyer surface in this repository, so dropping the `notifications`
 * write in favour of it would silently remove the bell the buyer actually sees.
 */
export async function processAuctionClose(auctionId: string): Promise<{ offers: number }> {
  const now = new Date();
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { id: true, buyerId: true, depositId: true, vehicleRequestId: true },
  });
  if (!auction) return { offers: 0 };

  // F-001 — atomic claim. Only the invocation that flips post_close_processed_at
  // from NULL wins; concurrent or duplicate invocations (overlapping cron ticks,
  // an admin manual close racing the cron) no-op. This is the idempotency guard
  // that lets the cron safely reprocess any CLOSED-but-unprocessed auction
  // without double-notifying.
  const claim = await prisma.auction.updateMany({
    where: { id: auctionId, postCloseProcessedAt: null },
    data: { postCloseProcessedAt: now },
  });
  if (!postCloseClaimWon(claim.count)) {
    return { offers: await countQualifiedOffers(auctionId, now) };
  }

  try {
    await releaseAuctionLoad(auctionId);

    // §8a — a SUBMITTED offer past its expiration is EXPIRED (parity row A16b). Swept before
    // anything counts, so the count, the ranking, the report and the selection gate all read the
    // same set. Idempotent: a second pass matches nothing.
    await expireLapsedOffers(auctionId, now);

    const qualified = await prisma.offer.findMany({
      where: { auctionId, ...qualifiedOfferWhere(now) },
      select: { id: true, auctionVehicleId: true },
    });

    // (b) §22a / N1 — candidates that drew no qualified offer are closed; the AUCTION is judged on
    // the union. `droppedReason` records why, because `CLOSED` with no reason reads like the
    // buyer-selection close that Stage 9 writes and an operator cannot tell them apart.
    const answered = new Set(qualified.map((o) => o.auctionVehicleId).filter((id): id is string => !!id));

    // UNATTRIBUTABLE IS NOT UNANSWERED, and the guard is load-bearing because of how Prisma
    // compiles the query: `id: { notIn: [] }` becomes `AND 1=1` — it matches EVERYTHING (verified
    // against PostgreSQL 16.13 by reading the generated SQL — `probeEmptyNotIn` in
    // docs/transaction-flow/phase-6-proof/, recorded as §12 of proof-run.log). So an empty
    // `answered` set on a SUCCESSFUL auction would close every candidate and stamp each with "no
    // qualified offer", which is simply false.
    //
    // That is reachable today: a pre-Phase-6 `offers` row carries a NULL `auction_vehicle_id`
    // (the column shipped with no writer), so an auction with candidates whose only qualified
    // offers are legacy rows produces offers > 0 and answered = ∅.
    //
    // Zero qualified offers is the opposite case and must still close them all — nothing was
    // answered, and N1 says so. Hence the two-armed condition rather than a bare `size > 0`.
    // The residual case the guard alone does not cover: SOME offers bound and some not. A
    // pre-Phase-6 row carries a NULL binding (the column had no writer until this phase), so on an
    // auction that spans the deploy the legacy offer's candidate cannot be identified — and
    // closing it with "No qualified offer at auction close" would be false about a candidate that
    // may well have been answered. Unattributable offers therefore suspend the sweep entirely
    // rather than letting the attributable ones close everything else.
    const anyUnattributable = qualified.some((o) => !o.auctionVehicleId);
    if (qualified.length === 0 || (answered.size > 0 && !anyUnattributable)) {
      await prisma.auctionVehicle.updateMany({
        where: { auctionId, candidateStatus: "ACTIVE", id: { notIn: [...answered] } },
        data: { candidateStatus: "CLOSED", droppedReason: "No qualified offer at auction close (§22a)." },
      });
    }

    if (qualified.length > 0) {
      // PERSIST THE RANKING ONCE PER AUCTION, not once per reconciler pass. The release-on-failure
      // branch below makes re-entry a normal outcome, and `bestPriceCalculationLog` has no dedup
      // key, so an unguarded `persistLog` would append a near-identical audit row every five
      // minutes for as long as a downstream write kept failing. An existing ranking is what the
      // buyer report serves (parity row C9), so re-ranking would also silently change the report
      // under a buyer who is reading it.
      const alreadyRanked = await getPersistedRanking(auctionId).catch(() => null);
      await rankOffers(auctionId, 60, { persistLog: !alreadyRanked }).catch((err) =>
        logger.error(`[processAuctionClose] rankOffers failed for ${auctionId}:`, err),
      );

      // (d) §8.2 defect 8 — the close transition is what makes a request OFFER_READY. Conditional
      // on the exact prior statuses so it can never drag a request BACKWARDS from a selection that
      // has already happened (an early accept closes the auction and creates the Deal first), and
      // so a re-run is a no-op.
      if (auction.vehicleRequestId) {
        const advanced = await prisma.vehicleRequest.updateMany({
          where: {
            id: auction.vehicleRequestId,
            status: { in: PRE_OFFER_REQUEST_STATUSES },
          },
          data: { status: "OFFER_READY" },
        });
        // Parity row C12 requires the EVENT as well as the status. The conditional update is the
        // compare-and-swap, so `count` is the honest answer to "did this run advance it?" — and
        // writing the event unconditionally would give a reprocessed auction a second event for a
        // transition that did not happen this time. Non-blocking: the request has already
        // advanced, and losing the timeline row must not release the close claim and redo the
        // notices.
        if (advanced.count > 0) {
          await prisma.vehicleRequestEvent
            .create({
              data: {
                requestId: auction.vehicleRequestId,
                eventType: "OFFER_READY",
                actorRole: "SYSTEM",
                payload: { auctionId, qualifiedOffers: qualified.length },
                note: "Auction closed with at least one qualified offer (§8c exit).",
              },
            })
            .catch((e) => logger.error(`[processAuctionClose] OFFER_READY event row failed for ${auctionId}:`, e));
        }
      }

      await notifyBuyerOnce(auction.buyerId, `/buyer/auction/${auctionId}/offers`, {
        title: `Your auction closed — ${qualified.length} offer${qualified.length !== 1 ? "s" : ""} ready`,
        body: "Review your ranked offers and select your best deal.",
        type: "OFFER_RECEIVED",
      });

      await enqueueCloseNotice(auction, auctionId, qualified.length, now);
    } else {
      // NO AUTO-REFUND. The $99 Auction Access Deposit is not automatically
      // refunded when an auction closes with no qualified offer — it is retained
      // and the platform never initiates a refund on its own at auction close.
      // The deposit remains refundable on request, subject to manual AutoLenis
      // review (§23.1); any refund must be issued deliberately by an admin via the
      // manual refund tools.
      await notifyBuyerOnce(auction.buyerId, `/buyer/auction/${auctionId}`, {
        title: "Auction closed — no offers received",
        body: `Your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit secured your private auction. Since no competitive offer was received, you can request a refund — our team reviews every request. You may also start a new request or request a specific vehicle.`,
        type: "DEAL_STAGE_CHANGED",
      });

      await enqueueCloseNotice(auction, auctionId, 0, now);
      await raiseCloseException(auction, auctionId, now);

      const invitedDealers = await prisma.auctionInvitation
        .findMany({
          where: { auctionId },
          include: { dealer: { include: { user: { select: { email: true } } } } },
        })
        .catch(() => []);
      const vehicleRef = `Auction ${auctionId.slice(0, 8)}`;
      for (const inv of invitedDealers) {
        // An invitation to a non-registered rooftop carries no dealer and no mailbox (S7-18).
        const dealer = inv.dealer;
        if (!dealer) continue;
        const email = dealer.user?.email;
        if (!email) continue;
        await sendDealerAuctionClosedNoWinnerEmail({
          to: email,
          contactName: dealer.dealershipName,
          vehicleRef,
          auctionId,
        }).catch(() => {});
      }
    }

    return { offers: qualified.length };
  } catch (err) {
    // Release the claim so the reconciler retries on the next pass — BUT ONLY THIS RUN'S CLAIM.
    //
    // `where: { id }` alone is a lost update, and the row it loses is the one that matters most.
    // `commitOfferSelection` stamps `postCloseProcessedAt` inside the selection transaction
    // precisely so the reconciler can never re-claim an auction the buyer has already bought on
    // (`select-offer.service.ts`). A buyer selecting between this run's claim and this run's
    // failure would have their stamp overwritten with NULL, the next tick would re-claim, and —
    // because the winner is now ACCEPTED and the losers DECLINED, so nothing is QUALIFIED — the
    // auction would fall into the zero-offer branch: the buyer who has just bought a car gets
    // "Auction closed — no offers received", an Operations case is opened against their Deal, and
    // every invited dealership including the winner is told there was no winner.
    //
    // The compare-and-swap releases only a marker still equal to the one this run wrote.
    await prisma.auction
      .updateMany({
        where: { id: auctionId, postCloseProcessedAt: now },
        data: { postCloseProcessedAt: null },
      })
      .catch(() => {});
    logger.error(
      `[processAuctionClose] side effects failed for ${auctionId} — claim released for retry:`,
      err,
    );
    throw err;
  }
}

/**
 * The request statuses a close may advance to `OFFER_READY`.
 *
 * Everything at or past `OFFER_READY` is already there or further along, and `CANCELLED` /
 * `CLOSED_NO_MATCH` / `EXPIRED` are terminal — reviving one because a stale auction row got
 * reprocessed is the kind of resurrection the reconciler must not perform.
 */
const PRE_OFFER_REQUEST_STATUSES: VehicleRequestStatus[] = [
  VehicleRequestStatus.SUBMITTED,
  VehicleRequestStatus.INTAKE,
  VehicleRequestStatus.ACTIVE_SOURCING,
  VehicleRequestStatus.RADIUS_AUTHORIZATION_REQUIRED,
];

/**
 * §8a / parity row A16b — a SUBMITTED offer past its expiration becomes EXPIRED.
 *
 * `OfferStatus.EXPIRED` shipped with no writer at all, so a lapsed offer stayed SUBMITTED forever
 * and every reader had to remember the expiry check for itself. Sweeping it makes the stored status
 * true, which is what lets the report, the ranking and the selection gate agree.
 *
 * TWO CALLERS, TWO SCOPES, and they catch different things. Scoped to one auction inside
 * `processAuctionClose`, it catches a dealer who stated a SHORTER expiration than the default and
 * whose offer lapsed before the auction even closed. Unscoped from the close cron, it catches the
 * ordinary case: the default window opens at the close and runs 72 hours past it, so nothing in the
 * close pass itself is ever due.
 *
 * Idempotent — a second pass matches nothing.
 */
export async function expireLapsedOffers(
  auctionId: string | null = null,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.offer.updateMany({
    where: { ...(auctionId ? { auctionId } : {}), ...lapsedOfferWhere(now) },
    data: { status: OfferStatus.EXPIRED },
  });
  return res.count;
}

/**
 * One in-app row per auction outcome, however many times the close is reprocessed.
 *
 * The `notifications` table carries no dedup key and no auction reference, so the identity used
 * here is `(buyerId, actionUrl)` — the action URL is auction-scoped by construction and is what the
 * buyer clicks. The guard is a read, not a constraint, which is sufficient for what it defends
 * against: the reconciler retry loop, whose passes are serialised by the atomic claim. It is not a
 * defence against two simultaneous claims, and cannot be — only one of those exists.
 *
 * WHY IT IS NEEDED AT ALL. Under the old code these writes ended in `.catch(() => {})` and nothing
 * after them could throw, so a retry loop did not exist. Now the notices and the exception
 * propagate on purpose, and the cron re-enters every five minutes — which without this would
 * append 288 identical bell rows a day for one buyer while an outbox outage lasted.
 */
async function notifyBuyerOnce(
  buyerId: string,
  actionUrl: string,
  data: { title: string; body: string; type: NotificationType },
): Promise<void> {
  const existing = await prisma.notification.findFirst({
    where: { buyerId, actionUrl },
    select: { id: true },
  });
  if (existing) return;
  await prisma.notification.create({ data: { buyerId, actionUrl, ...data } });
}

/** The qualified count, for callers that did not win the claim and must still report honestly. */
async function countQualifiedOffers(auctionId: string, now: Date): Promise<number> {
  return prisma.offer.count({ where: { auctionId, ...qualifiedOfferWhere(now) } });
}

/**
 * §27.1 "Offers ready" (K27-1326) and "Zero offers" (K27-1327), through the §27 dispatcher.
 *
 * ONE FUNCTION FOR BOTH BRANCHES because they are the same message at the same moment with
 * opposite content, and splitting them is how the two rails drifted in the first place: the
 * success branch had a keyed durable send and the failure branch had a swallowed in-app row.
 *
 * A missing buyer address is NOT swallowed. It used to be the silent case — no address, no email,
 * no trace — and a buyer who paid $99 and is never told their auction closed is precisely the
 * failure the reconciler exists to retry.
 */
async function enqueueCloseNotice(
  auction: { buyerId: string; vehicleRequestId: string | null },
  auctionId: string,
  qualifiedCount: number,
  now: Date,
): Promise<void> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: auction.buyerId },
    select: { firstName: true, user: { select: { email: true } } },
  });
  const email = buyer?.user?.email;
  if (!email) {
    // Reported, not raised: §26 has no row for "buyer has no mailbox", and the buyer still has the
    // in-app notification written above. Throwing would release the claim and retry forever
    // against an address that is not going to appear.
    logger.error(`[processAuctionClose] buyer ${auction.buyerId} has no email — close notice not enqueued`);
    return;
  }

  const templateKey = qualifiedCount > 0 ? PHASE_6_TEMPLATES.OFFERS_READY : PHASE_6_TEMPLATES.AUCTION_ZERO_OFFERS;
  const rendered =
    qualifiedCount > 0
      ? renderOffersReady({
          firstName: buyer?.firstName ?? null,
          validOfferCount: qualifiedCount,
          offersUrl: `${APP_URL}/buyer/auction/${auctionId}/offers`,
        })
      : renderAuctionZeroOffers({
          firstName: buyer?.firstName ?? null,
          depositAmount: DEPOSIT_AMOUNT_USD,
          dashboardUrl: `${APP_URL}/buyer/dashboard`,
        });

  // CHANNEL-QUALIFIED AND AUCTION-SCOPED. `comms_outbox.dedup_key` is globally unique, so the
  // derived default (`templateKey:recipientId`) would collide across a buyer's second auction and
  // silently drop the notice for it. Keyed on the auction, which is what the message is about.
  const key = `${templateKey}:email:${auctionId}`;
  await enqueueTransactional({
    triggerEvent: "auction.closed",
    templateKey,
    channel: "email",
    recipientKind: "buyer",
    recipientId: auction.buyerId,
    to: email,
    auctionId,
    vehicleRequestId: auction.vehicleRequestId,
    idempotencyKey: key,
    runAt: now,
    payload: {
      email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // A BUYER's transactional mail keeps the HARD suppression tier: someone who unsubscribed
      // from marketing still receives their own deal mail (§27).
      type: "transactional",
      idempotencyKey: key,
    },
  });
}

/**
 * §26 — the zero-offer case gets an OWNER, a deadline and a return point (parity rows C14/E3c/G2).
 *
 * `ALL_OFFERS_EXCEED_BUDGET` rather than `ZERO_OFFERS_ALL_CANDIDATES` when dealerships DID compete
 * and every one of them landed over the buyer's ceiling. The two need different work — the first is
 * a coverage problem and the second is a budget conversation — and §26 gives them different
 * required results, so collapsing them onto one code would put the wrong instructions in front of
 * the operator. The distinction is observable: disqualification is recorded on the row (§13-D40).
 */
async function raiseCloseException(
  auction: { buyerId: string; depositId: string | null; vehicleRequestId: string | null },
  auctionId: string,
  now: Date,
): Promise<void> {
  const overBudget = await prisma.offer.count({
    where: {
      auctionId,
      status: OfferStatus.SUBMITTED,
      isDisqualified: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  await raiseException({
    code: overBudget > 0 ? "ALL_OFFERS_EXCEED_BUDGET" : "ZERO_OFFERS_ALL_CANDIDATES",
    auctionId,
    buyerId: auction.buyerId,
    depositId: auction.depositId,
    vehicleRequestId: auction.vehicleRequestId,
    detail:
      overBudget > 0
        ? `${overBudget} offer(s) were submitted and every one was disqualified against the buyer's approved amount`
        : "no dealership submitted a qualified offer on any candidate",
  });
}

// Close all expired auctions — called by auction-close cron
export async function closeExpiredAuctions(): Promise<number> {
  const now = new Date();
  const result = await prisma.auction.updateMany({
    where: { status: AuctionStatus.ACTIVE, endsAt: { lte: now } },
    data: { status: AuctionStatus.CLOSED, closedAt: now },
  });
  return result.count;
}

export async function getActiveAuctions() {
  return prisma.auction.findMany({
    where: { status: AuctionStatus.ACTIVE },
    include: { buyer: true, _count: { select: { offers: true } } },
  });
}

export async function getAuctionWithOffers(auctionId: string) {
  return prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      buyer: { include: { preQualification: true } },
      offers: { include: { dealer: true }, orderBy: { otdPriceCents: "asc" } },
      invitations: { include: { dealer: true } },
    },
  });
}

// Check if auction is holding deposit — for refund eligibility
export async function hasSubmittedOffers(auctionId: string): Promise<boolean> {
  const count = await prisma.offer.count({ where: { auctionId, status: "SUBMITTED" } });
  return count > 0;
}
