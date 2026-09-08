// lib/services/prequal/adverse-action-outcome.ts
//
// One place that decides what a §615 adverse-action notice's delivery outcome was.
//
// Stage 3 requires that "delivery outcome is recorded as sent, duplicate, or
// failed", and §29's safeguards list "adverse-action outcomes distinguished" among
// the things that must not be weakened. That mapping was copy-pasted at four call
// sites — `prequal.service.ts:667-672`, `admin-prequal.service.ts:665-668`,
// `admin/prequal/[id]/decide/route.ts:246-249` and
// `admin/buyers/[buyerId]/prequal/manual-override/route.ts:218-221` — so a new
// delivery outcome had to be remembered in four places or it silently fell into
// the "failed" bucket at some of them and not others.
//
// It is one function now. The union is derived from `EmailSendOutcome`, so adding
// an outcome to the sender is a TYPE ERROR here until it is classified, rather
// than a silent misfiling.

import type { EmailSendOutcome } from "@/lib/services/email/resend.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { logger } from "@/lib/logger";

/** What the caller observed. `THREW` is the sender raising, not an outcome it returned. */
export type AdverseActionDelivery = EmailSendOutcome["outcome"] | "THREW";

/** The compliance event type recorded for a delivery. */
export type AdverseActionEventType =
  | "ADVERSE_ACTION_NOTICE_SENT"
  | "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE"
  | "ADVERSE_ACTION_NOTICE_SEND_FAILED";

/**
 * Classify a delivery.
 *
 * Everything that is not a confirmed send and not a confirmed duplicate is a
 * FAILURE — including the two outcomes added when the direct send rail was closed
 * against duplicates:
 *
 *   • `LOG_UNAVAILABLE` — the idempotency log could not be read, so nothing was
 *     sent. It is retryable, and until it is retried the notice HAS NOT been
 *     delivered. Recording it as anything but a failure would let a lookup outage
 *     look like a discharged §615 obligation.
 *   • `SUPPRESSED` — the address is hard-suppressed. The notice did not arrive and
 *     a retry will not change that; it needs a human and another channel.
 *
 * `DEV_SKIPPED` is likewise a failure: no notice reached the consumer.
 */
export function classifyAdverseActionDelivery(outcome: AdverseActionDelivery): AdverseActionEventType {
  switch (outcome) {
    case "SENT":
      return "ADVERSE_ACTION_NOTICE_SENT";
    case "DUPLICATE":
      return "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE";
    case "FAILED":
    case "DEV_SKIPPED":
    case "LOG_UNAVAILABLE":
    case "SUPPRESSED":
    case "THREW":
      return "ADVERSE_ACTION_NOTICE_SEND_FAILED";
  }
}

/** True when the consumer did not receive the notice and someone must act. */
export function adverseActionNeedsFollowUp(outcome: AdverseActionDelivery): boolean {
  return classifyAdverseActionDelivery(outcome) === "ADVERSE_ACTION_NOTICE_SEND_FAILED";
}

/**
 * A §615 notice that did not reach the consumer is somebody's work, not a log line.
 *
 * `ADVERSE_ACTION_NOTICE_SEND_FAILED` is written to `compliance_events` by every
 * call site, and nothing reads that table — so before this, a hard-suppressed
 * address or an idempotency-log outage discharged the obligation silently. The
 * §26 row that already owns this work is `PREQUAL_DECLINE` ("Send the decision and
 * the applicable adverse-action information"): a failed delivery is precisely that
 * action still outstanding, so it is raised rather than a new code invented.
 *
 * No-ops on a delivered or duplicate notice. Never throws: the decision itself has
 * already been recorded and must not be rolled back because the queue write failed.
 */
export async function raiseAdverseActionFollowUp(input: {
  outcome: AdverseActionDelivery;
  buyerId: string | null;
  prequalApplicationId: string;
}): Promise<void> {
  if (!adverseActionNeedsFollowUp(input.outcome)) return;
  try {
    await raiseException({
      code: "PREQUAL_DECLINE",
      buyerId: input.buyerId,
      idempotencyKey: `ADVERSE_ACTION_UNDELIVERED:${input.prequalApplicationId}`,
      detail:
        `the §615 adverse-action notice was NOT delivered (outcome ${input.outcome}). ` +
        `The decision stands and the obligation does not: deliver the notice by another channel and record the outcome.`,
    });
  } catch (err) {
    logger.error("[adverse-action] follow-up exception could not be raised", {
      prequalApplicationId: input.prequalApplicationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
