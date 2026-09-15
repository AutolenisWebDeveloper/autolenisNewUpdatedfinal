// lib/services/esign/open-signing.service.ts
//
// Stage 13/14c — open signing for EVERY required signer, and tell each of them.
//
// WHY THIS EXISTS RATHER THAN A FOURTH COPY. Four places prepared a signing envelope:
// the Contract Shield approve route, the auto-advance on a PASS scan, the admin e-sign
// route and the buyer's own ceremony route. Each called `prepareBuyerSigningEnvelope`
// with the BUYER's name and email and nothing else — which was complete while a deal
// could hold only one envelope, and silently incomplete the moment §13-D30 let a deal
// require two. Four call sites is four chances to forget the co-buyer, and forgetting
// produces a deal that waits forever on a signature nobody was ever asked for.
//
// So there is one function, and it answers the whole question: who is required, does
// each have a live envelope, and has each been told.
//
// THE COMMUNICATION IS PART OF THE OPERATION, NOT A FOLLOW-UP. §27.1's "Signature
// required → Buyer + co-buyer → Secure signing link and deadline" is a REQUIREMENT of
// the stage, and a prepared envelope nobody was told about is exactly the stall Stage 13
// spends its failure path on. Both go through the durable outbox, so neither depends on
// the request that happened to trigger them surviving.

import { logger } from "@/lib/logger";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import {
  PHASE_8_TEMPLATES,
  signatureReminderCancelKey,
} from "@/lib/services/comms/state-recheck-registry";
import {
  renderSignatureRequired,
  renderSignatureReminder,
} from "@/lib/services/comms/phase8-email-content";
import { prisma } from "@/lib/prisma";
import { prepareBuyerSigningEnvelope, readEnvelopeForDeal } from "./buyer-signing.service";
import { requiredSignersForDeal } from "./required-signers";

/** §14c: "The signing period expires after 14 days." Reminder at the two-thirds mark. */
const SIGNING_REMINDER_DAYS = 10;

export interface OpenSigningResult {
  prepared: { signerKind: string; envelopeId: string }[];
  failed: { signerKind: string; reason: string }[];
}

/**
 * Prepare a signing envelope for every required signer and enqueue each one's request
 * and reminder.
 *
 * Idempotent. `prepareBuyerSigningEnvelope` upserts on (dealId, signerKind) and every
 * enqueue carries a signer-scoped idempotency key, so re-running after a partial failure
 * completes the missing half without re-sending the delivered one.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT SWALLOWED. If the buyer's envelope prepares and the
 * co-buyer's does not, the caller gets both facts. A caller that treated this as boolean
 * would advance a deal into SIGNING_PENDING with one signer never asked.
 */
export async function openSigningForRequiredSigners(params: {
  dealId: string;
  signerUserId?: string;
  /** Overrides for the PRIMARY buyer, where the caller already resolved them. */
  buyerName?: string;
  buyerEmail?: string;
  now?: Date;
}): Promise<OpenSigningResult> {
  const now = params.now ?? new Date();
  const result: OpenSigningResult = { prepared: [], failed: [] };

  const signers = await requiredSignersForDeal(params.dealId);
  if (signers.length === 0) {
    result.failed.push({ signerKind: "BUYER", reason: "no required signers could be resolved" });
    return result;
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { vehicleYear: true, vehicleMake: true, vehicleModel: true },
  });
  const vehicle =
    [deal?.vehicleYear, deal?.vehicleMake, deal?.vehicleModel].filter(Boolean).join(" ") || "your vehicle";

  for (const signer of signers) {
    const isCoBuyer = signer.signerKind === "CO_BUYER";
    const name = (isCoBuyer ? signer.name : params.buyerName ?? signer.name) ?? null;
    const email = (isCoBuyer ? signer.email : params.buyerEmail ?? signer.email) ?? null;

    try {
      const prepared = await prepareBuyerSigningEnvelope(
        params.dealId,
        {
          // The co-buyer has no platform account by design (§13-D30), so no signerUserId.
          signerUserId: isCoBuyer ? undefined : params.signerUserId,
          signerName: name ?? undefined,
          signerEmail: email ?? undefined,
        },
        signer.signerKind,
        signer.coBuyerId,
      );
      result.prepared.push({ signerKind: signer.signerKind, envelopeId: prepared.envelopeId });
    } catch (err) {
      // One signer's failure must not stop the other being asked. A co-buyer envelope
      // that cannot be prepared is a deal that needs attention, not a buyer who should
      // also be left waiting.
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("open-signing: could not prepare envelope", {
        dealId: params.dealId,
        signerKind: signer.signerKind,
        error: reason,
      });
      result.failed.push({ signerKind: signer.signerKind, reason });
      continue;
    }

    if (!email) {
      // §26: a required signer with no channel cannot be asked, and the deal will sit at
      // SIGNING_PENDING until someone notices. Make it noticeable.
      logger.error("open-signing: required signer has no email — cannot send the signing link", {
        dealId: params.dealId,
        signerKind: signer.signerKind,
      });
      result.failed.push({ signerKind: signer.signerKind, reason: "no email address on file" });
      continue;
    }

    // The expiry comes from the envelope itself rather than being recomputed here, so the
    // date in the message is the date the gate will actually enforce.
    const envelope = await readEnvelopeForDeal(params.dealId, signer.signerKind);
    const expiresAt = envelope?.expiresAt ?? new Date(now.getTime() + 14 * 24 * 3600_000);

    const request = renderSignatureRequired({
      signerName: name,
      isCoBuyer,
      vehicle,
      expiresAt,
      dealId: params.dealId,
    });
    await enqueueTransactional({
      triggerEvent: "contract_approved",
      templateKey: PHASE_8_TEMPLATES.SIGNATURE_REQUIRED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: signer.coBuyerId ?? null,
      to: email,
      payload: {
        email,
        subject: request.subject,
        html: request.html,
        text: request.text,
        // Read by the state recheck so it can ask about THIS signer's envelope.
        signerKind: signer.signerKind,
      },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.SIGNATURE_REQUIRED}:${params.dealId}:${signer.signerKind}:${envelope?.attemptNumber ?? 1}`,
      cancelKey: signatureReminderCancelKey(params.dealId, signer.signerKind),
    });

    // The reminder is enqueued NOW with a future runAt, for the same reason the contract
    // request's is: a row that already exists cannot be forgotten by a cron that failed
    // to run. It shares this signer's cancel key, so their signature cancels it — and
    // ONLY theirs, which is why the key is per signer rather than per deal.
    const reminder = renderSignatureReminder({
      signerName: name,
      vehicle,
      expiresAt,
      expired: false,
      dealId: params.dealId,
    });
    await enqueueTransactional({
      triggerEvent: "signature_reminder",
      templateKey: PHASE_8_TEMPLATES.SIGNATURE_REMINDER,
      channel: "email",
      recipientKind: "buyer",
      recipientId: signer.coBuyerId ?? null,
      to: email,
      payload: {
        email,
        subject: reminder.subject,
        html: reminder.html,
        text: reminder.text,
        signerKind: signer.signerKind,
      },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.SIGNATURE_REMINDER}:${params.dealId}:${signer.signerKind}:${envelope?.attemptNumber ?? 1}`,
      runAt: new Date(now.getTime() + SIGNING_REMINDER_DAYS * 24 * 3600_000),
      cancelKey: signatureReminderCancelKey(params.dealId, signer.signerKind),
    });
  }

  return result;
}
