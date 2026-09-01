// Lifecycle producer activation-control router (Program 2).
//
// Every root lifecycle producer (the Stripe deposit webhook, dealer-invitation
// service, dealer/offers route, buyer deposit/onboarding routes, admin
// pickup-complete route, and the request-vehicle / signup / voice intake paths)
// calls `scheduleLifecycleWorkload(...)` instead of `dispatch(...)` directly.
//
// Per workload, exactly ONE authority owns scheduling at any time:
//   • flag OFF (default) → the EXISTING QStash producer: `dispatch({ path, body,
//     delaySeconds })` — byte-for-byte the same call the site made before, so a
//     deploy with all flags OFF is behaviour-neutral.
//   • flag ON  → the internal durable substrate: `enqueueLifecycleTouch(...)`
//     into `lifecycle_touch_schedule` (drained by cron/lifecycle-touch-drain,
//     which re-checks state guards, is UNIQUE(base_key,sequence)-idempotent, and
//     retries with a terminal 'failed').
//
// The two are mutually exclusive per call — never both — so no workload can be
// double-produced. The owner-gated atomic cutover is a single flag flip, which
// simultaneously enables the internal producer and disables the QStash dispatch
// for that workload. This is NOT a new reliability/queue system: it is a thin
// routing switch over the two EXISTING schedulers (QStash + the dormant internal
// drain), which is the per-workload activation control Program 2 §7 mandates.
//
// Contract: fire-and-forget — this function never throws into the caller's
// request/response path (mirrors `dispatch`). On the internal branch it does NOT
// fall back to QStash on error: a missed enqueue is recoverable by a re-enqueue,
// whereas a fallback dispatch after a partial enqueue could double-send.

import { logger } from "@/lib/logger";
import { isEnabled, FLAGS } from "@/lib/services/system/feature-flags.service";
import type { LifecycleSequence } from "@/lib/services/crm/lifecycle-touch-drain.service";

const SECONDS = 1000;

/** Discriminated input — one variant per root workload. `firstName` is passed
 *  through verbatim (callers keep their existing `?? "there"`/`?? "Dealer"`
 *  fallbacks) so both branches render identically. */
export type LifecycleWorkloadInput =
  | { workload: "deposit_reminder"; buyerId: string; firstName: string | null; email: string; phone?: string | null }
  | { workload: "auction_active"; buyerId: string; auctionId: string; firstName: string | null; email: string }
  | {
      workload: "dealer_invited";
      dealerId: string;
      auctionId: string;
      firstName: string | null;
      email: string;
      expiresAt?: string | null;
    }
  | { workload: "offer_received"; buyerId: string; auctionId: string; offerId: string; firstName: string | null; email: string }
  | { workload: "deal_complete"; buyerId: string; dealId: string; firstName: string | null; email: string }
  | {
      workload: "form_submitted";
      buyerId?: string | null;
      firstName: string | null;
      email: string;
      phone?: string | null;
      campaign?: string;
    };

interface WorkloadPlan {
  /** The cutover flag for this workload, or `null` when the internal plane is the
   *  workload's DEFAULT and no flag is consulted at all. `null` exists because a
   *  workload whose QStash target has been removed must not be able to fall back
   *  to it — not on a missing flag row, and not on a flag-read error. */
  flag: string | null;
  sequence: LifecycleSequence;
  /** null → the workload cannot use the internal path (no entity to key on);
   *  it stays on QStash regardless of the flag. */
  entityId: string | null;
  baseKey: string;
  firstName: string | null;
  email: string;
  phone: string | null;
  /** Initial delay before the FIRST touch fires — matches the QStash producer's
   *  `delaySeconds` so cutover keeps the same schedule. */
  initialDelaySeconds: number;
  qstashPath: string;
  qstashBody: Record<string, unknown>;
}

