// lib/services/trust/anti-circumvention.service.ts — §25.2's record and its consequences.
//
// §25.2: "A detection creates a record with the matched pattern and routes to Operations for
// review and resolution. A confirmed attempt to move the transaction off-platform AFTER A PAID
// AUCTION is a dealer agreement violation: it registers on the dealership scorecard, may suspend
// the dealership from future invitations, and is grounds for termination. Buyers are protected,
// not penalized, when the dealership initiates."
//
// THIS FILE HAD ZERO CALLERS BEFORE PHASE 5. `recordCircumventionAttempt` existed and nothing
// invoked it; the only output of a detection was one recipientless `Notification` with
// `type: "SYSTEM_ALERT"` and `.catch(() => {})`. Four things are added, each from a §10.6 row:
//
//   25-05  the §26 exception, so a detection lands on a desk with an owner and a deadline
//          instead of in an orphan notification row.
//   25-09a `initiatorRole`, resolved through `message_thread_participants` because the message
//          row cannot answer it, so an attempt can actually be attributed to a dealership.
//   25-11  `afterPaidAuction`, resolved at detection time — "after a paid auction" is the scope
//          §25.2 puts on the consequence, and it cannot be recomputed later because the deposit
//          state moves.
//   25-12  an audited Operations resolution, with FLAGGED → ACTIVE.
//
// §13-D42, AS THE OWNER RULED IT ON 2026-09-11: "ACCEPT, 90-day window. Record initiator_role on
// every attempt; consequences apply only to dealer-initiated ones. Phase 5 records and warns,
// Phase 10 enforces suspension." So `assessDealerRepeatRisk` below COMPUTES the verdict and
// writes it onto the exception; it does not suspend anybody. The enforcement POINT exists
// already — `validateRooftop` refuses a rooftop whose dealer is not ACTIVE, and the dealer
// invitation's state recheck refuses at send time — so when Phase 10 writes the suspension it
// will bite immediately rather than needing a reader built for it.
//
// THE PLATFORM ALERT IS KEPT AS A MIRROR, NOT AS THE STORE. §8.4 keeps `SYSTEM_ALERT` and
// `PlatformAlert` as read-only mirrors for `/admin/queues` and `/admin/operations` while
// `raiseException` becomes the store. Removing the alert would blank an admin surface; relying
// on it would leave the detection with no owner.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AntiCircumventionFlag, ThreadStatus, type Prisma } from "@prisma/client";
import { raiseException } from "@/lib/services/operations/queue-item.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** §13-D42's window, as the owner ruled it. */
export const REPEAT_WINDOW_DAYS = 90;

export interface RecordAttemptInput {
  threadId: string;
  messageId: string;
  userId: string;
  /** Resolved from the thread's participants — the message row cannot answer it. */
  initiatorRole: "BUYER" | "DEALER" | "ADMIN" | "UNKNOWN";
  flag: AntiCircumventionFlag;
  /** The matched expression. §25.2's "a record with the matched pattern". */
  pattern: string;
  /** The substring that matched. PII by construction; Operations-only. */
  matchedText?: string | null;
}

export interface RecordAttemptResult {
  attemptId: string;
  /** §25.2's scope for the consequence. Null when it could not be determined. */
  afterPaidAuction: boolean | null;
  /** The dealership the attempt is attributed to, when the initiator was a dealer. */
  dealerId: string | null;
  /** §13-D42: how many dealer-initiated attempts inside the 90-day window, including this one. */
  dealerAttemptsInWindow: number;
}

/**
 * Record one detection, attribute it, scope it, and route it to Operations.
 *
 * THROWS on a database failure rather than swallowing it. The caller (`sendMessage`) catches and
 * logs loudly, because a message that was redacted and flagged is already the safe outcome — but
 * this function must not decide that on the caller's behalf, and a silent `.catch` here is
 * exactly how the previous version's `PlatformAlert` write became invisible.
 */
