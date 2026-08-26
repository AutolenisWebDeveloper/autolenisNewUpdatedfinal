import 'server-only';
import { prisma } from '@/lib/prisma';

// Provider-webhook replay dedup — the ONE shared implementation of the claim /
// settle pattern the Stripe handler and the former DocuSign handler each hand-rolled inline against
// the existing `PaymentProviderEvent` ledger (unique on `eventId`). It exists to
// close the verified idempotency gap in the other inbound webhooks (Higgsfield,
// MicroBilt, Twilio) WITHOUT adding a second dedup table: the same
// `payment_provider_events` row, namespaced by provider, cannot collide with a
// Stripe event id (the former `docusign:*` keys proved the pattern).
//
// It is deliberately NOT retro-fitted onto the Stripe handler — its
// money/e-sign flows have their own audited claim logic and are out of scope to
// churn. New consumers use this helper so the pattern lives in one place.
//
// Semantics (fail-open on the first delivery, fail-closed on ambiguity):
//   • 'duplicate'    — a prior delivery already ran to completion. Ack, do nothing.
//   • 'in_progress'  — a concurrent delivery holds the claim. Signal a retry (5xx).
//   • 'claimed'      — this delivery owns the work. Run the handler, then settle().
//
// A row created but never settled (handler crashed mid-flight) is re-claimed on the
// next delivery (processed=false), so a partial failure retries rather than being
// silently marked done.

export type ProviderEventClaim =
  | { status: 'duplicate' }
  | { status: 'in_progress' }
  | { status: 'claimed'; settle: () => Promise<void> };

export interface ClaimProviderEventParams {
  /** Stable provider namespace, e.g. "higgsfield" | "microbilt" | "twilio". */
  provider: string;
  /** The provider's unique event identity (request_id, MessageSid, svix-id, …). */
  eventId: string;
  /** Coarse event type, stored for observability (e.g. the status/kind). */
  eventType: string;
  /** Raw event, persisted for audit/reconciliation. */
  payload: unknown;
}

export async function claimProviderEvent(
  params: ClaimProviderEventParams,
): Promise<ProviderEventClaim> {
  const key = `${params.provider}:${params.eventId}`;

  const existing = await prisma.paymentProviderEvent.findUnique({
    where: { eventId: key },
    select: { processed: true },
  });
  if (existing?.processed) return { status: 'duplicate' };

  if (!existing) {
    try {
      await prisma.paymentProviderEvent.create({
        data: {
          eventId: key,
          eventType: `${params.provider}.${params.eventType}`,
          // Defensive clone so a non-serializable field can never poison the write.
          payload: JSON.parse(JSON.stringify(params.payload ?? {})),
          processed: false,
        },
      });
    } catch (err) {
      // A concurrent delivery won the create race — it owns the claim.
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002') return { status: 'in_progress' };
      throw err;
    }
  }

  // Either we just created the row, or an unprocessed row from a crashed prior
  // delivery exists — in both cases THIS delivery re-drives and settles.
  return {
    status: 'claimed',
    settle: async () => {
      await prisma.paymentProviderEvent.update({
        where: { eventId: key },
        data: { processed: true, processedAt: new Date() },
      });
    },
  };
}
