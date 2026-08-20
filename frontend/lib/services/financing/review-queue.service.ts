// lib/services/financing/review-queue.service.ts
//
// Phase 5 Block 4 — human-in-the-loop review queue. Phase 5 deliberately ADDS human
// review where regulation requires it: CONDITIONAL stips, declines needing an
// adverse-action notice (rule absent), edge declines, unexpected outcomes, and
// lender failures. Routing is idempotent; a human's decision is recorded into the
// tamper-evident audit trail (HUMAN_OVERRIDE + REVIEW_RESOLVED) and drives the
// application forward (a human may override the machine via force).

import { prisma } from "@/lib/prisma";
import type { FinancingReviewTask, FinancingReviewTaskType, FinancingReviewTaskStatus, CreditApplicationStatus } from "@prisma/client";
import { appendFinancingAuditEvent } from "./financing-audit.service";
import { advanceApplication } from "./credit-application.service";

export class ReviewTaskConcurrencyError extends Error {
  constructor(taskId: string) {
    super(`Review task ${taskId} was already resolved/claimed (0 rows matched the compare-and-swap)`);
    this.name = "ReviewTaskConcurrencyError";
  }
}

export interface RouteToReviewInput {
  creditApplicationId: string;
  dealId?: string | null;
  buyerId?: string | null;
  taskType: FinancingReviewTaskType;
  reason?: string;
}

/**
 * Route an application to human review. Idempotent: an existing OPEN/IN_PROGRESS
 * task of the same (application, type) is reused rather than duplicated.
 */
export async function routeToReview(input: RouteToReviewInput): Promise<FinancingReviewTask> {
  const OPEN_STATUSES: FinancingReviewTaskStatus[] = ["OPEN", "IN_PROGRESS"];
  const openWhere = { creditApplicationId: input.creditApplicationId, taskType: input.taskType, status: { in: OPEN_STATUSES } };
  const existing = await prisma.financingReviewTask.findFirst({ where: openWhere });
  if (existing) return existing;

  let task;
  try {
    task = await prisma.financingReviewTask.create({
      data: {
        creditApplicationId: input.creditApplicationId,
        dealId: input.dealId ?? null,
        buyerId: input.buyerId ?? null,
        taskType: input.taskType,
        status: "OPEN",
        reason: input.reason ?? null,
      },
    });
  } catch (e) {
    // Lost the create race — the partial-unique index (one OPEN/IN_PROGRESS per
    // app+type) rejected the duplicate. Return the winner instead of duplicating.
    if ((e as { code?: string } | null)?.code === "P2002") {
      const winner = await prisma.financingReviewTask.findFirst({ where: openWhere });
      if (winner) return winner;
    }
    throw e;
  }

  await appendFinancingAuditEvent({
    eventType: "REVIEW_ROUTED",
    actorType: "SYSTEM",
    creditApplicationId: input.creditApplicationId,
    dealId: input.dealId ?? null,
    buyerId: input.buyerId ?? null,
    payload: { taskType: input.taskType, reason: input.reason ?? null, taskId: task.id },
  });
  return task;
}

export interface ResolveReviewInput {
  adminId: string;
  resolution: string;
  /** Optional human decision that moves the application forward. */
  decision?: CreditApplicationStatus;
  /**
   * By default the human decision is still validated by the state machine (only a
   * legal transition from the current status is applied). Set true ONLY for a
   * deliberate override of an otherwise-illegal move — it is recorded as such.
   */
  override?: boolean;
}

/**
 * Resolve a review task. CAS to RESOLVED (only an OPEN/IN_PROGRESS task, once). When
 * the human supplies a decision, the application is advanced with force (a human may
 * override the state machine) and the override is recorded as HUMAN_OVERRIDE. Always
 * records REVIEW_RESOLVED.
 */
export async function resolveReviewTask(taskId: string, input: ResolveReviewInput): Promise<void> {
  const task = await prisma.financingReviewTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`review task ${taskId} not found`);

  // CAS first so exactly one resolver proceeds (no double-resolve / double-advance).
  const priorStatus = task.status;
  const res = await prisma.financingReviewTask.updateMany({
    where: { id: taskId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    data: {
      status: "RESOLVED",
      resolution: input.resolution,
      resolutionOutcome: input.decision ?? null,
      resolvedBy: input.adminId,
      resolvedAt: new Date(),
    },
  });
  if (res.count !== 1) throw new ReviewTaskConcurrencyError(taskId);

  // The audit trail's own append uses its own transaction (the hash chain), so a
  // single enclosing transaction isn't available. Instead: if advancing the app or
  // recording the audit fails, COMPENSATE by reverting the RESOLVED mark, so the
  // resolve stays retryable and never lands as RESOLVED-but-unaudited (the ECOA/
  // adverse-action trail must always reflect what happened).
  try {
    if (input.decision) {
      await advanceApplication(task.creditApplicationId, input.decision, {
        actorType: "ADMIN",
        actorId: input.adminId,
        reason: `human review: ${input.resolution}`,
        force: input.override ?? false,
      });
      await appendFinancingAuditEvent({
        eventType: "HUMAN_OVERRIDE",
        actorType: "ADMIN",
        actorId: input.adminId,
        creditApplicationId: task.creditApplicationId,
        dealId: task.dealId,
        buyerId: task.buyerId,
        payload: { taskId, decision: input.decision, resolution: input.resolution, override: input.override ?? false },
      });
    }
    await appendFinancingAuditEvent({
      eventType: "REVIEW_RESOLVED",
      actorType: "ADMIN",
      actorId: input.adminId,
      creditApplicationId: task.creditApplicationId,
      dealId: task.dealId,
      buyerId: task.buyerId,
      payload: { taskId, taskType: task.taskType, resolution: input.resolution, decision: input.decision ?? null },
    });
  } catch (e) {
    await prisma.financingReviewTask
      .updateMany({
        where: { id: taskId, status: "RESOLVED" },
        data: { status: priorStatus, resolution: null, resolutionOutcome: null, resolvedBy: null, resolvedAt: null },
      })
      .catch(() => {});
    throw e;
  }
}

// Active = OPEN or IN_PROGRESS, matching routeToReview/resolveReviewTask semantics —
// a claimed (IN_PROGRESS) task must stay visible in the queues, not vanish.
export async function listOpenReviewTasks(limit = 100): Promise<FinancingReviewTask[]> {
  return prisma.financingReviewTask.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function claimReviewTask(taskId: string, adminId: string): Promise<void> {
  const res = await prisma.financingReviewTask.updateMany({
    where: { id: taskId, status: "OPEN" },
    data: { status: "IN_PROGRESS", assignedAdminId: adminId },
  });
  if (res.count !== 1) throw new ReviewTaskConcurrencyError(taskId);
}
