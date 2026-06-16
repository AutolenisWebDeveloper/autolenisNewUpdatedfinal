// POST /api/dealer/agreement/sign
//
// Captures the dealer's in-house electronic signature for the dealer network
// participation agreement. Writes the signature record, completes onboarding,
// and the admin audit log atomically, then generates the certificate PDF and
// confirmation email as non-blocking post-response work.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { after } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import {
  CURRENT_DEALER_AGREEMENT_VERSION,
  DEALER_AGREEMENT_TEXT,
} from "@/lib/constants/dealer-agreement";
import { sendDealerAgreementConfirmation } from "@/lib/services/email/dealer-agreement-confirmation.service";
import {
  generateAndUploadCertificate,
  getSignedCertificateUrl,
} from "@/lib/services/agreement/certificate.service";

const bodySchema = z.object({
  agreedToTerms: z.literal(true),
  agreementVersion: z.string(),
  consentedToElectronic: z.literal(true),
});

export async function POST(request: NextRequest) {
  // 1. Auth
  const dealer = await getRequestDealer(request);
  if (!dealer) {
    return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  }

  // 2. Body parse + validation
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid request body",
      400,
    );
  }

  // 3. Version check
  if (parsed.data.agreementVersion !== CURRENT_DEALER_AGREEMENT_VERSION) {
    return errorResponse(
      "VERSION_MISMATCH",
      "The agreement has been updated. Please refresh the page and sign the current version.",
      409,
    );
  }

  // Contact identity. The Dealer model has no separate contact name field —
  // the dealership name is the legal signer of record (mirrors the existing
  // DocuSign marketplace agreement flow), and the linked user's email is the
  // signer email.
  const signerName = dealer.dealershipName;
  const signerEmail = dealer.user?.email ?? "";

  // 4. Idempotency check
  const existing = await prisma.dealerAgreementSignature.findUnique({
    where: { dealerId: dealer.id },
  });
  if (existing) {
    await prisma.dealer.update({
      where: { id: dealer.id },
      data: {
        onboardingStep: "COMPLETE",
        agreedToTermsAt: dealer.agreedToTermsAt ?? new Date(),
      },
    });
    return successResponse({ alreadySigned: true });
  }

  // 5. Attribution capture
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";

  // 6. Hash computation
  const agreementHash = createHash("sha256").update(DEALER_AGREEMENT_TEXT).digest("hex");

  // 7. Atomic transaction — signature, onboarding completion, audit log
  const signature = await prisma.$transaction(async (tx) => {
    const sig = await tx.dealerAgreementSignature.create({
      data: {
        dealerId: dealer.id,
        agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
        agreementHash,
        signerName,
        signerEmail,
        dealershipName: dealer.dealershipName,
        ipAddress,
        userAgent,
        consentedToElectronic: true,
      },
    });

    await tx.dealer.update({
      where: { id: dealer.id },
      data: {
        onboardingStep: "COMPLETE",
        agreedToTermsAt: new Date(),
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId: "system",
        adminEmail: "system@autolenis.com",
        action: "DEALER_AGREEMENT_SIGNED",
        entityType: "DealerAgreementSignature",
        entityId: sig.id,
        reason:
          "Dealer completed in-house electronic signature during onboarding",
        metadata: {
          dealerId: dealer.id,
          agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
          agreementHash,
          ipAddress,
          signerEmail,
        },
      },
    });

    return sig;
  });

  // 8. Non-blocking post-sign work — certificate + confirmation email.
  after(async () => {
    try {
      const storagePath = await generateAndUploadCertificate({
        signatureId: signature.id,
        dealerId: dealer.id,
        signerName,
        signerEmail,
        dealershipName: dealer.dealershipName,
        ipAddress,
        userAgent,
        signedAt: signature.signedAt,
        agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
        agreementHash,
      });

      // 24-hour URL for the email only — the dashboard always mints fresh
      // short-lived URLs on demand.
      const emailPdfUrl = storagePath
        ? await getSignedCertificateUrl(storagePath, 86400)
        : null;

      const emailResult = await sendDealerAgreementConfirmation({
        signatureId: signature.id,
        contactName: signerName,
        dealershipName: dealer.dealershipName,
        email: signerEmail,
        pdfSignedUrl: emailPdfUrl ?? null,
        signedAt: signature.signedAt,
        agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
      });

      await prisma.dealerAgreementSignature.update({
        where: { id: signature.id },
        data: {
          certificatePdfPath: storagePath ?? null,
          certificateGeneratedAt: storagePath ? new Date() : null,
          confirmationEmailSentAt: emailResult.success ? new Date() : null,
          confirmationEmailId: emailResult.messageId ?? null,
        },
      });
    } catch (err) {
      logger.error("[dealer/agreement/sign] post-sign work failed:", err);
    }
  });

  // 9. Done
  return successResponse({ signed: true }, 201);
}
