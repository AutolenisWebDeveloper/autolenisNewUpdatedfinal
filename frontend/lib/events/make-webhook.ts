import 'server-only';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// OUTBOUND WEBHOOK → Make.com (Step 3)
// ---------------------------------------------------------------------------
// AutoLenis ORCHESTRATION CONTRACT: Make.com receives every domain event AND
// decides branching/delays/sequencing. It NEVER sends on its own — it calls
// back into /api/crm/dispatch/* so AutoLenis owns the actual send + consent +
// suppression + idempotency + audit.
//
// This module forwards a signed envelope to a single Make router scenario.
// It is intentionally best-effort: Make scenarios are NOT on the request path,
// so any non-2xx / network error is logged and swallowed (no inline retry).

// Versioned envelope every Make scenario codes against. `version` is bumped
// only on a breaking shape change so old scenarios can branch on it.
export interface DomainEventEnvelopeContact {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  consentEmail: boolean;
  consentSms: boolean;
  lifecycleStage: string;
}

export interface DomainEventEnvelope {
  event: string;
  version: 1;
  idempotencyKey: string;
  occurredAt: string; // ISO-8601
  contact: DomainEventEnvelopeContact;
  data: Record<string, unknown>;
}

const FORWARD_TIMEOUT_MS = 5_000;

// Sign + POST the envelope to Make. Resolves (never rejects) so callers in
// after() / fire-and-forget contexts can ignore the result safely.
export async function forwardToMake(envelope: DomainEventEnvelope): Promise<void> {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) {
    // Safe no-op in dev/preview where no Make router is wired.
    console.warn(
      `[make-webhook] MAKE_WEBHOOK_URL unset — skipped forward of '${envelope.event}' (${envelope.idempotencyKey})`,
    );
    return;
  }

  const secret = process.env.MAKE_WEBHOOK_SECRET ?? '';
  if (!secret) {
    console.error('[make-webhook] MAKE_WEBHOOK_SECRET unset — refusing to send an unsigned event');
    return;
  }

  // Sign the RAW JSON body — Make verifies the same bytes it receives.
  const body = JSON.stringify(envelope);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const timestamp = Date.now().toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AutoLenis-Signature': signature,
        'X-AutoLenis-Event': envelope.event,
        'X-AutoLenis-Timestamp': timestamp,
        'X-Idempotency-Key': envelope.idempotencyKey,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        `[make-webhook] non-2xx from Make (provider=make status=${res.status}) for '${envelope.event}' ${envelope.idempotencyKey}`,
      );
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[make-webhook] forward failed (provider=make) for '${envelope.event}' ${envelope.idempotencyKey}: ${reason}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
