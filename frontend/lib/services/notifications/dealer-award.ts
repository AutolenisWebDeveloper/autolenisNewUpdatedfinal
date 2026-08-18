// lib/services/notifications/dealer-award.ts
// G1 — dealer award / non-award notifications on offer acceptance.
//
// When a buyer selects a winning offer, every dealer that competed in the
// auction is told the outcome: the winner receives an award notification with a
// buyer-safe handoff, and each other bidder receives a non-award close-out.
//
// This module is split into a PURE planner and an IMPURE dispatcher:
//   • `planDealerAwardOutcomes` decides WHO gets WHAT — fully deterministic and
//     unit-tested (no DB, no network). It is the single place the award rules,
//     ranking, idempotency keys, and the no-PII boundary live.
//   • `emitDealerAwardOutcomes` loads the auction/offers, runs the planner, and
//     performs the sends via the existing transactional email rail
//     (`resend.service` — idempotent via EmailSendLog) plus in-app Notification
//     rows. It runs inside the durable `dealerAwardFn` Inngest worker, so it is
//     built to be RE-RUN: every channel is idempotent, and it therefore
//     PROPAGATES transient failures (load-phase DB error, any recipient dispatch
//     failure) so the worker retries and ultimately dead-letters instead of
//     silently marking the dispatch complete and blocking re-drive. Only a
//     terminal missing-auction returns quietly (retrying can't help).
//
// Scope note: this covers the reverse-auction acceptance path only. The
// concierge / vehicle-request track (`VehicleRequestOffer`) carries no dealer
// identity in the schema, so there are no competing dealers to notify there.
//
// PII boundary (autolenis-dealer-marketplace): a dealer may learn only the
// buyer's first name + last initial, and only after winning. No buyer email,
// phone, exact budget, or another dealer's identity ever appears here.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NotificationType } from "@prisma/client";
import {
  sendDealerOfferWonEmail,
  sendDealerOfferLostEmail,
} from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";

export type DealerAwardKind = "WON" | "LOST";

/** A dealer that submitted an offer in the auction. */
export interface DealerAwardBidder {
  offerId: string;
  /** Real Dealer id, or the system "Outside Dealer" placeholder id. */
  dealerId: string;
  /** True when `dealerId` is the system placeholder (outside/unregistered dealer). */
  isSystemPlaceholder: boolean;
  /** Resolved recipient address (external contact preferred for placeholders). */
  email: string | null;
  dealershipName: string;
  otdPriceCents: number;
}

export interface DealerAwardNotification {
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string;
}

export interface DealerAwardOutcome {
  offerId: string;
  kind: DealerAwardKind;
  /** 1-based rank by OTD price ascending (1 = lowest / most competitive). */
  position: number;
  totalOffers: number;
  // ── Email channel (null when no deliverable address) ────────────────────────
  email: string | null;
  emailKey: string;
  dealershipName: string;
  vehicleRef: string;
  /** Buyer handoff — populated for WON only; empty strings for LOST. */
  buyerFirstName: string;
  buyerLastInitial: string;
  /** WON → dealer deal page; LOST → dealer opportunities. */
  dealUrl: string;
  // ── In-app channel (null for placeholder dealers — they have no account) ─────
  inAppDealerId: string | null;
  notification: DealerAwardNotification;
  /** Stable key for in-app idempotency (stored in Notification.metadata.key). */
  dedupeKey: string;
}

export interface PlanDealerAwardInput {
  bidders: DealerAwardBidder[];
  /** The accepted offer. `null` => decline / no winner => nobody is notified. */
  winningOfferId: string | null;
  /** The created deal. `null` => no deal => nobody is notified. */
  dealId: string | null;
  auctionId: string;
  vehicleRef: string;
  buyerFirstName: string;
  buyerLastInitial: string;
  appUrl: string;
}

/**
 * Pure decision core: given the bidders and the accepted offer, return exactly
 * one outcome per notifiable dealer (one WON for the winner, one LOST for each
 * other bidder). Returns [] on a decline / no-winner / no-deal, so nobody is
 * notified. A bidder with neither a deliverable email nor a dealer account is
 * dropped (nothing to send).
 */