// Map an input to its (flag, internal sequence, baseKey, QStash path/body).
// The QStash body reproduces the site's original `dispatch()` body exactly.
function buildPlan(input: LifecycleWorkloadInput): WorkloadPlan {
  switch (input.workload) {
    case "deposit_reminder":
      return {
        // INTERNAL BY DEFAULT (no flag). QStash has been removed from the stack,
        // so the flag-gated fallback would enqueue into a service that no longer
        // exists: dispatch throws, the error is swallowed into a dead-letter row,
        // and the buyer is never reminded. Delivery must not hinge on a DB row
        // nobody set — a missing, reset or unreadable flag cannot kill the circle.
        flag: null,
        sequence: "deposit_reminder_1",
        entityId: input.buyerId,
        baseKey: `deposit-reminder:${input.buyerId}`,
        firstName: input.firstName,
        email: input.email,
        phone: input.phone ?? null,
        // IMMEDIATE (0) — the owner's cadence is 0/+1h/+6h/+24h/+72h/day-7, and
        // the first touch is a "here's your link back", not a chase, so it leads
        // rather than waits out the former +1h grace. Each touch then chains the
        // next itself; the drain cron (every 15m) is what bounds actual delivery.
        // ROUTING IS UNCHANGED by this edit — `flag: null` above still makes the
        // internal plane the sole owner of this workload.
        initialDelaySeconds: 0,
        qstashPath: "/api/jobs/deposit-reminder",
        qstashBody: { buyerId: input.buyerId, firstName: input.firstName, email: input.email, touchNumber: 1 },
      };
    case "auction_active":
      return {
        flag: FLAGS.LIFECYCLE_INTERNAL_AUCTION,
        sequence: "auction_active",
        entityId: input.buyerId,
        baseKey: `auction:${input.auctionId}`,
        firstName: input.firstName,
        email: input.email,
        phone: null,
        initialDelaySeconds: 0,
        qstashPath: "/api/jobs/auction-active",
        qstashBody: {
          buyerId: input.buyerId,
          firstName: input.firstName,
          email: input.email,
          auctionId: input.auctionId,
        },
      };
    case "dealer_invited":
      return {
        flag: FLAGS.LIFECYCLE_INTERNAL_DEALER_INVITED,
        sequence: "dealer_invited",
        entityId: input.dealerId,
        baseKey: `dealer-invited:${input.auctionId}:${input.dealerId}`,
        firstName: input.firstName,
        email: input.email,
        phone: null,
        initialDelaySeconds: 0,
        qstashPath: "/api/jobs/dealer-invited",
        qstashBody: {
          dealerId: input.dealerId,
          firstName: input.firstName,
          email: input.email,
          auctionId: input.auctionId,
          expiresAt: input.expiresAt ?? null,
        },
      };
    case "offer_received":
      return {
        flag: FLAGS.LIFECYCLE_INTERNAL_OFFER,
        sequence: "offer_received",
        entityId: input.buyerId,
        // Keyed per-auction: one "an offer arrived" enrollment per auction (the
        // follow-ups chain from it), closing the QStash "one send per offer
        // submission" duplication.
        baseKey: `offer-received:${input.auctionId}`,
        firstName: input.firstName,
        email: input.email,
        phone: null,
        initialDelaySeconds: 0,
        qstashPath: "/api/jobs/offer-received",
        qstashBody: {
          buyerId: input.buyerId,
          firstName: input.firstName,
          email: input.email,
          offerId: input.offerId,
        },
      };
    case "deal_complete":
      return {
        flag: FLAGS.LIFECYCLE_INTERNAL_DEAL_COMPLETE,
        sequence: "deal_complete",
        entityId: input.buyerId,
        baseKey: `deal-complete:${input.dealId}`,
        firstName: input.firstName,
        email: input.email,
        phone: null,
        initialDelaySeconds: 0,
        qstashPath: "/api/jobs/deal-complete",
        qstashBody: {
          buyerId: input.buyerId,
          firstName: input.firstName,
          email: input.email,
          dealId: input.dealId,
        },
      };
    case "form_submitted":
      return {
        flag: FLAGS.LIFECYCLE_INTERNAL_FORM_SUBMITTED,
        sequence: "form_submitted",
        // A buyerId is required for the internal path (entity_id NOT NULL and the
        // chained check-form-completion resolves the contact by entity). Voice
        // partial/abandoned leads without a buyerId are intentionally NOT routed
        // here (they keep dispatching to QStash directly) — see the cutover doc.
        entityId: input.buyerId ?? null,
        baseKey: `form-submitted:${input.buyerId ?? ""}`,
        firstName: input.firstName,
        email: input.email,
        phone: input.phone ?? null,
        initialDelaySeconds: 0,
        qstashPath: "/api/jobs/form-submitted",
        qstashBody: {
          buyerId: input.buyerId,
          firstName: input.firstName,
          email: input.email,
          phone: input.phone ?? null,
          campaign: input.campaign,
        },
      };
  }
}

// Read the per-workload activation flag, failing SAFE to the current QStash
// authority — a flag-store hiccup must never silently switch (or dual-run) a
// workload's authority.
async function internalEnabled(flag: string): Promise<boolean> {
  try {
    return await isEnabled(flag);
  } catch (err) {
    logger.error(`[lifecycle-scheduler] flag read failed for '${flag}'; staying on QStash:`, err);
    return false;
  }
}

export async function scheduleLifecycleWorkload(input: LifecycleWorkloadInput): Promise<void> {
  try {
    const plan = buildPlan(input);
    // `flag: null` marks a workload the internal plane owns outright — it is used
    // without consulting (or being able to fail over from) a feature flag.
    const useInternal =
      plan.entityId !== null && (plan.flag === null || (await internalEnabled(plan.flag)));

    if (useInternal) {
      const { enqueueLifecycleTouch } = await import("@/lib/services/crm/lifecycle-touch-drain.service");
      await enqueueLifecycleTouch({
        sequence: plan.sequence,
        entityId: plan.entityId as string,
        firstName: plan.firstName,
        email: plan.email,
        phone: plan.phone,
        baseKey: plan.baseKey,
        runAt: plan.initialDelaySeconds > 0 ? new Date(Date.now() + plan.initialDelaySeconds * SECONDS) : undefined,
      });
      logger.info(`[lifecycle-scheduler] internal enqueue: ${input.workload}`, {
        sequence: plan.sequence,
        baseKey: plan.baseKey,
      });
      return;
    }

    const { dispatch } = await import("@/lib/qstash/dispatch");
    await dispatch({ path: plan.qstashPath, body: plan.qstashBody, delaySeconds: plan.initialDelaySeconds });
  } catch (err) {
    // Never throw into the caller's path. dispatch() self-DLQs; an internal
    // enqueue failure is a recoverable missed touch (a re-enqueue is idempotent),
    // and we deliberately do NOT fall back to QStash after choosing internal.
    logger.error(`[lifecycle-scheduler] '${input.workload}' scheduling failed:`, err);
  }
}
