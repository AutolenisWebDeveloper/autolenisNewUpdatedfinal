// Comms provider adapters — the ONLY place the comms-dispatch queue touches the
// Resend / Twilio SDKs (integrations rule: no raw third-party SDK calls outside an
// adapter). Isolating them here also keeps the queue service unit-testable: tests
// mock this first-party module instead of the third-party packages.
//
// Fail-closed: a provider error THROWS (never a fabricated success), so the drain
// records a real failure and retries.

import { Resend } from "resend";
import twilio from "twilio";
<<<<<<< HEAD
import { isCaptureTransport, CAPTURED_PROVIDER_ID } from "./transport-mode";
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

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
}

export async function sendEmailViaResend(args: ResendSendArgs): Promise<{ id: string | null }> {
<<<<<<< HEAD
  // COMMS_TRANSPORT=capture — the preview transport boundary (§12.3 step 6). The
  // check is here, above the SDK call, so no caller can bypass it: this module is
  // the only place this rail touches Resend.
  if (isCaptureTransport()) return { id: CAPTURED_PROVIDER_ID };
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const out = await getResend().emails.send(
    {
      from: process.env.RESEND_FROM_EMAIL!,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      headers: { "List-Unsubscribe": `<${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe>` },
    },
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
  );
  if (out.error) throw new Error(`RESEND_API_EXCEPTION: ${out.error.message}`);
  return { id: out.data?.id ?? null };
}

export async function sendSmsViaTwilio(args: { to: string; body: string }): Promise<{ sid: string }> {
<<<<<<< HEAD
  if (isCaptureTransport()) return { sid: CAPTURED_PROVIDER_ID };
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const result = await getTwilio().messages.create({
    from: process.env.TWILIO_FROM_NUMBER!,
    to: args.to,
    body: `${args.body}\n\nReply STOP to opt out.`,
  });
  return { sid: result.sid };
}
