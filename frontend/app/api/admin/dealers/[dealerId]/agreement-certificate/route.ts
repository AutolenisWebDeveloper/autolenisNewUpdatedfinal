// GET /api/admin/dealers/[dealerId]/agreement-certificate
//
// Admin view of a dealer's signed agreement: returns the full signature
// metadata plus a short-lived signed URL for the certificate PDF when it has
// been generated.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { getSignedCertificateUrl } from "@/lib/services/agreement/certificate.service";

interface Props {
  params: Promise<{ dealerId: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;

  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return adminError("UNAUTHORIZED", "Not authenticated", 401);
  }

  const signature = await prisma.dealerAgreementSignature.findUnique({
    where: { dealerId },
    select: {
      id: true,
      certificatePdfPath: true,
      certificateGeneratedAt: true,
      agreementVersion: true,
      agreementHash: true,
      signerName: true,
      signerEmail: true,
      dealershipName: true,
      ipAddress: true,
      signedAt: true,
      consentedToElectronic: true,
      confirmationEmailSentAt: true,
    },
  });

  if (!signature) {
    return adminError("NOT_FOUND", "No agreement signature found for this dealer", 404);
  }

  if (!signature.certificatePdfPath) {
    return adminSuccess({
      signed: true,
      certificateReady: false,
      message: "Signature exists but PDF certificate has not yet been generated.",
      signature: {
        id: signature.id,
        agreementVersion: signature.agreementVersion,
        signerName: signature.signerName,
        signerEmail: signature.signerEmail,
        dealershipName: signature.dealershipName,
        ipAddress: signature.ipAddress,
        signedAt: signature.signedAt.toISOString(),
        agreementHash: signature.agreementHash,
      },
    });
  }

  const signedUrl = await getSignedCertificateUrl(signature.certificatePdfPath, 900);
  if (!signedUrl) {
    return adminError(
      "STORAGE_ERROR",
      "Unable to generate certificate download link. Storage may be unavailable.",
      500,
    );
  }

  return adminSuccess({
    signed: true,
    certificateReady: true,
    signedUrl,
    expiresInSeconds: 900,
    signature: {
      id: signature.id,
      agreementVersion: signature.agreementVersion,
      agreementHash: signature.agreementHash,
      signerName: signature.signerName,
      signerEmail: signature.signerEmail,
      dealershipName: signature.dealershipName,
      ipAddress: signature.ipAddress,
      signedAt: signature.signedAt.toISOString(),
      consentedToElectronic: signature.consentedToElectronic,
      confirmationEmailSentAt: signature.confirmationEmailSentAt?.toISOString() ?? null,
    },
  });
}
