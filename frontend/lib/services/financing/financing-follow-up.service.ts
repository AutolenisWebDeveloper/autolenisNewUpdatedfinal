// lib/services/financing/financing-follow-up.service.ts
// §13-D25 — what the credit-application review queue BECAME.
//
// THIS IS A MOVE, NOT A REMOVAL. `financing_review_tasks` and `review-queue.service.ts` gave an
// operational admin one thing: a list of financing matters awaiting a human decision, and a way to
// resolve each with a recorded note. That capability is load-bearing and is kept. What changed is
// where it lives.
//
// §13-D25, ruled: "retire the code paths, leave the table." The table holds zero rows and its
// physical drop shares §13-D9's retention sign-off, so nothing here touches it. The CODE is gone
// because the machine it served is gone: `FinancingReviewTask` was keyed on
// `credit_application_id` and its task types — ADVERSE_ACTION_REVIEW, LENDER_FAILURE_REVIEW,
// STIP_REVIEW, EDGE_DECLINE_REVIEW — are all states of the in-house lender decisioning §12 says
// AutoLenis never performs. A queue of reviews for decisions nobody makes is not a capability.
//
// The follow-ups that DO exist after Stage 12 are §26 rows, and §26 says every exception is
// written to `queue_items`. So this module is a READ over the exception register, filtered to the
// financing codes — one queue, one writer, one place an operator looks. `resolveFinancingFollowUp`
// is the resolve action, and it goes through the same `resolveQueueItem` every other exception
// uses rather than a second resolution path with its own audit shape.

import { prisma } from "@/lib/prisma";
import type { Prisma, QueueItem } from "@prisma/client";
import { OPEN_QUEUE_STATUSES } from "@/lib/services/operations/queue-item.service";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * The §26 rows that are financing follow-ups.
 *
 * Deliberately narrow. `FUNDING_NOT_CLEARED` is Phase 8's and is NOT here — an operator looking at
 * "financing follow-ups" before funding exists would find a row they can do nothing about, which
 * is the queue-noise problem §13-D11's ruling was about.
 */
export const FINANCING_FOLLOW_UP_CODES = ["FINANCING_FAILED_OR_EXPIRED"] as const;

export interface FinancingFollowUp {
  id: string;
  exceptionCode: string | null;
  dealId: string | null;
  buyerId: string | null;
  buyerVisibleStatus: string | null;
  requiredAction: string | null;
  deadlineAt: Date | null;
  createdAt: Date;
  escalatedAt: Date | null;
}

/**
 * Open financing follow-ups, newest deadline first.
 *
 * A QUERY FAILURE IS A FAILURE, never a confident empty — the carry-forward rule from Phase 2. The
 * caller gets the throw and renders an error state; an admin shown "no follow-ups" because the
 * database was unreachable would close the tab.
 */
export async function listOpenFinancingFollowUps(limit = 200, db: Db = prisma): Promise<FinancingFollowUp[]> {
  const rows = await db.queueItem.findMany({
    where: {
      status: { in: [...OPEN_QUEUE_STATUSES] },
      exceptionCode: { in: [...FINANCING_FOLLOW_UP_CODES] },
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      exceptionCode: true,
      dealId: true,
      buyerId: true,
      buyerVisibleStatus: true,
      requiredAction: true,
      deadlineAt: true,
      createdAt: true,
      escalatedAt: true,
    },
  });
  return rows;
}

/** Count only — for the admin dashboard tile that used to count review tasks. */
export async function countOpenFinancingFollowUps(db: Db = prisma): Promise<number> {
  return db.queueItem.count({
    where: {
      status: { in: [...OPEN_QUEUE_STATUSES] },
      exceptionCode: { in: [...FINANCING_FOLLOW_UP_CODES] },
    },
  });
}

/**
 * Resolve one follow-up. Thin on purpose: the resolution semantics, the audit and the
 * compare-and-set all belong to the §26 writer, and duplicating them here is how two queues start
 * disagreeing about what "resolved" means.
 */
export async function resolveFinancingFollowUp(params: {
  queueItemId: string;
  resolution: string;
  resolvedBy: string;
}): Promise<QueueItem> {
  const { resolve } = await import("@/lib/services/operations/queue-item.service");
  return resolve({
    queueItemId: params.queueItemId,
    resolution: params.resolution,
    resolvedBy: params.resolvedBy,
  });
}
