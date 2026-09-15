// POST /api/esign/invited/[token] — §13-D30's invited co-buyer signature.
//
// THE ONLY ROUTE IN THIS REPOSITORY WHERE A PARTY WITH NO PLATFORM ACCOUNT PERFORMS A
// LEGALLY SIGNIFICANT WRITE. That is why it was withheld from the first Phase 8 wave and
// shipped only under a separate, conditional authorization — and why the conditions are
// enforced in `invited-signer.service.ts` on every request rather than assumed here.
//
// The token IS the credential. It is never logged, never echoed in a response, and never
// written anywhere but the emailed link; only its SHA-256 is stored.
//
// GET is deliberately absent. The page server-renders through `resolveSignerToken` directly,
// so there is no JSON endpoint returning deal data to anyone holding the token — one surface,
// not two, and nothing to scrape.

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { resolveSignerToken, consumeSignerToken } from "@/lib/services/esign/invited-signer.service";
import { recordBuyerSignature } from "@/lib/services/esign/buyer-signing.service";

export const dynamic = "force-dynamic";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Resolve FIRST and without consuming. Every one of the six conditions is checked inside,
  // and a refusal comes back as a named reason so the client renders a sentence.
  const resolution = await resolveSignerToken(token);
  if (!resolution.ok) {
    // 410 Gone for a link that WAS valid and is finished — consumed or expired. That is the
    // common case (a co-buyer clicking twice), and it is not an error on their part.
    const gone = resolution.reason === "consumed" || resolution.reason === "expired";
    return fail(resolution.reason.toUpperCase(), "This signing link is no longer active.", gone ? 410 : 404);
  }
  const { view } = resolution;

  let body: unknown;
  try { body = await request.json(); }
  catch { return fail("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = body as { signatureText?: unknown; acknowledgments?: unknown };
  const signatureText = typeof parsed.signatureText === "string" ? parsed.signatureText.trim() : "";
  if (!signatureText) return fail("VALIDATION_ERROR", "Type your full name to sign.", 400);
  if (!Array.isArray(parsed.acknowledgments)) {
    return fail("VALIDATION_ERROR", "Every acknowledgment must be accepted before signing.", 400);
  }

  // CONDITION 5 — the co-buyer's OWN evidence. IP and user agent are taken from the request
  // here, never from the body, so the client cannot author its own audit trail.
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  try {
    const result = await recordBuyerSignature({
      dealId: view.dealId,
      signerKind: "CO_BUYER",
      coBuyerId: view.coBuyerId,
      // No platform account by design (§13-D30). The CoBuyer row IS the actor identity, and
      // it is what lands in the audit trail.
      signerUserId: view.coBuyerId,
      signerName: view.coBuyerName,
      signerEmail: "",
      signatureText,
      acknowledgments: parsed.acknowledgments as never,
      ipAddress,
      userAgent,
    });

    // CONDITION 1 — spend the token, AFTER the signature is recorded. Spending it first
    // would strand a co-buyer whose signature then failed, with no way back in. A failure
    // here is logged and NOT surfaced: the signature is real and recorded, and telling the
    // co-buyer their signing failed because a token flag did not flip would be false.
    const spent = await consumeSignerToken(view.envelopeId);
    if (!spent) {
      logger.error("invited signer: signature recorded but token not consumed", {
        dealId: view.dealId, envelopeId: view.envelopeId,
      });
    }

    return NextResponse.json({ signed: true, alreadySigned: result.alreadySigned }, { status: 200 });
  } catch (err) {
    // Never leak the internal error to a bearer-token holder; log it with the deal, answer
    // with the same shape every other refusal uses.
    logger.error("invited signer: signature could not be recorded", {
      dealId: view.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("NOT_SIGNABLE", "This contract could not be signed right now. Please contact AutoLenis.", 409);
  }
}
