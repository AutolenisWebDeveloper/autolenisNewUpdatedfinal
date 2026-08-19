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
import { PickupStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { checkPickupTime } from "./availability.service";
import { generatePickupQr } from "./qr.service";
import { advanceDealStatus } from "../deal/deal.service";
import {
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
export type CoordResult =
  | { ok: true; pickup: Awaited<ReturnType<typeof prisma.pickup.findUnique>> }
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

const QR_TTL_MS = 48 * 60 * 60 * 1000;
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
// from SIGNED (or idempotently from PICKUP_SCHEDULED). Confirming against any
// other deal status would throw inside advanceDealStatus AFTER the pickup CAS
// committed — so we pre-check and reject cleanly instead of stranding state.
const CONFIRMABLE_DEAL_STATUSES: ReadonlySet<string> = new Set(["SIGNED", "PICKUP_SCHEDULED"]);

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
 * Run the post-CAS confirmation side effects (QR + deal advance + buyer notif).
 * These run OUTSIDE the CAS, so `settleConfirmation` wraps this in a compensating
 * transaction: if any side effect throws (e.g. the deal was cancelled between
 * propose and confirm, so advanceDealStatus rejects), the pickup is reverted to
 * its pending state — never left SCHEDULED on a non-advanced deal.
 */
async function runConfirmSideEffects(
  dealId: string,
  scheduledAt: Date,
  actor: Proposer,
  actorId: string | null,
  buyerId: string | null,
) {
  const { data: qrData, image: qrImage } = await generatePickupQr(dealId, "initial");
  await prisma.pickup.update({
    where: { dealId },
    data: { qrCodeData: qrData, qrCodeImage: qrImage, qrExpiresAt: new Date(scheduledAt.getTime() + QR_TTL_MS) },
  });
  // Deal advances only here (confirm/accept). Non-forced: SIGNED→PICKUP_SCHEDULED
  // is legal, and advanceDealStatus is idempotent if already advanced.
  await advanceDealStatus(dealId, "PICKUP_SCHEDULED", {
    actorId: actorId ?? undefined,
    actorRole: actor,
    reason: actor === "DEALER" ? "Dealer confirmed the buyer's proposed pickup" : "Buyer accepted the dealer's proposed pickup",
  });
  // Buyer in-app PICKUP_SCHEDULED notification is caller-owned (advanceDealStatus
  // emits only the SMS for this transition — see acquisition-comms).
  if (buyerId) {
    await prisma.notification
      .create({
        data: {
          buyerId,
          type: "PICKUP_SCHEDULED",
          title: "Pickup confirmed",
          body: "Your vehicle pickup is confirmed. View the details and your pickup QR code.",
          actionUrl: "/buyer/pickup",
        },
      })
      .catch(() => {});
  }
}

/**
 * Confirm/accept won the CAS — now run the side effects with compensation. On
 * failure, atomically revert the pickup from SCHEDULED back to its pending state
 * (restoring the CAS token) so a retry works and no contradictory state remains.
 */
async function settleConfirmation(
  dealId: string,
  scheduledAt: Date,
  actor: Proposer,
  actorId: string | null,
  buyerId: string | null,
  revertStatus: PickupStatus,
  revertProposedAt: Date,
): Promise<{ ok: true } | CoordFail> {
  try {
    await runConfirmSideEffects(dealId, scheduledAt, actor, actorId, buyerId);
    return { ok: true };
  } catch (e) {
    logger.error("[pickup-coord] confirmation side effects failed — compensating:", e);
    await prisma.pickup
      .updateMany({
        where: { dealId, status: PickupStatus.SCHEDULED },
        data: { status: revertStatus, proposedAt: revertProposedAt, scheduledAt: null, qrCodeData: null, qrCodeImage: null, qrExpiresAt: null },
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
  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
  return { ok: true, pickup };
}

/** Dealer confirms the buyer's pending proposal: PROPOSED → SCHEDULED (CAS). */
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

  const scheduledAt = loaded.pickup.proposedTime;
  if (!scheduledAt) return CONFLICT;

  const res = await prisma.pickup.updateMany({
    where: { dealId, status: PickupStatus.PROPOSED, proposedAt: expectedProposedAt },
    data: { status: PickupStatus.SCHEDULED, scheduledAt },
  });
  if (res.count !== 1) return CONFLICT;

  const settled = await settleConfirmation(dealId, scheduledAt, "DEALER", dealerId, loaded.buyerId, PickupStatus.PROPOSED, expectedProposedAt);
  if (!settled.ok) return settled;
  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
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
  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
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

  const scheduledAt = loaded.pickup.proposedTime;
  if (!scheduledAt) return CONFLICT;

  const res = await prisma.pickup.updateMany({
    where: { dealId, status: PickupStatus.DEALER_COUNTERED, proposedAt: expectedProposedAt },
    data: { status: PickupStatus.SCHEDULED, scheduledAt },
  });
  if (res.count !== 1) return CONFLICT;

  const settled = await settleConfirmation(dealId, scheduledAt, "BUYER", buyerId, loaded.buyerId, PickupStatus.DEALER_COUNTERED, expectedProposedAt);
  if (!settled.ok) return settled;
  await notifyDealerConfirmed(dealId).catch((e: unknown) => logger.error("[pickup-coord] notifyDealerConfirmed:", e));
  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
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
  const pickup = await prisma.pickup.findUnique({ where: { dealId } });
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
