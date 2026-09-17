// lib/services/pickup/pickup-coordination.service.ts
// D2a — the dealer/buyer pickup confirm/propose round-trip.
//
// Flow (strict turns): buyer proposes → PROPOSED (deal stays SIGNED). The dealer
// confirms (→ SCHEDULED, deal advances) or counters (→ DEALER_COUNTERED). The
// buyer then accepts (→ SCHEDULED, deal advances) or counters back (→ PROPOSED).
// The deal reaches PICKUP_SCHEDULED ONLY on confirm/accept — never on a proposal.
//
// Concurrency: every mutating transition is an atomic compare-and-swap
// (`updateMany` guarded on the current status AND the exact `proposedAt` the
// actor observed — the anti-snipe idiom). A caller that lost the race matches 0
// rows and returns CONFLICT with NO side effects, so two concurrent/duplicate
// transitions can never both win. The status guard lives entirely in the CAS
// `where` (no redundant pre-read check), so a stale action is a clean CONFLICT.
//
// Counter cap: after MAX_PICKUP_COUNTERS turn-flips the next counter escalates to
// EXCEPTION for an admin to resolve (via the existing admin schedule route).

import { prisma } from "@/lib/prisma";
import { enterPickupReadiness } from "@/lib/services/pickup/pickup-readiness.service";
import { PickupStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { checkPickupTime } from "./availability.service";
import { PICKUP_SAFE_SELECT, type SafePickup } from "./pickup-select";
import { advanceDealStatus } from "../deal/deal.service";
import {
  createNotificationOnce,
  notifyDealerProposed,
  notifyBuyerCountered,
  notifyDealerConfirmed,
  notifyPickupEscalated,
} from "./pickup-notifications.service";

export const MAX_PICKUP_COUNTERS = 2;
export const PICKUP_CONFIRM_SLA_HOURS = 24; // dealer to confirm a buyer proposal
export const PICKUP_ACCEPT_SLA_HOURS = 24; // buyer to accept a dealer counter

export type Proposer = "BUYER" | "DEALER";
export type CoordCode = "NOT_FOUND" | "STATE" | "CONFLICT" | "AVAILABILITY" | "CAP";
export type CoordFail = { ok: false; code: CoordCode; reason: string };
// `pickup` is the PROJECTED row, not `prisma.pickup.findUnique`'s payload. Six routes return
// this straight to a browser (`successResponse({ pickup: result.pickup })` in the buyer
// schedule/reschedule/accept/counter and the dealer propose/confirm routes), and the raw model
// now carries `token_hash` — see `pickup-select.ts` for why that must not travel.
export type CoordResult =
  | { ok: true; pickup: SafePickup | null }
  | CoordFail;

/** Map a coordination failure code to an HTTP (errorCode, status) pair. */
export function coordHttp(code: CoordCode): { errorCode: string; status: number } {
  switch (code) {
    case "NOT_FOUND": return { errorCode: "NOT_FOUND", status: 404 };
    case "AVAILABILITY": return { errorCode: "VALIDATION_ERROR", status: 400 };
    case "STATE": return { errorCode: "INVALID_STATE", status: 409 };
    case "CONFLICT": return { errorCode: "CONFLICT", status: 409 };
    case "CAP": return { errorCode: "COUNTER_CAP", status: 409 };
  }
}

const CONFLICT: CoordResult = {
  ok: false,
  code: "CONFLICT",
  reason: "This pickup was just updated. Please refresh and try again.",
};

type LoadedDeal = {
  buyerId: string | null;
  dealerId: string | null;
  dealStatus: string;
  pickup: {
    id: string;
    status: PickupStatus;
    proposedTime: Date | null;
    proposedAt: Date | null;
    counterCount: number;
  } | null;
};

// A confirm/accept advances the deal to PICKUP_SCHEDULED, which is legal only
// from FUNDING_PENDING (or idempotently from PICKUP_SCHEDULED). Confirming against any
// other deal status would throw inside advanceDealStatus AFTER the pickup CAS
// committed — so we pre-check and reject cleanly instead of stranding state.
//
// FUNDING_PENDING, not SIGNED. §13-D29 and §Stage 14 moved the rung a pickup may be confirmed
// from: the buyer's signature is no longer the last gate, the six-item funding clearance is.
// PICKUP_SCHEDULED stays in the set so a re-confirm of an already-scheduled pickup is still
// idempotent rather than a state error.
const CONFIRMABLE_DEAL_STATUSES: ReadonlySet<string> = new Set(["FUNDING_PENDING", "PICKUP_SCHEDULED"]);

async function loadDeal(dealId: string): Promise<LoadedDeal | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      status: true,
      offer: { select: { dealerId: true } },
      pickup: {
        select: { id: true, status: true, proposedTime: true, proposedAt: true, counterCount: true },
      },
    },
  });
  if (!deal) return null;
  return {
    buyerId: deal.buyerId,
    dealerId: deal.offer?.dealerId ?? null,
    dealStatus: deal.status,
    pickup: deal.pickup,
  };
}