export async function recordCircumventionAttempt(
  input: RecordAttemptInput,
): Promise<RecordAttemptResult> {
  const dealerId = input.initiatorRole === "DEALER" ? await resolveDealerForUser(input.userId) : null;
  const scope = await resolvePaidAuctionScope(input.threadId);

  const attempt = await prisma.circumventionAttempt.create({
    data: {
      threadId: input.threadId,
      messageId: input.messageId,
      userId: input.userId,
      flag: input.flag,
      // The expression AND the matched text. §25.2 asks for the matched pattern; an operator
      // reviewing "a phone number was detected" cannot tell an accidental paste from an offer to
      // take the deal off-platform, and only the second is a violation.
      pattern: input.matchedText ? `${input.pattern} :: ${input.matchedText}` : input.pattern,
      initiatorRole: input.initiatorRole,
      afterPaidAuction: scope.afterPaidAuction,
      dealerId,
    },
    select: { id: true },
  });

  // §13-D42 — counted, reported, NOT enforced here.
  const dealerAttemptsInWindow = dealerId ? await countDealerAttemptsInWindow(dealerId) : 0;

  // §26 "Circumvention detected — Operations — Review; scorecard, suspension, or termination".
  //
  // NOT keyed once per dealer or once per thread: every detection is its own reviewable event,
  // and collapsing them would hide a second attempt behind the first. Keyed on the attempt id,
  // which is unique by construction.
  await raiseException(
    {
      code: "CIRCUMVENTION_DETECTED",
      dealerId,
      idempotencyKey: `CIRCUMVENTION_DETECTED:${attempt.id}`,
      detail: buildDetail(input, scope, dealerAttemptsInWindow),
    },
    prisma,
  );

  // The §8.4 mirror. Best-effort: the exception above is the store, and an admin surface losing
  // one row must not lose the detection.
  await prisma.platformAlert
    .create({
      data: {
        level: "P1",
        title: "Anti-Circumvention Flag",
        body:
          `${input.flag} in thread ${input.threadId.slice(-8)} — initiated by ` +
          `${input.initiatorRole.toLowerCase()}${scope.afterPaidAuction ? ", after a paid auction" : ""}`,
        source: "messaging",
      },
    })
    .catch(() => {});

  logger.warn(
    `[anti-circumvention] ${input.flag} recorded: attempt=${attempt.id} role=${input.initiatorRole} ` +
      `dealer=${dealerId ?? "n/a"} afterPaidAuction=${scope.afterPaidAuction} ` +
      `attemptsInWindow=${dealerAttemptsInWindow}`,
  );

  return { attemptId: attempt.id, afterPaidAuction: scope.afterPaidAuction, dealerId, dealerAttemptsInWindow };
}

function buildDetail(
  input: RecordAttemptInput,
  scope: PaidAuctionScope,
  attemptsInWindow: number,
): string {
  const parts = [
    `${input.flag} detected in thread ${input.threadId.slice(-8)}, initiated by ${input.initiatorRole.toLowerCase()}.`,
    `Matched: ${input.matchedText ?? input.pattern}.`,
  ];

  if (input.initiatorRole === "BUYER") {
    // §25.2, verbatim in spirit: "Buyers are protected, not penalized, when the dealership
    // initiates." The inverse is not a licence to penalise the buyer either — the message is
    // redacted and the thread flagged, and the operator's action is a conversation, not a
    // sanction. Spelling that out on the queue row is what stops the default from drifting.
    parts.push(
      "BUYER-INITIATED: no dealer consequence applies. The message is redacted and the thread is " +
        "flagged; the buyer is not penalised.",
    );
  } else if (input.initiatorRole === "DEALER") {
    parts.push(
      scope.afterPaidAuction === true
        ? "DEALER-INITIATED AFTER A PAID AUCTION — §25.2 makes this a dealer agreement violation: " +
            "scorecard entry, possible suspension from future invitations, grounds for termination."
        : scope.afterPaidAuction === false
          ? "DEALER-INITIATED, but NOT after a paid auction — §25.2's violation scope does not apply. " +
            "Review and record."
          : "DEALER-INITIATED; the paid-auction scope could not be determined, so §25.2's violation " +
            "scope is UNDETERMINED. Establish it before applying any consequence.",
    );
    parts.push(
      `§13-D42: ${attemptsInWindow} dealer-initiated attempt(s) in the last ${REPEAT_WINDOW_DAYS} days, ` +
        `including this one. ${
          attemptsInWindow >= 2
            ? "A second within the window warrants suspension pending review — Phase 10 enforces; Phase 5 records."
            : "A first attempt warns and records."
        }`,
    );
  } else {
    parts.push(
      `Initiator role is ${input.initiatorRole.toLowerCase()} — no §25.2 consequence is defined for it.`,
    );
  }
  if (scope.note) parts.push(scope.note);
  return parts.join(" ");
}

interface PaidAuctionScope {
  afterPaidAuction: boolean | null;
  note?: string;
}

/**
 * 25-11 — "Resolve thread → request/deal → auction → deposit PAID at detection."
 *
 * RESOLVED NOW, NOT LATER, and stored. The deposit can be refunded or disputed after the fact, so
 * a consequence computed at review time would answer a different question than the one §25.2
 * asks: whether the attempt came after the buyer had paid for a competitive auction.
 *
 * Returns null rather than false when it cannot be determined. A thread with no deal, or a deal
 * with no auction, is genuinely unknown — and recording "not after a paid auction" for an unknown
 * would quietly exonerate a dealership on the strength of a missing join.
 */
