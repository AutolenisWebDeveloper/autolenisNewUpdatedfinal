import { NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { getRequestAttribution } from "@/lib/security/request-attribution";
import {
  recordBuyerSignature,
  finalizeSignedContract,
  ConsentRequiredError,
  DocumentChangedError,
  EnvelopeNotSignableError,
  NoSignableDocumentError,
} from "@/lib/services/esign/buyer-signing.service";
import { CONSENT_ACK_KEYS } from "@/lib/services/esign/consent-policy";

interface Props { params: Promise<{ dealId: string }> }

// The client supplies ONLY its consent actions and adopted name. Everything
// authoritative — signer identity, IP, user-agent, timestamps, document hash —
// is resolved server-side. Each of the FOUR required acknowledgments must be
// affirmatively `true` (a page view, an unchecked box, or a typed name is never
// consent). The server re-validates against the active consent policy.
const schema = z.object({
  acknowledgments: z
    .array(z.object({ key: z.enum(CONSENT_ACK_KEYS), accepted: z.boolean() }))
    .min(1, "All consent acknowledgments are required"),
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
      acknowledgments: parsed.data.acknowledgments,
      ipAddress,
      userAgent,
    });

    // Off the request path (§7): generate + store the executed contract artifact,
    // then the evidence certificate, and ONLY THEN emit the buyer/dealer "signed
    // contract is ready" confirmations — never before the artifact exists. All
    // best-effort and idempotent; a failure leaves confirmations unsent for the
    // reconciliation cron to re-drive and never affects the committed signature.
    const finalize = async () => {
      await finalizeSignedContract(dealId);
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