/**
 * Run the post-CAS confirmation side effects (deal advance + buyer notif).
 * These run OUTSIDE the CAS, so `settleConfirmation` wraps this in a compensating
 * transaction: if any side effect throws (e.g. the deal was cancelled between
 * propose and confirm, so advanceDealStatus rejects), the pickup is reverted to
 * its pending state — never left SCHEDULED on a non-advanced deal.
 *
 * `scheduledAt` is gone from the signature: it existed only to date the QR expiry this no
 * longer writes, and a parameter kept "in case" is a parameter the next reader has to prove
 * unused. The agreed time is already on the row, put there by the CAS.
 */
async function runConfirmSideEffects(
  dealId: string,
  actor: Proposer,
  actorId: string | null,
  buyerId: string | null,
  /**
   * The `proposedAt` the confirming actor observed — the round token, passed in rather than
   * re-read. A second `findUnique` here would also have been an AD-HOC select, which
   * `pickup-select`'s guard refuses on principle: every read of this row in this service goes
   * through PICKUP_SAFE_SELECT. The value is already in the caller's hand.
   */
  roundAt: Date,
) {
  // NO CREDENTIAL IS MINTED HERE. This block used to generate a QR payload and store it, plus
  // its rendered PNG, on the pickup row — which is the plaintext-at-rest defect Phase 9 exists
  // to close. A release token is only useful to whoever holds the RAW value, and a confirmation
  // has nobody to hand it to: the buyer reveals theirs from the pickup page, which mints at that
  // moment. Minting here would spend a token nobody ever sees and immediately retire it again on
  // the first reveal.
  // Deal advances only here (confirm/accept). Non-forced: PICKUP_READINESS→PICKUP_SCHEDULED
  // is legal, and advanceDealStatus is idempotent if already advanced.
  await advanceDealStatus(dealId, "PICKUP_SCHEDULED", {
    actorId: actorId ?? undefined,
    actorRole: actor,
    reason: actor === "DEALER" ? "Dealer confirmed the buyer's proposed pickup" : "Buyer accepted the dealer's proposed pickup",
  });
  // Buyer in-app PICKUP_SCHEDULED notification is caller-owned (advanceDealStatus
  // emits only the SMS for this transition — see acquisition-comms).
  if (buyerId) {
    // §8.2 defect (6), second half. This was a bare create with no key, so a retried
    // confirmation — the compensating path re-running after a transient failure — left the buyer
    // with the same notice twice. Keyed per ROUND, like the five emails beside it: a second
    // proposal round after a missed pickup is a new confirmation and SHOULD notify again.
    await createNotificationOnce({
      buyerId,
      type: "PICKUP_SCHEDULED",
      title: "Pickup confirmed",
      body: "Your vehicle pickup is confirmed. Open the pickup page to see the details and show your pickup code when you arrive.",
      actionUrl: "/buyer/pickup",
      idempotencyKey: `pickup-confirmed:${dealId}:${roundAt.toISOString()}`,
    });
  }
}

/**
 * Confirm/accept won the CAS — now run the side effects with compensation. On
 * failure, atomically revert the pickup from SCHEDULED back to its pending state
 * (restoring the CAS token) so a retry works and no contradictory state remains.
 */
