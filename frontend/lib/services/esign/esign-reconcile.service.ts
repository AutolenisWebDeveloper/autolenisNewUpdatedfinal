// Program 4 — DocuSign envelope reconciliation.
//
// The `envelope-completed` webhook is the primary driver of SIGNING_PENDING →
// SIGNED. DocuSign Connect retries a failed delivery ~12 times, but if it is
// never delivered (Connect misconfig, sustained outage, our endpoint down past
// the retry window) the deal is stranded at SIGNING_PENDING forever with no
// recovery. This cron closes that gap: it polls DocuSign for the AUTHORITATIVE
// status of any envelope still SENT/DELIVERED whose deal is still SIGNING_PENDING
// and drives the SAME idempotent handlers the webhook uses.
//
// Idempotency is CROSS-PATH: each side effect is claimed on the exact dedup key
// the webhook uses (`docusign:${envelopeId}:${event}` via claimProviderEvent), so
// a reconciler-driven completion and a late webhook delivery can never both run.
//
// DORMANT without real DocuSign: getEnvelopeStatus returns null in mock mode, and
// this service short-circuits when DocuSign is unconfigured — nothing to poll.
// Truthfulness: it NEVER marks a document signed on its own — it only relays the
// provider's own status into the idempotent completion/decline/void handlers.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { ESignStatus } from "@prisma/client";
import { isDocuSignConfigured } from "./docusign-auth.service";
import {
  getEnvelopeStatus,
  handleEnvelopeCompleted,
  handleEnvelopeDeclined,
  handleEnvelopeVoidedByProvider,
} from "./esign.service";
import { claimProviderEvent } from "@/lib/services/webhooks/provider-event-dedup";

const BATCH = 50;
// Only reconcile envelopes older than this — give the real-time webhook time to
// land first, so the poll is a backstop, not a race with normal delivery.
const STALE_MINUTES = 15;

export interface EsignReconcileSummary {
  scanned: number;
  completed: number;
  declined: number;
  voided: number;
  stillPending: number;
  failed: number;
  skippedUnconfigured: boolean;
}

export async function reconcileEsignEnvelopes(): Promise<EsignReconcileSummary> {
  const base: EsignReconcileSummary = {
    scanned: 0, completed: 0, declined: 0, voided: 0, stillPending: 0, failed: 0, skippedUnconfigured: false,
  };

  // DORMANT without real DocuSign — mock envelopes have no pollable id.
  if (!isDocuSignConfigured()) return { ...base, skippedUnconfigured: true };

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000);
  const envelopes = await prisma.eSignEnvelope.findMany({
    where: {
      status: { in: [ESignStatus.SENT, ESignStatus.DELIVERED] },
      docusignEnvelopeId: { not: null },
      sentAt: { lt: cutoff },
      // Only deals genuinely waiting on a signature — a deal that already moved
      // on (SIGNED, cancelled, etc.) needs no reconciliation.
      deal: { status: "SIGNING_PENDING" },
    },
    select: { id: true, dealId: true, docusignEnvelopeId: true },
    orderBy: { sentAt: "asc" },
    take: BATCH,
  });

  let completed = 0, declined = 0, voided = 0, stillPending = 0, failed = 0;

  for (const env of envelopes) {
    const envId = env.docusignEnvelopeId as string;
    try {
      const status = await getEnvelopeStatus(envId);
      if (status === "completed") {
        if (await drive(envId, "envelope-completed", () => handleEnvelopeCompleted(envId))) completed++;
      } else if (status === "declined") {
        if (await drive(envId, "envelope-declined", () => handleEnvelopeDeclined(envId, "Reconciled: declined at DocuSign"))) declined++;
      } else if (status === "voided") {
        if (await drive(envId, "envelope-voided", () => handleEnvelopeVoidedByProvider(envId, "Reconciled: voided at DocuSign"))) voided++;
      } else {
        // Still genuinely in flight at DocuSign (sent/delivered/created) — leave it.
        stillPending++;
      }
    } catch (err) {
      logger.error(`[esign-reconcile] envelope ${env.id} reconcile failed — will retry:`, err);
      failed++;
    }
  }

  return { scanned: envelopes.length, completed, declined, voided, stillPending, failed, skippedUnconfigured: false };
}

// Run a side effect under the SAME provider-event claim the webhook uses, so a
// reconciler and a late webhook cannot both fire it. Returns true iff this call
// owned and ran the work (claimed), false if a prior/concurrent delivery did.
async function drive(envId: string, event: string, run: () => Promise<void>): Promise<boolean> {
  const claim = await claimProviderEvent({
    provider: "docusign",
    eventId: `${envId}:${event}`,
    eventType: event,
    payload: { source: "esign-reconcile", envelopeId: envId },
  });
  if (claim.status !== "claimed") return false; // duplicate (already ran) or in_progress
  await run();
  await claim.settle();
  return true;
}
