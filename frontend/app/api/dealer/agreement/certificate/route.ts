// GET /api/dealer/agreement/certificate
//
// Returns a short-lived signed URL for the authenticated dealer's own signed
// agreement certificate. dealerId is ALWAYS sourced from the authenticated
// session — never from a URL param or request body — which prevents IDOR.

import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { getSignedCertificateUrl } from "@/lib/services/agreement/certificate.service";

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) {
    return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  }

  const signature = await prisma.dealerAgreementSignature.findUnique({
    where: { dealerId: dealer.id },
    select: {
      id: true,
      certificatePdfPath: true,
      certificateGeneratedAt: true,
      agreementVersion: true,
      signedAt: true,
    },
  });

  if (!signature) {
    return errorResponse("NOT_FOUND", "No agreement signature found for this account", 404);
  }

  if (!signature.certificatePdfPath) {
    return errorResponse(
      "NOT_READY",
      "Your agreement certificate is still being generated. Please try again in a moment.",
      202,
    );
  }

  const signedUrl = await getSignedCertificateUrl(signature.certificatePdfPath, 900);
  if (!signedUrl) {
    return errorResponse(
      "STORAGE_ERROR",
      "Unable to generate download link. Please contact support@autolenis.com.",
      500,
    );
  }

  return successResponse({
    signedUrl, // expires in 15 minutes
    expiresInSeconds: 900,
    agreementVersion: signature.agreementVersion,
    signedAt: signature.signedAt.toISOString(),
    certificateId: signature.id,
  });
}