async function resolvePaidAuctionScope(threadId: string): Promise<PaidAuctionScope> {
  try {
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: {
        dealId: true,
        requestId: true,
      },
    });
    if (!thread) return { afterPaidAuction: null, note: "Thread not found when scoping." };

    // A deal exists only after an offer was accepted, which can only happen after a paid auction
    // — so a thread on a deal is after a paid auction by construction. Checked against the
    // deposit anyway, because "by construction" is the reasoning that goes stale.
    if (thread.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: thread.dealId },
        select: { deposit: { select: { status: true, refundedAt: true } } },
      });
      if (deal?.deposit) {
        return { afterPaidAuction: deal.deposit.status === "PAID" && deal.deposit.refundedAt === null };
      }
      return { afterPaidAuction: true, note: "Scoped from the deal; no deposit row is linked to it." };
    }

    if (thread.requestId) {
      const { settledDepositForRequest } = await import("@/lib/services/payment/fulfillment-gate");
      const deposit = await settledDepositForRequest(thread.requestId);
      return { afterPaidAuction: deposit !== null };
    }

    return {
      afterPaidAuction: null,
      note: "The thread is linked to neither a deal nor a request, so the paid-auction scope is undetermined.",
    };
  } catch (err) {
    logger.warn(`[anti-circumvention] could not scope thread ${threadId}:`, err);
    return { afterPaidAuction: null, note: "Scoping failed; treat the scope as undetermined." };
  }
}

/** The dealership behind a user id, or null when the sender is not a dealer user. */
async function resolveDealerForUser(userId: string): Promise<string | null> {
  const dealer = await prisma.dealer.findFirst({ where: { userId }, select: { id: true } });
  return dealer?.id ?? null;
}

/** §13-D42's 90-day count, dealer-initiated only. */
async function countDealerAttemptsInWindow(dealerId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 86_400_000);
  return prisma.circumventionAttempt.count({
    where: { dealerId, initiatorRole: "DEALER", detectedAt: { gte: since } },
  });
}

export async function checkCircumventionRisk(
  userId: string,
): Promise<{ riskLevel: "LOW" | "MEDIUM" | "HIGH"; attempts: number }> {
  const attempts = await prisma.circumventionAttempt.count({ where: { userId } });
  const riskLevel = attempts >= 3 ? "HIGH" : attempts >= 1 ? "MEDIUM" : "LOW";
  return { riskLevel, attempts };
}

/**
 * 25-12 — Operations resolves a detection: confirm or dismiss.
 *
 * CONFIRM records the violation and leaves the thread FLAGGED — a confirmed attempt is not a
 * thread to reopen. DISMISS clears the flag and returns the thread to ACTIVE, which is the
 * transition nothing in the platform could previously make: `FLAGGED` was inert, no path read it
 * and no path left it.
 *
 * The audit row is the ADMIN's responsibility and is written by the route, which holds the admin
 * identity; this function records the resolution on the attempt and moves the thread.
 */
export async function resolveCircumventionAttempt(
  attemptId: string,
  resolution: "CONFIRMED" | "DISMISSED",
  resolvedBy: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<{ ok: boolean; threadId: string | null; alreadyResolved: boolean }> {
  const attempt = await db.circumventionAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, threadId: true, resolved: true },
  });
  if (!attempt) return { ok: false, threadId: null, alreadyResolved: false };
  if (attempt.resolved) return { ok: true, threadId: attempt.threadId, alreadyResolved: true };

  await db.circumventionAttempt.update({
    where: { id: attemptId },
    data: { resolved: true, resolvedBy, resolution, resolvedAt: now },
  });

  if (resolution === "DISMISSED") {
    // Only a dismissal reopens the thread, and only if no OTHER unresolved detection stands on
    // it. Clearing the flag while a second attempt is still open would hide that second one.
    const otherOpen = await db.circumventionAttempt.count({
      where: { threadId: attempt.threadId, resolved: false, id: { not: attemptId } },
    });
    if (otherOpen === 0) {
      await db.messageThread.updateMany({
        where: { id: attempt.threadId, status: ThreadStatus.FLAGGED },
        data: { status: ThreadStatus.ACTIVE, flagReason: null },
      });
    }
  }

  logger.info(
    `[anti-circumvention] attempt ${attemptId} ${resolution.toLowerCase()} by ${resolvedBy}` +
      (resolution === "DISMISSED" ? " — thread returned to ACTIVE if no other detection stands" : ""),
  );
  return { ok: true, threadId: attempt.threadId, alreadyResolved: false };
}
