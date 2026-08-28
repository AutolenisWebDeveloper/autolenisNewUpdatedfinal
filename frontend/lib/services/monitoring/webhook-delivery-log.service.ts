// lib/services/monitoring/webhook-delivery-log.service.ts
//
// Makes a REJECTED provider webhook delivery visible in the database.
//
// WHY THIS EXISTS
// ---------------
// `payment_provider_events` is written only AFTER a Stripe signature verifies,
// and the route's signature-failure branch was a bare `return 400` — no log, no
// row, no trace. So from the platform's own data these three states were
// indistinguishable:
//
//   • Stripe is not delivering at all (endpoint never registered)
//   • Stripe IS delivering and every one is rejected (signing secret mismatch)
//   • the endpoint 500s before it can verify anything (a secret is unset)
//
// They have completely different fixes, and telling them apart required Stripe
// Dashboard access. That ambiguity is why a dead money path went unnoticed:
// silence looked identical to health. `WebhookEvent` was modelled for exactly
// this and had ZERO writers anywhere in the codebase — this wires it up.
//
// SCOPE: FAILURES ONLY. Successful deliveries are already recorded in
// `payment_provider_events` by the handler, and duplicating them here would be a
// second ledger of the same fact. This records only what that table cannot: the
// deliveries that never got far enough to be written there.
//
// The `source` field is free-form ("stripe" | "docusign" | "microbilt" per the
// model) so the other provider webhooks can adopt this without a second service.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/** Why a delivery never reached the handler's business logic. */
export type WebhookRejectionReason =
  /** Signature did not verify — most often a signing-secret mismatch. */
  | "signature_invalid"
  /** STRIPE_WEBHOOK_SECRET (or the provider equivalent) is unset. */
  | "webhook_secret_missing"
  /** The provider client could not be constructed — e.g. STRIPE_SECRET_KEY unset. */
  | "provider_client_unavailable";

const REASON_TEXT: Record<WebhookRejectionReason, string> = {
  signature_invalid:
    "Signature verification failed. If the body looks like a real signed event (kilobytes, signature header present), the endpoint's signing secret does not match this environment's webhook secret.",
  webhook_secret_missing:
    "The webhook signing secret is not set in this environment, so no delivery can be verified. Deliveries are being rejected with 500 and the provider will retry.",
  provider_client_unavailable:
    "The provider client could not be constructed (its API key is unset), so deliveries cannot be verified.",
};

/**
 * One row per (source, reason) per window.
 *
 * The endpoint is UNAUTHENTICATED — anyone can POST to it. Writing a row per
 * rejected request would turn this from observability into a storage-
 * amplification vector. One row is enough to prove the condition is occurring;
 * the point is to distinguish "happening" from "not happening", not to count.
 */
export const WEBHOOK_REJECTION_THROTTLE_MINUTES = 15;

/**
 * How long before the same rejection alerts an operator again.
 *
 * Deliberately much longer than the row throttle. The rows give a timeline (one
 * every 15 minutes proves the condition is ongoing); the alert is the thing a
 * human sees, and one every 15 minutes during a multi-day outage is 96 a day —
 * noise that gets ignored, which is indistinguishable from having no alert.
 */
export const WEBHOOK_REJECTION_ALERT_THROTTLE_MINUTES = 24 * 60;

export interface WebhookRejectionInput {
  /** Provider key for the model's `source` column, e.g. "stripe". */
  source: string;
  reason: WebhookRejectionReason;
  /**
   * Size of the request body in bytes. Recorded INSTEAD of the body: on a
   * signature failure the body is unauthenticated and attacker-controlled, and
   * if it is a genuine event with a mismatched secret it carries customer PII.
   * The size still answers the diagnostic question.
   */
  bodyBytes: number;
  /** Whether the provider's signature header was present at all. */
  hasSignatureHeader: boolean;
}

export type WebhookRejectionOutcome = "recorded" | "throttled" | "failed";

// Surface the rejection to an operator. /admin/operations reads SYSTEM_ALERT
// notifications, so without this the rows are queryable only by someone who
// already suspects a problem — which is exactly the gap that let a dead money
// path run for months. Ops-only (buyerId null) and best-effort: the durable
// record is the row, this is the thing that makes someone look at it.
//
// Raised for EVERY rejection reason, not only a bad signature. All three mean
// the webhook cannot work and all three were equally invisible on the dashboard;
// alerting on one and not the others would be arbitrary. The reason-specific
// body is what tells the operator which knob to turn.
async function raiseRejectionAlert(input: WebhookRejectionInput): Promise<void> {
  const title = `${input.source} webhook deliveries are being rejected — ${input.reason}`;
  try {
    const cutoff = new Date(Date.now() - WEBHOOK_REJECTION_ALERT_THROTTLE_MINUTES * 60_000);
    const recent = await prisma.notification.findFirst({
      where: { title, type: "SYSTEM_ALERT", createdAt: { gt: cutoff } },
      select: { id: true },
    });
    if (recent) return;

    await prisma.notification.create({
      data: {
        buyerId: null,
        type: "SYSTEM_ALERT",
        actionUrl: "/admin/operations",
        title,
        body:
          `${REASON_TEXT[input.reason]} ` +
          `The rejected request carried ${input.bodyBytes} bytes and ${input.hasSignatureHeader ? "DID" : "did NOT"} ` +
          `include a signature header — a genuine provider delivery is kilobytes with the header present, ` +
          `whereas an unauthenticated probe is small and unsigned. ` +
          `Full history: SELECT * FROM webhook_events WHERE source = '${input.source}' ORDER BY received_at DESC. ` +
          `Nothing downstream ran for these deliveries: no deposit was flipped, no auction created, no deal advanced.`,
      },
    });
  } catch (err) {
    logger.error(`[webhook-delivery-log] could not raise the ${input.source} rejection alert (best-effort):`, err);
  }
}

/**
 * Record that a delivery was rejected. Best-effort by contract: it returns an
 * outcome and never throws, because the provider's HTTP response must never
 * depend on our ability to log. A failure here is logged and swallowed.
 */
export async function recordWebhookRejection(
  input: WebhookRejectionInput,
): Promise<WebhookRejectionOutcome> {
  const eventType = `rejected.${input.reason}`;
  try {
    const cutoff = new Date(Date.now() - WEBHOOK_REJECTION_THROTTLE_MINUTES * 60_000);
    const recent = await prisma.webhookEvent.findFirst({
      where: { source: input.source, eventType, receivedAt: { gt: cutoff } },
      select: { id: true },
    });
    if (recent) return "throttled";

    await prisma.webhookEvent.create({
      data: {
        source: input.source,
        eventType,
        // A fixed allow-list, never a dump of the request. Adding a field here
        // means deciding it is safe to persist from an unverified caller.
        payload: {
          reason: input.reason,
          bodyBytes: input.bodyBytes,
          hasSignatureHeader: input.hasSignatureHeader,
          note: "Metadata only — the unverified request body is deliberately not stored.",
        },
        processed: false,
        error: REASON_TEXT[input.reason],
      },
    });
    // Only on a freshly written row — a throttled repeat must not re-alarm.
    await raiseRejectionAlert(input);
    return "recorded";
  } catch (err) {
    logger.error(`[webhook-delivery-log] could not record ${input.source} ${eventType} (best-effort):`, err);
    return "failed";
  }
}
