// POST /api/admin/circumvention/[attemptId]/resolve — §25.2 / 25-12.
//
// §26: "Circumvention detected — Operations — Review; scorecard, suspension, or termination."
// §25.2: "A detection creates a record with the matched pattern and routes to Operations for
// REVIEW AND RESOLUTION."
//
// Before this route there was no resolution at all: `FLAGGED` was inert — no path read it, no
// path left it — so a flagged thread stayed flagged forever and kept accepting messages from
// every party. Confirming or dismissing is the step that makes the detection a decision.
//
// WHAT THIS DOES NOT DO, DELIBERATELY. It does not suspend or terminate a dealership. §13-D42,
// as the owner ruled it on 2026-09-11: Phase 5 records and warns, Phase 10 enforces suspension.
// A confirmation here writes the violation and the audit trail; the enforcement POINT already
// exists (`validateRooftop` refuses a rooftop whose dealer is not ACTIVE, and the invitation's
// send-time recheck refuses too), so Phase 10's write will bite the moment it lands.

import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { resolveCircumventionAttempt, REPEAT_WINDOW_DAYS } from "@/lib/services/trust/anti-circumvention.service";

interface Props { params: Promise<{ attemptId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { attemptId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const body = (await request.json().catch(() => ({}))) as { resolution?: string; reason?: string };
  const resolution = body.resolution === "CONFIRMED" ? "CONFIRMED" : body.resolution === "DISMISSED" ? "DISMISSED" : null;
  if (!resolution) {
    return adminError("VALIDATION_ERROR", "resolution must be CONFIRMED or DISMISSED", 400);
  }
  const reason = body.reason?.trim();
  // A reason is required on BOTH outcomes. A confirmation carries a consequence for a
  // dealership, and a dismissal is the decision that a flagged message was benign — the second
  // needs justifying at least as much as the first, because it is the one that clears a thread.
  if (!reason) {
    return adminError("REASON_REQUIRED", "State why this detection is being confirmed or dismissed", 400);
  }

  // Read the attempt BEFORE resolving, so the audit row can record what was decided about what.
  const attempt = await prisma.circumventionAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true, threadId: true, flag: true, initiatorRole: true, afterPaidAuction: true,
      dealerId: true, detectedAt: true, resolved: true,
    },
  });
  if (!attempt) return adminError("NOT_FOUND", "Circumvention attempt not found", 404);

  const result = await resolveCircumventionAttempt(attemptId, resolution, admin.adminId);
  if (!result.ok) return adminError("NOT_FOUND", "Circumvention attempt not found", 404);
  if (result.alreadyResolved) {
    return adminSuccess({
      attemptId,
      alreadyResolved: true,
      message: "This detection was already resolved. Nothing changed.",
    });
  }

  // §13-D42's count, recorded on the audit row at the moment of the decision — so a later
  // reviewer sees the repeat history the decision was taken against rather than today's.
  const attemptsInWindow = attempt.dealerId
    ? await prisma.circumventionAttempt.count({
        where: {
          dealerId: attempt.dealerId,
          initiatorRole: "DEALER",
          detectedAt: { gte: new Date(Date.now() - REPEAT_WINDOW_DAYS * 86_400_000) },
        },
      })
    : 0;

  await createAuditLog(admin, request, {
    action: "STATUS_CHANGE",
    entityType: "CircumventionAttempt",
    entityId: attemptId,
    reason,
    metadata: {
      event: `CIRCUMVENTION_${resolution}`,
      flag: attempt.flag,
      initiatorRole: attempt.initiatorRole,
      afterPaidAuction: attempt.afterPaidAuction,
      dealerId: attempt.dealerId,
      threadId: attempt.threadId,
      dealerAttemptsInWindow: attemptsInWindow,
      repeatWindowDays: REPEAT_WINDOW_DAYS,
      // §13-D42: recorded, not enforced. Phase 10 owns the suspension.
      suspensionWarranted:
        resolution === "CONFIRMED" &&
        attempt.initiatorRole === "DEALER" &&
        attempt.afterPaidAuction === true &&
        attemptsInWindow >= 2,
    },
    previousState: { resolved: false },
    newState: { resolved: true, resolution },
  });

  logger.info(`[circumvention] attempt ${attemptId} ${resolution} by ${admin.email}: ${reason}`);

  return adminSuccess({
    attemptId,
    resolution,
    threadReturnedToActive: resolution === "DISMISSED",
    dealerAttemptsInWindow: attemptsInWindow,
    message:
      resolution === "CONFIRMED"
        ? "Recorded as a confirmed attempt. The thread stays flagged. Suspension and termination remain human decisions."
        : "Dismissed. The thread is active again unless another detection still stands on it.",
  });
}
