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
import { ESignStatus } from "@prisma/client";

// Notify the buyer their in-house signing package is ready (admin "resend" uses
// this). Marks the envelope SENT so the buyer's signing page becomes actionable.
export async function sendEnvelope(dealId: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope) throw new Error("Envelope not found");
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

// Void an envelope (admin action). Provider-neutral DB status change.
export async function voidEnvelope(dealId: string, reason: string): Promise<void> {
  await prisma.eSignEnvelope.update({
    where: { dealId },
    data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
  });
}

// Re-notify the buyer to sign (admin "resend").
export async function resendEnvelope(dealId: string): Promise<void> {
  await sendEnvelope(dealId);
}