export function planDealerAwardOutcomes(input: PlanDealerAwardInput): DealerAwardOutcome[] {
  const { winningOfferId, dealId, auctionId, vehicleRef, appUrl } = input;

  // No acceptance → no award notifications.
  if (!winningOfferId || !dealId) return [];

  const ranked = [...input.bidders].sort((a, b) => a.otdPriceCents - b.otdPriceCents);
  const totalOffers = ranked.length;

  const outcomes: DealerAwardOutcome[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const b = ranked[i]!;
    const email = b.email?.trim() ? b.email.trim() : null;
    const inAppDealerId = b.isSystemPlaceholder ? null : b.dealerId;
    // Nothing to send on either channel → drop the bidder.
    if (!email && !inAppDealerId) continue;

    const isWinner = b.offerId === winningOfferId;
    const position = i + 1;

    if (isWinner) {
      outcomes.push({
        offerId: b.offerId,
        kind: "WON",
        position,
        totalOffers,
        email,
        emailKey: `dealer-offer-won-${dealId}`,
        dealershipName: b.dealershipName,
        vehicleRef,
        buyerFirstName: input.buyerFirstName,
        buyerLastInitial: input.buyerLastInitial,
        dealUrl: `${appUrl}/dealer/deals/${dealId}`,
        inAppDealerId,
        notification: {
          type: NotificationType.DEAL_SELECTED,
          title: "Your offer was selected",
          body:
            `Congratulations — you won ${vehicleRef}. ` +
            `${input.buyerFirstName} ${input.buyerLastInitial}. is ready to move forward. ` +
            `Open the deal to review the buyer-safe handoff and next steps.`,
          actionUrl: `/dealer/deals/${dealId}`,
        },
        dedupeKey: `dealer-award:${dealId}:won:${b.offerId}`,
      });
    } else {
      outcomes.push({
        offerId: b.offerId,
        kind: "LOST",
        position,
        totalOffers,
        email,
        emailKey: `dealer-offer-lost-${auctionId}-${email ?? ""}`,
        dealershipName: b.dealershipName,
        vehicleRef,
        buyerFirstName: "",
        buyerLastInitial: "",
        dealUrl: `${appUrl}/dealer/opportunities`,
        inAppDealerId,
        notification: {
          type: NotificationType.OFFER_DECLINED,
          title: "Auction closed — your offer wasn't selected",
          body:
            `The buyer selected another offer for ${vehicleRef}. ` +
            `Thank you for competing — fresh opportunities are waiting for you.`,
          actionUrl: `/dealer/opportunities`,
        },
        dedupeKey: `dealer-award:${auctionId}:lost:${b.offerId}`,
      });
    }
  }

  return outcomes;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

/**
 * Impure dispatcher: notify the winning + non-winning dealers for a just-accepted
 * auction offer. Idempotent (email via EmailSendLog keys; in-app rows deduped on
 * a stable metadata key), so it is safe to re-run. It runs inside the durable
 * `dealerAwardFn` worker and PROPAGATES transient failures — a load-phase DB
 * error, or any recipient dispatch failure — so the worker retries and
 * dead-letters rather than losing the notifications silently. Every recipient is
 * attempted before a batch failure is raised, so one bad address never starves
 * the rest on a given run. A terminal missing-auction returns quietly.
 */
export async function emitDealerAwardOutcomes(args: {
  auctionId: string;
  winningOfferId: string;
  dealId: string;
}): Promise<void> {
  const { auctionId, winningOfferId, dealId } = args;

  // ── Load / plan phase — failures PROPAGATE so the worker retries. ───────────
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { buyerId: true },
  });
  if (!auction) {
    // Terminal, not transient: retrying a ghost auction id can never succeed, so
    // return quietly instead of spinning the worker's retries to dead-letter.
    logger.error(`[dealer-award] auction ${auctionId} not found`);
    return;
  }

  const [buyer, offers] = await Promise.all([
    prisma.buyer.findUnique({
      where: { id: auction.buyerId },
      select: { firstName: true, lastName: true },
    }),
    prisma.offer.findMany({
      // Only dealers who actually bid: the ACCEPTED winner plus every other
      // SUBMITTED offer. DRAFT / WITHDRAWN / EXPIRED offers are not "bids" and
      // must not receive a non-award close-out.
      where: { auctionId, status: { in: ["SUBMITTED", "ACCEPTED"] } },
      select: {
        id: true,
        dealerId: true,
        otdPriceCents: true,
        externalDealerName: true,
        externalDealerEmail: true,
        dealer: {
          select: {
            isSystemPlaceholder: true,
            dealershipName: true,
            user: { select: { email: true } },
          },
        },
      },
    }),
  ]);

  const buyerFirstName = buyer?.firstName ?? "Buyer";
  const buyerLastInitial = (buyer?.lastName ?? "").charAt(0) || "";

  const bidders: DealerAwardBidder[] = offers.map((o) => ({
    offerId: o.id,
    dealerId: o.dealerId,
    isSystemPlaceholder: o.dealer?.isSystemPlaceholder ?? false,
    email: o.externalDealerEmail ?? o.dealer?.user?.email ?? null,
    dealershipName: o.externalDealerName ?? o.dealer?.dealershipName ?? "Dealer",
    otdPriceCents: o.otdPriceCents,
  }));

  const outcomes = planDealerAwardOutcomes({
    bidders,
    winningOfferId,
    dealId,
    auctionId,
    vehicleRef: `Auction ${auctionId.slice(0, 8)}`,
    buyerFirstName,
    buyerLastInitial,
    appUrl: APP_URL,
  });

  // ── Dispatch phase — attempt EVERY recipient, collect failures, then raise a
  // single batch error if any failed. Because every channel is idempotent, the
  // worker's retry re-runs the whole batch and the already-delivered recipients
  // are skipped (EmailSendLog SENT-precheck + in-app dedupe key). ──────────────
  const errors: unknown[] = [];
  for (const o of outcomes) {
    try {
      // Email channel — existing idempotent transactional wrappers.
      if (o.email) {
        if (o.kind === "WON") {
          await sendDealerOfferWonEmail({
            to: o.email,
            contactName: o.dealershipName,
            vehicleRef: o.vehicleRef,
            buyerFirstName: o.buyerFirstName,
            buyerLastInitial: o.buyerLastInitial,
            dealUrl: o.dealUrl,
            dealId,
          });
          // GHL tag sync is non-critical CRM bookkeeping — never let it fail the
          // award batch or trigger a retry of the (already-sent) email.
          try {
            syncGhlTag(o.email, "dealer-won");
          } catch (ghlErr) {
            logger.error("[dealer-award] ghl tag sync failed:", ghlErr);
          }
        } else {
          await sendDealerOfferLostEmail({
            to: o.email,
            contactName: o.dealershipName,
            vehicleRef: o.vehicleRef,
            yourPosition: o.position,
            totalOffers: o.totalOffers,
            insightsUrl: o.dealUrl,
            auctionId,
          });
        }
      }

      // In-app channel — registered dealers only; deduped on a stable key so a
      // retried dispatch cannot create a second row for the same outcome.
      if (o.inAppDealerId) {
        const existing = await prisma.notification.findFirst({
          where: {
            dealerId: o.inAppDealerId,
            metadata: { path: ["key"], equals: o.dedupeKey },
          },
          select: { id: true },
        });
        if (!existing) {
          await prisma.notification.create({
            data: {
              dealerId: o.inAppDealerId,
              type: o.notification.type,
              title: o.notification.title,
              body: o.notification.body,
              actionUrl: o.notification.actionUrl,
              metadata: {
                key: o.dedupeKey,
                offerId: o.offerId,
                dealId,
                auctionId,
                kind: o.kind,
              },
            },
          });
        }
      }
    } catch (err) {
      // Isolate this recipient's failure so the rest of the batch still goes out
      // on this run; the collected error forces a whole-batch retry afterwards.
      logger.error(`[dealer-award] outcome dispatch failed for offer ${o.offerId}:`, err);
      errors.push(err);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[dealer-award] ${errors.length}/${outcomes.length} dispatch(es) failed for deal ${dealId} — worker will retry`,
    );
  }
}
