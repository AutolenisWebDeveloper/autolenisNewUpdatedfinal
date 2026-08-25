// lib/services/agreement/dealer-agreement.service.ts — Batch 2
//
// Single, shared authority for recording a dealer's in-house electronic signature
// of the network participation agreement. BOTH the onboarding-wizard AGREEMENT
// step and the dedicated /api/dealer/agreement/sign endpoint route through here,
// so a dealer can never be marked "agreed" without a real, tamper-evident
// DealerAgreementSignature (SHA-256 hash + IP + user-agent) and certificate.
//
// Fixes FS-B (agreement "signed" with no signature/certificate record).

import { createHash } from "crypto";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  CURRENT_DEALER_AGREEMENT_VERSION,
  DEALER_AGREEMENT_TEXT,
} from "@/lib/constants/dealer-agreement";
import {
  generateAndUploadCertificate,
  getSignedCertificateUrl,
} from "@/lib/services/agreement/certificate.service";
import { sendDealerAgreementConfirmation } from "@/lib/services/email/dealer-agreement-confirmation.service";

export interface RecordSignatureParams {
  dealerId: string;
  dealershipName: string;
  signerEmail: string;
  ipAddress: string;
  userAgent: string;
  agreementVersion?: string;
}

export interface RecordSignatureResult {
  signatureId: string;
  signedAt: Date;
  agreementHash: string;
  alreadySigned: boolean;
}

/** SHA-256 of the exact agreement text a dealer consented to — the tamper-evident anchor. */
export function computeAgreementHash(text: string = DEALER_AGREEMENT_TEXT): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Idempotently record the dealer's signature and complete onboarding. Safe to call
 * from multiple entry points and to retry: the DealerAgreementSignature.dealerId
 * unique constraint means at most one signature per dealer; a concurrent double
 * submit resolves to the winner's row. Never activates the dealer (that is the
 * activation service's job, gated separately).
 */
export async function recordDealerAgreementSignature(
  params: RecordSignatureParams
): Promise<RecordSignatureResult> {
  const version = params.agreementVersion ?? CURRENT_DEALER_AGREEMENT_VERSION;
  const agreementHash = computeAgreementHash();
  const signerName = params.dealershipName; // dealership is the legal signer of record

  const existing = await prisma.dealerAgreementSignature.findUnique({
    where: { dealerId: params.dealerId },
  });
  if (existing) {
    // Ensure onboarding reflects the already-captured signature (idempotent).
    const dealer = await prisma.dealer.findUnique({
      where: { id: params.dealerId },
      select: { agreedToTermsAt: true },
    });
    await prisma.dealer.update({
      where: { id: params.dealerId },
      data: { onboardingStep: "COMPLETE", agreedToTermsAt: dealer?.agreedToTermsAt ?? existing.signedAt },
    });
    return { signatureId: existing.id, signedAt: existing.signedAt, agreementHash: existing.agreementHash, alreadySigned: true };
  }

  try {
    const sig = await prisma.$transaction(async (tx) => {
      const created = await tx.dealerAgreementSignature.create({
        data: {
          dealerId: params.dealerId,
          agreementVersion: version,
          agreementHash,
          signerName,
          signerEmail: params.signerEmail,
          dealershipName: params.dealershipName,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          consentedToElectronic: true,
        },
      });
      await tx.dealer.update({
        where: { id: params.dealerId },
        data: { onboardingStep: "COMPLETE", agreedToTermsAt: new Date() },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: "system",
          adminEmail: "system@autolenis.com",
          action: "DEALER_AGREEMENT_SIGNED",
          entityType: "DealerAgreementSignature",
          entityId: created.id,
          reason: "Dealer completed in-house electronic signature during onboarding",
          metadata: { dealerId: params.dealerId, agreementVersion: version, agreementHash, ipAddress: params.ipAddress, signerEmail: params.signerEmail },
        },
      });
      return created;
    });
    return { signatureId: sig.id, signedAt: sig.signedAt, agreementHash, alreadySigned: false };
  } catch (err) {
    // Lost the unique-constraint race — the winner's signature is authoritative.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const winner = await prisma.dealerAgreementSignature.findUnique({ where: { dealerId: params.dealerId } });
      if (winner) {
        await prisma.dealer.update({
          where: { id: params.dealerId },
          data: { onboardingStep: "COMPLETE", agreedToTermsAt: winner.signedAt },
        }).catch(() => {});
        return { signatureId: winner.id, signedAt: winner.signedAt, agreementHash: winner.agreementHash, alreadySigned: true };
      }
    }
    throw err;
  }
}

export interface FinalizeCertificateParams {
  signatureId: string;
  dealerId: string;
  dealershipName: string;
  signerEmail: string;
  ipAddress: string;
  userAgent: string;
  signedAt: Date;
  agreementHash: string;
  agreementVersion?: string;
}

/**
 * Non-blocking post-sign work — generate + upload the certificate PDF and send the
 * confirmation email, then stamp the paths onto the signature. MUST run inside
 * `after()` and swallow its own errors (never blocks the response).
 */
export async function finalizeDealerAgreementCertificate(params: FinalizeCertificateParams): Promise<void> {
  const version = params.agreementVersion ?? CURRENT_DEALER_AGREEMENT_VERSION;
  try {
    const storagePath = await generateAndUploadCertificate({
      signatureId: params.signatureId,
      dealerId: params.dealerId,
      signerName: params.dealershipName,
      signerEmail: params.signerEmail,
      dealershipName: params.dealershipName,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      signedAt: params.signedAt,
      agreementVersion: version,
      agreementHash: params.agreementHash,
    });

    const emailPdfUrl = storagePath ? await getSignedCertificateUrl(storagePath, 86400) : null;

    const emailResult = await sendDealerAgreementConfirmation({
      signatureId: params.signatureId,
      contactName: params.dealershipName,
      dealershipName: params.dealershipName,
      email: params.signerEmail,
      pdfSignedUrl: emailPdfUrl ?? null,
      signedAt: params.signedAt,
      agreementVersion: version,
    });

    await prisma.dealerAgreementSignature.update({
      where: { id: params.signatureId },
      data: {
        certificatePdfPath: storagePath ?? null,
        certificateGeneratedAt: storagePath ? new Date() : null,
        confirmationEmailSentAt: emailResult.success ? new Date() : null,
        confirmationEmailId: emailResult.messageId ?? null,
      },
    });
  } catch (err) {
    logger.error("[dealer-agreement] certificate finalization failed:", err);
  }
}
