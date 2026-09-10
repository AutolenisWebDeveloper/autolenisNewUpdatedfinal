// lib/services/plan/plan-change.service.ts
//
// §23.2 "On settlement" and §23.3 — the two directions a plan moves after the $99, and
// the ownership that moves with it.
//
//   UPGRADE SETTLES  assign the named concierge, move ownership from the Operations
//                    pool to that person on `vehicle_requests.assigned_admin_id`,
//                    append a snapshot with its effective time, the acting party and the
//                    touchpoint. (PAY-62)
//   DOWNGRADE        before the $400 settles this is ONLY a change of election: the plan
//                    reverts to Standard, which is already paid in full, the concierge
//                    assignment is released, ownership returns to the pool, and the
//                    transaction is untouched. After it settles, it is a refund REQUEST
//                    and follows §22.1's manual review — never an automatic refund.
//                    (PAY-79, PAY-80, PAY-81, PAY-82)
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO, each because §23.3 says so:
//
//   • It never refunds. "The $99 is never refunded on a downgrade", and the $400 after
//     settlement is Finance's decision on the record of service delivered. This raises
//     the review; it does not decide it.
//   • It never cancels the transaction and never releases the vehicle hold. A downgrade
//     is about who coordinates, not about whether the deal proceeds.
//   • It never touches the deposit. Standard is retained and the buyer keeps every
//     platform capability.
//
// WHAT WAS THERE BEFORE. One admin route that set `buyers.plan = "STANDARD"` and nulled
// `planUpgradedAt`. It wrote an `AdminAuditLog` row and stopped: no plan snapshot (so
// the history the table exists to hold had a hole exactly where a post-settlement
// review would need it), no concierge release, no ownership move, and no word to the
// buyer about which services stop and which do not. There is no buyer-facing downgrade
// path at all.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import {
  recordRequestPlanElection,
  entitledPlanForRequest,
} from "@/lib/services/buyer/plan-snapshot.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";

type Db = typeof prisma | Prisma.TransactionClient;

export interface AssignConciergeInput {
  vehicleRequestId: string;
  buyerId: string;
  /** The admin who becomes this transaction's named owner. */
  adminId: string;
  /** Who made the assignment — an admin id, or "system" for the same-day auto-assign. */
  actor: string;
}

/**
 * Move ownership of a request to a named concierge (§23.2 "On settlement", PAY-62).
 *
 * `vehicle_requests.assigned_admin_id` is the ownership column the platform already
 * has, and PAY-92/PAY-78 turn on it: "Every paid request has a named owner — the
 * assigned concierge for Premium, the Operations pool for Standard." Null IS the pool,
 * which is why release below writes null rather than a sentinel.
 *
 * Idempotent and race-safe: the write is scoped so re-assigning the same admin changes
 * nothing and reports `changed: false`.
 */
export async function assignConcierge(
  input: AssignConciergeInput,
  db: Db = prisma,
): Promise<{ changed: boolean }> {
  const { count } = await db.vehicleRequest.updateMany({
    where: { id: input.vehicleRequestId, assignedAdminId: { not: input.adminId } },
    data: { assignedAdminId: input.adminId },
  });
  if (count > 0) {
    logger.info(
      `[plan-change] request ${input.vehicleRequestId} assigned to concierge ${input.adminId} by ${input.actor}`,
    );
  }
  return { changed: count > 0 };
}

export interface DowngradeInput {
  buyerId: string;
  vehicleRequestId: string;
  /** An admin id, or the buyer's own id for a self-service downgrade. */
  actor: string;
  /** Required. §23.3 is a decision, and a decision with no reason is not reviewable. */
  reason: string;
}

export type DowngradeOutcome =
  /** No money had moved. The election reverted and ownership went back to the pool. */
  | { kind: "ELECTION_ONLY"; conciergeReleased: boolean; snapshotId: string | null }
  /**
   * The $400 had settled, so this is a refund REQUEST under §22.1's manual review.
   * The election still reverts — §23.3 says the plan reverts and the refund is decided
   * separately — and a Finance exception carries the decision.
   */
  | { kind: "REFUND_REVIEW_RAISED"; settledPremiumCents: number; snapshotId: string | null };

