// lib/services/email/email-send-log.ts
//
// S3 — EmailSendLog continuity for transactional lifecycle emails migrated onto
// the Inngest spine. Before S3, every transactional sender wrote an EmailSendLog
// row via resend.service's sendIdempotent (keyed on a stable idempotencyKey).
// Now that those sends flow through emailSendFn, this helper re-creates the SAME
// EmailSendLog row under the SAME key — so admin views, reporting, and any
// dedup that reads EmailSendLog keep working (key parity, no new key).
//
// Upsert on idempotencyKey (which is @unique), so a retry updates the existing
// row instead of duplicating it.

import { prisma } from "@/lib/prisma";

// Retriable dedup for transactional sends on the Inngest spine. Mirrors the
// pre-S3 direct rail (resend.service `sendIdempotent`): ONLY a genuinely-SENT
// prior attempt blocks a re-send. A previously FAILED attempt (transient
// Resend/DB outage) MUST remain retriable — otherwise one blip permanently
// poisons the key and a lifecycle email (deal-selected, offers-ready, dealer
// award/loss) can never be delivered. This is deliberately NOT the
// idempotency_keys guard, which is insert-once and never released in
// emailSendFn, so a first-attempt failure would block every retry.
export async function transactionalEmailAlreadySent(idempotencyKey: string): Promise<boolean> {
  const existing = await prisma.emailSendLog.findUnique({
    where: { idempotencyKey },
    select: { status: true },
  });
  return existing?.status === "SENT";
}

export async function recordTransactionalEmailSend(params: {
  idempotencyKey: string;
  recipient: string;
  templateId: string;
  status?: string;
  resendId?: string | null;
}): Promise<void> {
  const status = params.status ?? "SENT";
  await prisma.emailSendLog.upsert({
    where: { idempotencyKey: params.idempotencyKey },
    create: {
      idempotencyKey: params.idempotencyKey,
      recipient: params.recipient,
      templateId: params.templateId,
      status,
      resendId: params.resendId ?? null,
    },
    update: {
      recipient: params.recipient,
      templateId: params.templateId,
      status,
      resendId: params.resendId ?? null,
    },
  });
}
