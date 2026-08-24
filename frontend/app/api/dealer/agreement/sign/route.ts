// POST /api/dealer/agreement/sign
//
// Captures the dealer's in-house electronic signature for the dealer network
// participation agreement, then activates the dealer subject to the verification
// gate. Signature recording, onboarding completion, and the audit log are written
// atomically by the shared dealer-agreement service (also used by the onboarding
// wizard's AGREEMENT step) so the two paths can never diverge; the certificate PDF
// + confirmation email run as non-blocking post-response work.

import { NextRequest, after } from "next/server";
import { z } from "zod";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { CURRENT_DEALER_AGREEMENT_VERSION } from "@/lib/constants/dealer-agreement";
import {
  recordDealerAgreementSignature,
  finalizeDealerAgreementCertificate,
} from "@/lib/services/agreement/dealer-agreement.service";
import { activateDealerIfEligible } from "@/lib/services/dealer/dealer-activation.service";

const bodySchema = z.object({
  agreedToTerms: z.literal(true),
  agreementVersion: z.string(),
  consentedToElectronic: z.literal(true),
});

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  if (parsed.data.agreementVersion !== CURRENT_DEALER_AGREEMENT_VERSION) {
    return errorResponse(
      "VERSION_MISMATCH",
      "The agreement has been updated. Please refresh the page and sign the current version.",
      409,
    );
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";

  const signerEmail = dealer.user?.email ?? "";

  const signature = await recordDealerAgreementSignature({
    dealerId: dealer.id,
    dealershipName: dealer.dealershipName,
    signerEmail,
    ipAddress,
    userAgent,
    agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
  });

  if (signature.alreadySigned) {
    return successResponse({ alreadySigned: true });
  }

  // Certificate + confirmation email off the request path (never throws).
  after(() => finalizeDealerAgreementCertificate({
    signatureId: signature.signatureId,
    dealerId: dealer.id,
    dealershipName: dealer.dealershipName,
    signerEmail,
    ipAddress,
    userAgent,
    signedAt: signature.signedAt,
    agreementHash: signature.agreementHash,
    agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
  }));

  // Activate subject to the flag-gated verification gate.
  const activation = await activateDealerIfEligible(dealer.id, {
    adminId: "system",
    adminEmail: "system@autolenis.com",
    reason: "Dealer signed the network agreement",
  });

  return successResponse({ signed: true, activated: activation.activated, pendingVerification: activation.blocked ?? false }, 201);
}