async function settleConfirmation(
  dealId: string,
  actor: Proposer,
  actorId: string | null,
  buyerId: string | null,
  revertStatus: PickupStatus,
  revertProposedAt: Date,
): Promise<{ ok: true } | CoordFail> {
  try {
    await runConfirmSideEffects(dealId, actor, actorId, buyerId, revertProposedAt);
    return { ok: true };
  } catch (e) {
    logger.error("[pickup-coord] confirmation side effects failed — compensating:", e);
    await prisma.pickup
      .updateMany({
        where: { dealId, status: PickupStatus.SCHEDULED },
        // The token fields are deliberately untouched. A live token is not made safe by
        // deleting the row's memory of it — it is made safe by the status this revert restores:
        // `resolveReleaseToken` re-checks the pickup's OWN state and refuses anything outside
        // SCHEDULED / RESCHEDULED / CHECKED_IN, so a token minted before this revert resolves as
        // `pickup_not_releasable` from the moment the row goes back to PROPOSED. Stamping
        // `token_revoked_at` here would instead record a revocation on pickups that never had a
        // token, which is a different lie.
        data: { status: revertStatus, proposedAt: revertProposedAt, scheduledAt: null },
      })
      .catch(() => {});
    return { ok: false, code: "STATE", reason: "We couldn't confirm the pickup right now. Please try again." };
  }
}

/**
 * Buyer's INITIAL proposal (from no pickup / NOT_SCHEDULED). The route enforces
 * the eSign + SIGNED prerequisites; here we gate availability and set PROPOSED.
 * Re-proposals after a dealer counter go through `counterAsBuyer`.
 */
export async function proposePickup(
  dealId: string,
  buyerId: string,
  when: Date,
  location: string | null,
  opts: { now?: Date } = {},
): Promise<CoordResult> {
  const loaded = await loadDeal(dealId);
  if (!loaded) return { ok: false, code: "NOT_FOUND", reason: "Deal not found." };
  if (loaded.buyerId !== buyerId) return { ok: false, code: "NOT_FOUND", reason: "Deal not found." };
  if (loaded.pickup && loaded.pickup.status !== PickupStatus.NOT_SCHEDULED) {
    return { ok: false, code: "STATE", reason: "A pickup proposal already exists for this deal." };
  }

  const within = await checkPickupTime(loaded.dealerId, when, opts.now ?? new Date());
  if (!within.ok) return { ok: false, code: "AVAILABILITY", reason: within.reason };

  const now = opts.now ?? new Date();
  await prisma.pickup.upsert({
    where: { dealId },
    create: {
      dealId,
      status: PickupStatus.PROPOSED,
      proposedTime: when,
      proposedBy: "BUYER",
      proposedAt: now,
      counterCount: 0,
      ...(location ? { location } : {}),
    },
    update: {
      status: PickupStatus.PROPOSED,
      proposedTime: when,
      proposedBy: "BUYER",
      proposedAt: now,
      counterCount: 0,
      proposedReminderSentAt: null,
      counterReminderSentAt: null,
      ...(location ? { location } : {}),
    },
  });

  await notifyDealerProposed(dealId).catch((e: unknown) => logger.error("[pickup-coord] notifyDealerProposed:", e));
  const pickup = await prisma.pickup.findUnique({ where: { dealId }, select: PICKUP_SAFE_SELECT });
  return { ok: true, pickup };
}

/** Dealer confirms the buyer's pending proposal: PROPOSED → SCHEDULED (CAS). */

/**
 * §Stage 16's exit condition, enforced where scheduling actually begins.
 *
 * "All items true; Deal moves to scheduling" … "Nothing is scheduled while any item is unmet."
 *
 * IT RUNS BEFORE THE PICKUP COMPARE-AND-SWAP, not after. Placed in the confirmation side effects
 * it would refuse a deal whose pickup row had already been moved to SCHEDULED — and, worse, its
 * return value is discarded there, so the refusal never reached the caller at all. Nothing may
 * move until the thirteen hold.
 */
