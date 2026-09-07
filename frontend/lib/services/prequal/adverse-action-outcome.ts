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
