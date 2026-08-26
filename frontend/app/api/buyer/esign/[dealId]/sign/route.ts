import { NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { getRequestAttribution } from "@/lib/security/request-attribution";
import {
  recordBuyerSignature,
  finalizeBuyerSignatureCertificate,
  ConsentRequiredError,
  DocumentChangedError,
  EnvelopeNotSignableError,
  NoSignableDocumentError,
} from "@/lib/services/esign/buyer-signing.service";

interface Props { params: Promise<{ dealId: string }> }

// The client supplies ONLY its consent action and adopted name. Everything
// authoritative — signer identity, IP, user-agent, timestamps, document hash —
// is resolved server-side. A literal `true` consent is required (a page view or
// an unchecked box is never a signature).
const schema = z.object({
  consentedToElectronic: z.literal(true),
  signatureText: z.string().trim().min(1, "Type your full name to adopt your signature").max(200),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: { buyer: { include: { user: { select: { email: true } } } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("CONSENT_REQUIRED", parsed.error.issues[0]?.message ?? "Consent and a typed signature are required", 400);
  }

  const { ipAddress, userAgent } = getRequestAttribution(request);
  const signerName = [deal.buyer?.firstName, deal.buyer?.lastName].filter(Boolean).join(" ") || parsed.data.signatureText.trim();
  const signerEmail = deal.buyer?.user?.email ?? "";

  try {
    const result = await recordBuyerSignature({
      dealId,
      signerUserId: buyer.id,
      signerName,
      signerEmail,
      signatureText: parsed.data.signatureText,
      consentedToElectronic: parsed.data.consentedToElectronic,
      ipAddress,
      userAgent,
    });

    // Off the request path: generate the evidence certificate, emit the CRM
    // contract_signed event, and send a truthful confirmation. All best-effort —
    // none affects the committed signature.
    const finalize = async () => {
      await finalizeBuyerSignatureCertificate(dealId);
      try {
        const { emitDomainEvent } = await import("@/lib/events/emit");
        await emitDomainEvent("contract_signed", {
          domainEntityId: dealId,
          contact: {
            email: signerEmail || null,
            phone: deal.buyer?.phone ?? null,
            firstName: deal.buyer?.firstName,
            lastName: deal.buyer?.lastName,
            source: "buyer_signup",
          },
          data: { deal_id: dealId, envelope_id: result.envelopeId, buyer_id: buyer.id },
        });
      } catch (err) {
        logger.error("[buyer/esign/sign] contract_signed emit failed:", err);
      }
      try {
        if (signerEmail) {
          const { sendContractSignedEmail } = await import("@/lib/services/email/resend.service");
          await sendContractSignedEmail({ to: signerEmail, firstName: deal.buyer?.firstName ?? "there", dealId, envelopeId: result.envelopeId });
        }
      } catch (err) {
        logger.error("[buyer/esign/sign] confirmation email failed:", err);
      }
    };
    // Prefer Vercel after(); fall back to a detached promise when we're outside a
    // request scope (mirrors lib/events/emit.ts). Never let this affect the response.
    try {
      after(() => finalize());
    } catch {
      void finalize().catch((err) => logger.error("[buyer/esign/sign] finalize failed:", err));
    }

    return successResponse({ status: result.status, envelopeId: result.envelopeId, alreadySigned: result.alreadySigned });
  } catch (err) {
    if (err instanceof ConsentRequiredError) return errorResponse("CONSENT_REQUIRED", "Please consent to electronic signing and type your name to sign.", 400);
    if (err instanceof DocumentChangedError) return errorResponse("DOCUMENT_CHANGED", "The contract changed and your signing session was reset. Please review and sign the updated contract.", 409);
    if (err instanceof EnvelopeNotSignableError) return errorResponse("NOT_SIGNABLE", "This signing request is no longer active. Please restart signing.", 409);
    if (err instanceof NoSignableDocumentError) return errorResponse("NO_SIGNABLE_DOCUMENT", "There is no contract available to sign yet.", 409);
    logger.error("[buyer/esign/sign] signature failed:", err);
    return errorResponse("INTERNAL_ERROR", "We couldn't record your signature. Please try again.", 500);
  }
}