async function readinessGate(
  dealId: string,
  actorId: string | null,
  actorRole: string,
): Promise<CoordResult | null> {
  const readiness = await enterPickupReadiness(dealId, { actorId, actorRole });
  if (readiness.schedulable) return null;
  const first = readiness.evaluation.outstanding[0];
  return {
    ok: false,
    code: "STATE",
    reason: first
      ? `Pickup cannot be scheduled yet: ${first.detail}`
      : "This deal is not ready for pickup scheduling yet.",
  };
}

export async function confirmPickup(
  dealId: string,
  dealerId: string,
  expectedProposedAt: Date,
): Promise<CoordResult> {
  const loaded = await loadDeal(dealId);
  if (!loaded?.pickup) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  if (loaded.dealerId !== dealerId) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  if (!CONFIRMABLE_DEAL_STATUSES.has(loaded.dealStatus)) {
    return { ok: false, code: "STATE", reason: "This deal is no longer ready for pickup scheduling." };
  }
  const blocked = await readinessGate(dealId, dealerId, "DEALER");
  if (blocked) return blocked;

  const scheduledAt = loaded.pickup.proposedTime;
  if (!scheduledAt) return CONFLICT;

  const res = await prisma.pickup.updateMany({
    where: { dealId, status: PickupStatus.PROPOSED, proposedAt: expectedProposedAt },
    data: {
      status: PickupStatus.SCHEDULED,
      scheduledAt,
      // THE APPOINTMENT CHANGED, SO WHAT WAS SENT ABOUT THE OLD ONE NO LONGER APPLIES. Same
      // reasoning as the token revocation: §Stage 17's 24h and 2h reminders are stamped per
      // appointment, and leaving the markers set means the NEW time gets no reminders at all —
      // silently, because a reminder that is never sent looks exactly like one that was not due.
      reminder24hSentAt: null,
      reminder2hSentAt: null,
    },
  });
  if (res.count !== 1) return CONFLICT;

  const settled = await settleConfirmation(dealId, "DEALER", dealerId, loaded.buyerId, PickupStatus.PROPOSED, expectedProposedAt);
  if (!settled.ok) return settled;
  const pickup = await prisma.pickup.findUnique({ where: { dealId }, select: PICKUP_SAFE_SELECT });
  return { ok: true, pickup };
}

/** Dealer counters with an alternative: PROPOSED → DEALER_COUNTERED (CAS + cap). */
export async function counterAsDealer(
  dealId: string,
  dealerId: string,
  when: Date,
  expectedProposedAt: Date,
  opts: { now?: Date } = {},
): Promise<CoordResult> {
  const loaded = await loadDeal(dealId);
  if (!loaded?.pickup) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  if (loaded.dealerId !== dealerId) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };

  // Cap check first — at the cap we escalate regardless of the proposed time
  // (and skip the availability round-trip).
  if (loaded.pickup.counterCount >= MAX_PICKUP_COUNTERS) {
    return escalate(dealId, PickupStatus.PROPOSED, expectedProposedAt);
  }

  const within = await checkPickupTime(dealerId, when, opts.now ?? new Date());
  if (!within.ok) return { ok: false, code: "AVAILABILITY", reason: within.reason };

  const now = opts.now ?? new Date();
  const res = await prisma.pickup.updateMany({
    where: { dealId, status: PickupStatus.PROPOSED, proposedAt: expectedProposedAt },
    data: {
      status: PickupStatus.DEALER_COUNTERED,
      proposedTime: when,
      proposedBy: "DEALER",
      proposedAt: now,
      counterCount: { increment: 1 },
      counterReminderSentAt: null,
    },
  });
  if (res.count !== 1) return CONFLICT;

  await notifyBuyerCountered(dealId).catch((e: unknown) => logger.error("[pickup-coord] notifyBuyerCountered:", e));
  const pickup = await prisma.pickup.findUnique({ where: { dealId }, select: PICKUP_SAFE_SELECT });
  return { ok: true, pickup };
}