/**
 * Downgrade Premium → Standard for one request.
 *
 * The branch is on the LEDGER, not on the flag: `entitledPlanForRequest` reads whether
 * the $400 actually settled. §23.3's two paths are "before the $400 settles" and "after
 * the $400 settles", and no other fact decides which one applies.
 *
 * Both paths append a snapshot. §23.5: "Every plan change appends a plan snapshot
 * carrying the plan, its effective time and the acting party. Settled financial history
 * is never rewritten." The admin route that this replaces wrote none, which is why a
 * post-settlement review had no record to work from.
 */
export async function downgradeToStandard(
  input: DowngradeInput,
  db: Db = prisma,
): Promise<DowngradeOutcome> {
  if (!input.reason.trim()) {
    throw new Error("downgradeToStandard: §23.3 requires a reason — a decision with none is not reviewable");
  }

  const entitled = await entitledPlanForRequest(input.vehicleRequestId, db);

  const { boundSnapshotId } = await recordRequestPlanElection(
    {
      buyerId: input.buyerId,
      vehicleRequestId: input.vehicleRequestId,
      plan: "STANDARD",
      touchpoint: "downgrade",
      actor: input.actor,
      reason: input.reason,
      settledPremiumCents: entitled.settledPremiumCents,
    },
    db,
  );

  // RELEASE THE CONCIERGE, ownership back to the Operations pool. Null is the pool
  // (PAY-78/PAY-92), so this is a null write rather than a sentinel.
  const released = await db.vehicleRequest.updateMany({
    where: { id: input.vehicleRequestId, assignedAdminId: { not: null } },
    data: { assignedAdminId: null },
  });

  if (entitled.settledPremiumCents <= 0) {
    // §23.3 before settlement: "this is only a change of election. No money has moved."
    logger.info(
      `[plan-change] request ${input.vehicleRequestId} downgraded to STANDARD by ${input.actor} ` +
        `(election only — no Premium balance had settled)`,
    );
    return { kind: "ELECTION_ONLY", conciergeReleased: released.count > 0, snapshotId: boundSnapshotId };
  }

  // §23.3 after settlement: a refund REQUEST, and §22.1's manual review decides it.
  // Nothing here issues a refund, and nothing here touches the $99 — which §23.3 says
  // is never refunded on a downgrade — or the deal, or the vehicle hold.
  try {
    await raiseException({
      // The catalogue already carries this row — §26's "Downgrade requested after the
      // Premium balance settled", owned by FINANCE with a 120-hour deadline. Reused
      // rather than a new code: a second spelling of one §26 row is how an operations
      // queue ends up with two filters for one condition.
      code: "DOWNGRADE_AFTER_PREMIUM_SETTLED",
      buyerId: input.buyerId,
      vehicleRequestId: input.vehicleRequestId,
      idempotencyKey: `DOWNGRADE_AFTER_PREMIUM_SETTLED:${input.vehicleRequestId}`,
      detail:
        `Premium was downgraded to Standard for request ${input.vehicleRequestId} AFTER a settled ` +
        `balance of ${entitled.settledPremiumCents} minor units. §23.3 makes this a refund REQUEST, not a ` +
        `refund: Finance decides on the record of Premium service actually delivered — full, partial or ` +
        `declined. Reason given: "${input.reason}". NOTHING was refunded automatically. The $99 is never ` +
        `refunded on a downgrade, the transaction continues, and the vehicle hold is not released.`,
    });
  } catch (err) {
    // Best-effort at the call site: the election and the ownership move have already
    // landed, and failing them to report the review would be the wrong trade.
    logger.error(`[plan-change] downgrade refund-review exception failed for ${input.vehicleRequestId}:`, err);
  }

  return {
    kind: "REFUND_REVIEW_RAISED",
    settledPremiumCents: entitled.settledPremiumCents,
    snapshotId: boundSnapshotId,
  };
}
