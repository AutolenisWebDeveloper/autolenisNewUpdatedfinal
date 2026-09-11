// Comms provider adapters — the ONLY place the comms-dispatch queue touches the
// Resend / Twilio SDKs (integrations rule: no raw third-party SDK calls outside an
// adapter). Isolating them here also keeps the queue service unit-testable: tests
// mock this first-party module instead of the third-party packages.
//
// Fail-closed: a provider error THROWS (never a fabricated success), so the drain
// records a real failure and retries.

import { Resend } from "resend";
import twilio from "twilio";
import { isCaptureTransport, CAPTURED_PROVIDER_ID } from "./transport-mode";

// ── Observed non-delivery ───────────────────────────────────────────────────
//
// The reclaim guard exists because a row that reached the provider and whose
// outcome we never saw must not be re-sent. It could not tell that case apart
// from one where the provider ANSWERED and refused — and the stamp sits
// immediately before the send, so EVERY provider failure looked like the first.
// Six Operations exceptions from one capture, each dead at attempt 1 of 5.
//
// These two errors mark the cases where non-delivery is a fact rather than an
// assumption: the API replied with an error, or required configuration was
// missing before the provider was touched at all. Both mean nothing was sent, so
// the retry budget is safe to spend.
//
// The marker is a PROPERTY, not the class identity: the dispatcher's tests mock
// this module, and `instanceof` across a module mock does not hold.

/** Set on any error that proves the message was not delivered. */
export interface DefinitiveNonDelivery {
  readonly definitiveNonDelivery: true;
}

/** The provider answered and refused. Nothing was sent. */
export class ProviderRejection extends Error implements DefinitiveNonDelivery {
  readonly definitiveNonDelivery = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderRejection";
  }
}

/** Required transport configuration is absent, detected BEFORE the provider call. */
export class ProviderPreflightError extends Error implements DefinitiveNonDelivery {
  readonly definitiveNonDelivery = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderPreflightError";
  }
}

/** True when the error proves nothing was sent. Anything else stays uncertain. */
export function isDefinitiveNonDelivery(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Partial<DefinitiveNonDelivery>).definitiveNonDelivery === true
  );
}

/**
 * Assert the email transport can send, BEFORE `dispatched_at` is stamped.
 *
 * `RESEND_FROM_EMAIL` was read with a non-null assertion at the send call, so an
 * unset value became a provider-side error AFTER the stamp — which the reclaim
 * guard then read as "we may have sent it", terminal-failing a message that had
 * never left the process. Checked here, an absent variable is an ordinary failed
 * attempt that retries and, at the end of its budget, reports the real reason.
 */
export function assertEmailTransportConfigured(): void {
  if (isCaptureTransport()) return;
  if (!process.env.RESEND_API_KEY) throw new ProviderPreflightError("RESEND_API_KEY is not set");
  if (!process.env.RESEND_FROM_EMAIL) throw new ProviderPreflightError("RESEND_FROM_EMAIL is not set");
}

/** The SMS counterpart. `TWILIO_FROM_NUMBER` carries the same non-null assertion. */
export function assertSmsTransportConfigured(): void {
  if (isCaptureTransport()) return;
  if (!process.env.TWILIO_ACCOUNT_SID) throw new ProviderPreflightError("TWILIO_ACCOUNT_SID is not set");
  if (!process.env.TWILIO_AUTH_TOKEN) throw new ProviderPreflightError("TWILIO_AUTH_TOKEN is not set");
  if (!process.env.TWILIO_FROM_NUMBER) throw new ProviderPreflightError("TWILIO_FROM_NUMBER is not set");
}

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

let _twilio: ReturnType<typeof twilio> | null = null;
function getTwilio(): ReturnType<typeof twilio> {
  if (!_twilio) _twilio = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _twilio;
}

export interface ResendSendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Provider-side idempotency key (the outbox dedup_key). Resend dedupes sends
   * carrying the same key for ~24h, so a crash-then-reclaim re-send inside that
   * window is collapsed provider-side — an extra guard on top of the outbox's
   * dispatched_at reclaim policy.
   */
  idempotencyKey?: string;
  /**
   * Overrides the default `List-Unsubscribe` target. Added in Phase 5 for dealer-facing
   * mail.
   *
   * The default below points at `/unsubscribe`, a buyer-oriented page that cannot identify
   * a dealership — so for an auction invitation it is a header that looks like an opt-out
   * and is not one. `/api/public/dealer-unsubscribe?token=…` identifies the address and
   * writes its suppression row, which is the thing that actually stops the next send.
   *
   * When set, `List-Unsubscribe-Post` is sent with it. That header is a PROMISE to the
   * mail provider that the URL honours an unattended POST (RFC 8058 one-click), so it is
   * only ever sent alongside an explicit URL — and the dealer route does export a POST
   * handler (`app/api/public/dealer-unsubscribe/route.ts:34`). Asserting one-click against
   * a GET-only endpoint would make Gmail's one-click button fail silently, which is worse
   * than not claiming it.
   */
  listUnsubscribeUrl?: string;
}

export async function sendEmailViaResend(args: ResendSendArgs): Promise<{ id: string | null }> {
  // COMMS_TRANSPORT=capture — the preview transport boundary (§12.3 step 6). The
  // check is here, above the SDK call, so no caller can bypass it: this module is
  // the only place this rail touches Resend.
  if (isCaptureTransport()) return { id: CAPTURED_PROVIDER_ID };
  const out = await getResend().emails.send(
    {
      from: process.env.RESEND_FROM_EMAIL!,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      headers: args.listUnsubscribeUrl
        ? {
            "List-Unsubscribe": `<${args.listUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : { "List-Unsubscribe": `<${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe>` },
    },
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
  );
  // The SDK returns `{ error }` rather than throwing for an API-level refusal, so
  // this is the provider ANSWERING: the message was not accepted and was not sent.
  // A throw from `emails.send` itself (timeout, socket reset) is a different case
  // and stays uncertain — it is deliberately not wrapped here.
  if (out.error) throw new ProviderRejection(`RESEND_API_EXCEPTION: ${out.error.message}`);
  return { id: out.data?.id ?? null };
}

export async function sendSmsViaTwilio(args: { to: string; body: string }): Promise<{ sid: string }> {
  if (isCaptureTransport()) return { sid: CAPTURED_PROVIDER_ID };
  const result = await getTwilio().messages.create({
    from: process.env.TWILIO_FROM_NUMBER!,
    to: args.to,
    body: `${args.body}\n\nReply STOP to opt out.`,
  });
  return { sid: result.sid };
}
