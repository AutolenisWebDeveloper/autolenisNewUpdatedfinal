// lib/services/esign/esign.service.ts
// Provider-neutral e-sign envelope helpers.
//
// AutoLenis signs buyer purchase contracts IN-HOUSE — see
// lib/services/esign/buyer-signing.service.ts for the signing authority (consent,
// adoption, hashing, evidence, certificate) and app/api/buyer/esign/** for the
// ceremony. This module keeps only the small, provider-independent envelope
// operations the admin tooling uses (mark ready-to-sign, void, resend). There is
// no external e-signature provider.

import { prisma } from "@/lib/prisma";
import { esignEnvelopeSelect } from "@/lib/services/esign/envelope-schema";
import { ESignStatus } from "@prisma/client";
import { isTerminalStatus } from "./buyer-signing.service";

// Class of error surfaced when an admin action would mutate an immutable terminal
// signing record. Terminal records are historical evidence — a new attempt must
// go through prepareBuyerSigningEnvelope (which archives the terminal record).
export class TerminalEnvelopeError extends Error {
  code = "TERMINAL_ENVELOPE";
  constructor(public readonly status: ESignStatus) {
    super(`Signing envelope is in a terminal state (${status}) and cannot be modified`);
    this.name = "TerminalEnvelopeError";
  }
}

// Notify the buyer their in-house signing package is ready (admin "resend" uses
// this). Marks the envelope SENT so the buyer's signing page becomes actionable.
// Refuses to resurrect a TERMINAL record (immutable historical evidence).
export async function sendEnvelope(dealId: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId }, select: esignEnvelopeSelect() });
  if (!envelope) throw new Error("Envelope not found");
  if (isTerminalStatus(envelope.status)) throw new TerminalEnvelopeError(envelope.status);
  await prisma.eSignEnvelope.update({ where: { dealId }, data: { status: ESignStatus.SENT, sentAt: new Date() } });
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (deal) {
    await prisma.notification.create({
      data: {
        buyerId: deal.buyerId,
        title: "Documents ready to sign",
        body: "Your purchase contract is ready to review and sign. Open it from your dashboard.",
        type: "SIGNING_READY",
      },
    }).catch(() => {});
  }
}

// Void an envelope (admin action). Provider-neutral DB status change. No-op on an
// already-terminal record (a terminal signing record is immutable).
export async function voidEnvelope(dealId: string, reason: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId }, select: esignEnvelopeSelect() });
  if (!envelope || isTerminalStatus(envelope.status)) return;
  await prisma.eSignEnvelope.updateMany({
    where: { id: envelope.id, status: envelope.status },
    data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
  });
}

// Re-notify the buyer to sign (admin "resend").
export async function resendEnvelope(dealId: string): Promise<void> {
  await sendEnvelope(dealId);
}