/** Buyer accepts the dealer's counter: DEALER_COUNTERED → SCHEDULED (CAS). */
export async function acceptCounter(
  dealId: string,
  buyerId: string,
  expectedProposedAt: Date,
): Promise<CoordResult> {
  const loaded = await loadDeal(dealId);
  if (!loaded?.pickup) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  if (loaded.buyerId !== buyerId) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  if (!CONFIRMABLE_DEAL_STATUSES.has(loaded.dealStatus)) {
    return { ok: false, code: "STATE", reason: "This deal is no longer ready for pickup scheduling." };
  }
  const blocked = await readinessGate(dealId, buyerId, "BUYER");
  if (blocked) return blocked;

  const scheduledAt = loaded.pickup.proposedTime;
  if (!scheduledAt) return CONFLICT;

  const res = await prisma.pickup.updateMany({
    where: { dealId, status: PickupStatus.DEALER_COUNTERED, proposedAt: expectedProposedAt },
    data: {
      status: PickupStatus.SCHEDULED,
      scheduledAt,
      // THE APPOINTMENT CHANGED, SO WHAT WAS SENT ABOUT THE OLD ONE NO LONGER APPLIES. Same
      // reasoning as the token revocation: §Stage 17's 24h and 2h reminders are stamped per
      // appointment, and leaving the markers set means the NEW time gets no reminders at all —
      // silently, because a reminder that is never sent looks exactly like one that was not due.
      reminder24hSentAt: null,
      reminder2hSentAt: null,
    },
  });
  if (res.count !== 1) return CONFLICT;

  const settled = await settleConfirmation(dealId, "BUYER", buyerId, loaded.buyerId, PickupStatus.DEALER_COUNTERED, expectedProposedAt);
  if (!settled.ok) return settled;
  await notifyDealerConfirmed(dealId).catch((e: unknown) => logger.error("[pickup-coord] notifyDealerConfirmed:", e));
  const pickup = await prisma.pickup.findUnique({ where: { dealId }, select: PICKUP_SAFE_SELECT });
  return { ok: true, pickup };
}

/** Buyer counters the dealer's counter: DEALER_COUNTERED → PROPOSED (CAS + cap). */
export async function counterAsBuyer(
  dealId: string,
  buyerId: string,
  when: Date,
  expectedProposedAt: Date,
  opts: { now?: Date } = {},
): Promise<CoordResult> {
  const loaded = await loadDeal(dealId);
  if (!loaded?.pickup) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  if (loaded.buyerId !== buyerId) return { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };

  if (loaded.pickup.counterCount >= MAX_PICKUP_COUNTERS) {
    return escalate(dealId, PickupStatus.DEALER_COUNTERED, expectedProposedAt);
  }

  const within = await checkPickupTime(loaded.dealerId, when, opts.now ?? new Date());
  if (!within.ok) return { ok: false, code: "AVAILABILITY", reason: within.reason };

  const now = opts.now ?? new Date();
  const res = await prisma.pickup.updateMany({
    where: { dealId, status: PickupStatus.DEALER_COUNTERED, proposedAt: expectedProposedAt },
    data: {
      status: PickupStatus.PROPOSED,
      proposedTime: when,
      proposedBy: "BUYER",
      proposedAt: now,
      counterCount: { increment: 1 },
      proposedReminderSentAt: null,
    },
  });
  if (res.count !== 1) return CONFLICT;

  await notifyDealerProposed(dealId).catch((e: unknown) => logger.error("[pickup-coord] notifyDealerProposed:", e));
  const pickup = await prisma.pickup.findUnique({ where: { dealId }, select: PICKUP_SAFE_SELECT });
  return { ok: true, pickup };
}

/** Cap reached — atomically move the pending pickup to EXCEPTION for admin. */
async function escalate(
  dealId: string,
  fromStatus: PickupStatus,
  expectedProposedAt: Date,
): Promise<CoordResult> {
  const res = await prisma.pickup.updateMany({
    where: { dealId, status: fromStatus, proposedAt: expectedProposedAt },
    data: { status: PickupStatus.EXCEPTION },
  });
  if (res.count !== 1) return CONFLICT;
  await notifyPickupEscalated(dealId).catch((e: unknown) => logger.error("[pickup-coord] notifyPickupEscalated:", e));
  return {
    ok: false,
    code: "CAP",
    reason: "You've reached the maximum number of counter-proposals. AutoLenis will help finalize your pickup time.",
  };
}
