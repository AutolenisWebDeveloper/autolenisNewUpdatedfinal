// lib/services/email/transactional-dispatch.ts
//
// Single seam for putting a transactional lifecycle email onto the durable
// internal comms-dispatch queue (comms_outbox). Replaces the direct
// resend.service sendIdempotent rail for migrated senders. The drain applies
// hard-suppression (transactional bypasses marketing/soft suppression), sends
// via Resend, and writes the EmailSendLog audit row under the SAME idempotencyKey
// the direct rail used (key parity) — the idempotencyKey is also the outbox
// dedup_key, so an enqueue-once guarantee prevents duplicate sends.
//
// Deliberately passes NO contactId: these are transactional lifecycle emails,
// not CRM/marketing traffic, so they must not write a contact_timeline_events
// 'email_sent' row — the send is recorded on exactly one plane (EmailSendLog).

import { enqueueEmail } from "@/lib/services/comms/comms-outbox.service";

export interface TransactionalEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Audit label written to EmailSendLog.templateId (parity with the old rail). */
  templateId: string;
  /** Stable key — MUST equal the pre-migration sendIdempotent key for parity. */
  idempotencyKey: string;
}

export async function enqueueTransactionalEmail(input: TransactionalEmailInput): Promise<void> {
  await enqueueEmail({
    email: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    templateId: input.templateId,
    type: "transactional",
    idempotencyKey: input.idempotencyKey,
  });
}
