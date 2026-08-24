import 'server-only';
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { createAuction, launchAuction } from "@/lib/services/auction/auction.service";
import { inviteDealersToAuction } from "@/lib/services/auction/dealer-invitation.service";
import {
  getSupabase,
  acquireIdempotencyGuard,
  releaseIdempotencyGuard,
} from "@/lib/jobs/idempotency";
import {
  classifyActivation,
  type ActivationAction,
  type ActivationState,
} from "@/lib/services/auction/deposit-activation-policy";

// Re-export the pure policy so existing importers and tests can reach it.
export { classifyActivation };
export type { ActivationAction, ActivationState };

// W0-A — Deposit-activation reconciler.
//
// F-001 fixed auction *close*. This fixes auction *activation*. The Stripe
// webhook (app/api/webhooks/stripe/route.ts:124-125) launches the auction and
// invites dealers, but swallows the inviteDealersToAuction / launchAuction
// failure (`.catch(log)`). A transient failure there strands a CONFIRMED $99:
//   • no auction row at all (webhook crashed before create), OR
//   • auction PENDING (launch failed → no endsAt → the close cron, which only
//     closes ACTIVE+expired auctions, NEVER closes it → never refunds), OR
//   • auction ACTIVE but zero invitations (invite failed → no dealers can bid).
//
// INVARIANT: a confirmed $99 always converges to a populated ACTIVE auction OR
// a terminal CLOSED auction — never stuck. The $99 deposit is a non-refundable
// access fee and is NEVER auto-refunded. This reconciler sweeps by STATE (not a
// rolling time window, the F-001 anti-pattern it replaces) and re-attempts
// activation. A genuinely no-dealer auction is CLOSED so the merged F-001
// processAuctionClose emits the buyer/dealer no-offer notifications (no refund) —
// reused, not rebuilt. Launching a PENDING auction also sets endsAt, so even a
// market with no dealers self-closes at auction end via F-001.
//
// Idempotency (G5): per-deposit work is serialized with the shared
// idempotency_keys guard (lib/jobs/idempotency.ts), so two overlapping cron
// runs never double-invite (which would double-increment dealer load) or
// double-close. Dealers are (re)invited ONLY when zero invitations exist;
// inviteDealersToAuction upserts invitations by (auctionId, dealerId) but
// increments load unconditionally, so the zero-invitation guard is load-safe.

// Don't touch activations younger than this — let the webhook's own async
// launch/invite finish first.
const ACTIVATION_GRACE_MINUTES = 5;
// If an ACTIVE auction still has zero invitations after this long, no dealers
// are coming — converge to a terminal CLOSED state. The deposit is NOT refunded;
// closing simply emits the no-offer notifications via F-001's processAuctionClose.
const NO_DEALER_CLOSE_GRACE_MINUTES = 120;

interface LoadedState {
  state: ActivationState;
  buyerId: string;
  auctionId: string | null;
}

async function loadState(depositId: string): Promise<LoadedState | null> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: {
      buyerId: true,
      status: true,
      refundedAt: true,
      auction: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          _count: { select: { invitations: true, offers: true } },
        },
      },
    },
  });
  if (!deposit) return null;
  const a = deposit.auction;
  const ageMin = a ? (Date.now() - a.createdAt.getTime()) / 60000 : 0;
  return {
    buyerId: deposit.buyerId,
    auctionId: a?.id ?? null,
    state: {
      depositStatus: deposit.status,
      depositRefunded: !!deposit.refundedAt,
      hasAuction: !!a,
      auctionStatus: a?.status,
      invitationCount: a?._count.invitations ?? 0,
      offerCount: a?._count.offers ?? 0,
      auctionAgeMinutes: ageMin,
      noDealerCloseGraceMinutes: NO_DEALER_CLOSE_GRACE_MINUTES,
    },
  };
}

export type ActivationOutcome =
  | 'locked'        // another run owns this deposit — skipped
  | 'ok'            // already populated
  | 'skip'          // not actionable
  | 'created'       // auction created
  | 'launched'      // auction launched
  | 'invited'       // dealers invited
  | 'awaiting_dealers' // ACTIVE, invite found no eligible dealers yet (will retry / F-001 closes at endsAt)
  | 'closed_no_dealers'; // closed for no dealers (deposit retained — never auto-refunded)

