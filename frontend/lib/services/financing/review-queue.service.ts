// lib/services/financing/review-queue.service.ts
//
// Phase 5 Block 4 — human-in-the-loop review queue. Phase 5 deliberately ADDS human
// review where regulation requires it: CONDITIONAL stips, declines needing an
// adverse-action notice (rule absent), edge declines, unexpected outcomes, and
// lender failures. Routing is idempotent; a human's decision is recorded into the
// tamper-evident audit trail (HUMAN_OVERRIDE + REVIEW_RESOLVED) and drives the
// application forward (a human may override the machine via force).

import { prisma } from "@/lib/prisma";
import type { FinancingReviewTask, FinancingReviewTaskType, CreditApplicationStatus } from "@prisma/client";
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
  const existing = await prisma.financingReviewTask.findFirst({
    where: { creditApplicationId: input.creditApplicationId, taskType: input.taskType, status: { in: ["OPEN", "IN_PROGRESS"] } },
  });
  if (existing) return existing;

  const task = await prisma.financingReviewTask.create({
    data: {
      creditApplicationId: input.creditApplicationId,
      dealId: input.dealId ?? null,
      buyerId: input.buyerId ?? null,
      taskType: input.taskType,
      status: "OPEN",
      reason: input.reason ?? null,
    },
  });
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
  /** Optional human decision that moves the application forward (overrides the machine). */
  decision?: CreditApplicationStatus;
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

  if (input.decision) {
    await advanceApplication(task.creditApplicationId, input.decision, {
      actorType: "ADMIN",
      actorId: input.adminId,
      reason: `human review: ${input.resolution}`,
      force: true,
    });
    await appendFinancingAuditEvent({
      eventType: "HUMAN_OVERRIDE",
      actorType: "ADMIN",
      actorId: input.adminId,
      creditApplicationId: task.creditApplicationId,
      dealId: task.dealId,
      buyerId: task.buyerId,
      payload: { taskId, decision: input.decision, resolution: input.resolution },
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
}

export async function listOpenReviewTasks(limit = 100): Promise<FinancingReviewTask[]> {
  return prisma.financingReviewTask.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: limit });
}

export async function claimReviewTask(taskId: string, adminId: string): Promise<void> {
  const res = await prisma.financingReviewTask.updateMany({
    where: { id: taskId, status: "OPEN" },
    data: { status: "IN_PROGRESS", assignedAdminId: adminId },
  });
  if (res.count !== 1) throw new ReviewTaskConcurrencyError(taskId);
}