// Converge ONE deposit's activation. Idempotent + serialized via the shared
// idempotency guard; safe to call repeatedly.
export async function reconcileDepositActivation(depositId: string): Promise<ActivationOutcome> {
  const supabase = getSupabase();
  const guardKey = `deposit-activation:${depositId}`;
  const acquired = await acquireIdempotencyGuard(supabase, guardKey).catch(() => false);
  if (!acquired) return 'locked';

  try {
    // Bounded convergence loop: create → launch → invite, re-reading state each
    // step so the terminal decision (ok / invite / refund) is taken on fresh data.
    for (let step = 0; step < 4; step++) {
      const loaded = await loadState(depositId);
      if (!loaded) return 'skip';
      const action = classifyActivation(loaded.state);

      if (action === 'ok') return 'ok';
      if (action === 'skip') return 'skip';

      if (action === 'create_auction') {
        await createAuction(loaded.buyerId, depositId);
        continue;
      }
      if (action === 'launch' && loaded.auctionId) {
        // Guard: only launch if still PENDING (atomic), so a concurrent path
        // can't double-launch / double-emit auction_started.
        const claimed = await prisma.auction.updateMany({
          where: { id: loaded.auctionId, status: 'PENDING' },
          data: { startedAt: new Date() },
        });
        if (claimed.count === 1) {
          await launchAuction(loaded.auctionId);
        }
        continue;
      }
      if (action === 'invite' && loaded.auctionId) {
        const invited = await inviteDealersToAuction(loaded.auctionId, loaded.buyerId);
        logger.info(`[deposit-activation] re-invited ${invited} dealers for auction ${loaded.auctionId} (deposit ${depositId})`);
        // Re-read once more so a 0-result invite past the grace can converge to refund.
        continue;
      }
      if (action === 'close' && loaded.auctionId) {
        // No dealers after the grace — converge to a terminal CLOSED state by
        // closing the ACTIVE auction; F-001's processAuctionClose emits the
        // no-offer notifications. NO refund is issued — the $99 deposit is a
        // non-refundable access fee and is retained. Atomic: only closes if
        // still ACTIVE.
        const closed = await prisma.auction.updateMany({
          where: { id: loaded.auctionId, status: 'ACTIVE' },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
        if (closed.count === 1) {
          logger.warn(`[deposit-activation] no dealers after grace — closed auction ${loaded.auctionId} (deposit ${depositId} retained, no refund)`);
          return 'closed_no_dealers';
        }
        return 'skip';
      }
      // Defensive: unexpected action with missing auctionId — stop.
      break;
    }

    // After the loop, report whether we ended populated or still awaiting dealers.
    const final = await loadState(depositId);
    if (final && final.state.auctionStatus === 'ACTIVE') {
      return final.state.invitationCount > 0 ? 'invited' : 'awaiting_dealers';
    }
    return 'ok';
  } catch (err) {
    logger.error(`[deposit-activation] reconcile failed for deposit ${depositId}:`, err);
    return 'skip';
  } finally {
    // Release so a still-stranded deposit can be retried on the next sweep.
    await releaseIdempotencyGuard(supabase, guardKey).catch(() => {});
  }
}

export interface SweepResult {
  scanned: number;
  outcomes: Record<string, number>;
}

// Sweep all stranded activations by STATE (never a rolling time window): PAID
// deposits with no auction, plus PENDING auctions and ACTIVE auctions with zero
// invitations — older than the activation grace so we don't race the webhook.
export async function reconcileStuckActivations(opts?: {
  graceMinutes?: number;
  limit?: number;
}): Promise<SweepResult> {
  const graceMin = opts?.graceMinutes ?? ACTIVATION_GRACE_MINUTES;
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - graceMin * 60000);

  const [strandedAuctions, depositsNoAuction] = await Promise.all([
    prisma.auction.findMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [
          { status: 'PENDING' },
          { status: 'ACTIVE', invitations: { none: {} }, offers: { none: {} } },
        ],
      },
      select: { depositId: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
    prisma.deposit.findMany({
      where: {
        status: 'PAID',
        refundedAt: null,
        createdAt: { lt: cutoff },
        auction: { is: null },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
  ]);

  const depositIds = Array.from(
    new Set([
      ...strandedAuctions.map((a) => a.depositId),
      ...depositsNoAuction.map((d) => d.id),
    ]),
  );

  const outcomes: Record<string, number> = {};
  for (const depositId of depositIds) {
    const outcome = await reconcileDepositActivation(depositId);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  return { scanned: depositIds.length, outcomes };
}
